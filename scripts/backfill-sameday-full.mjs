/**
 * Full backfill: SameDay 22 Apr 2026 → now
 * 1. Pull all status events in 2h chunks
 * 2. Fetch COD details for delivered/returned
 * 3. Match ALL AWBs to Shopify orders
 * 4. Mark delivered PENDING orders as PAID in Shopify
 * 5. Cancel returned orders in Shopify (with restock)
 */
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const SAMEDAY_API = process.env.SAMEDAY_API_URL || 'https://api.sameday.ro';
const STORE_ID = 'cmoehpcdr0001qffezul9wagq'; // vivimall
const API_VERSION = '2025-10';

function decrypt(data) {
  const [iv, tag, ct] = data.split(':').map(h => Buffer.from(h, 'hex'));
  const key = Buffer.from(process.env.APP_ENCRYPTION_KEY, 'hex');
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return d.update(ct) + d.final('utf8');
}

async function samedayAuth() {
  const res = await fetch(`${SAMEDAY_API}/api/authenticate?remember_me=1`, {
    method: 'POST',
    headers: { 'X-AUTH-USERNAME': process.env.SAMEDAY_USERNAME, 'X-AUTH-PASSWORD': process.env.SAMEDAY_PASSWORD },
  });
  const data = await res.json();
  return data.token;
}

async function shopifyGql(domain, token, query) {
  const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Shopify ${res.status}`);
  const data = await res.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors).slice(0, 200));
  return data.data;
}

async function main() {
  const sdToken = await samedayAuth();
  console.log('SameDay authenticated');

  const store = await prisma.storeConnection.findUnique({ where: { id: STORE_ID } });
  const shopToken = decrypt(store.shopifyAccessToken);
  console.log('Shopify token ready for', store.domain);

  // ═══ STEP 1: Pull all events from Apr 22 ═══
  console.log('\n=== STEP 1: Status sync from Apr 22 ===');
  const startDate = new Date('2026-04-22T00:00:00+03:00');
  const endDate = new Date();
  const CHUNK = 7000;
  let current = Math.floor(startDate.getTime() / 1000);
  const end = Math.floor(endDate.getTime() / 1000);
  let totalEvents = 0;

  while (current < end) {
    const chunkEnd = Math.min(current + CHUNK, end);
    let page = 1;
    while (true) {
      try {
        const res = await fetch(`${SAMEDAY_API}/api/client/status-sync?startTimestamp=${current}&endTimestamp=${chunkEnd}&page=${page}&countPerPage=100`, {
          headers: { 'X-AUTH-TOKEN': sdToken },
        });
        if (!res.ok) break;
        const data = await res.json();
        if (!data.data || data.data.length === 0) break;

        for (const event of data.data) {
          const awb = event.parcelAwbNumber.length > 3 ? event.parcelAwbNumber.slice(0, -3) : event.parcelAwbNumber;
          const statusId = event.statusId;
          try {
            await prisma.courierTracking.upsert({
              where: { storeConnectionId_awb: { storeConnectionId: STORE_ID, awb } },
              create: {
                storeConnectionId: STORE_ID, awb, statusId,
                statusName: event.status || event.statusLabel || '',
                inReturn: event.inReturn || false,
                isPickedUp: statusId === 4,
                isDelivered: statusId === 9,
                isReturned: statusId === 35 || event.inReturn === true,
                county: event.transitLocation || null,
                courierUpdatedAt: event.statusDate ? new Date(event.statusDate) : new Date(),
              },
              update: {
                statusId, statusName: event.status || event.statusLabel || '',
                inReturn: event.inReturn || false,
                isPickedUp: statusId === 4 || undefined,
                isDelivered: statusId === 9 || undefined,
                isReturned: (statusId === 35 || event.inReturn === true) || undefined,
                county: event.transitLocation || undefined,
                courierUpdatedAt: event.statusDate ? new Date(event.statusDate) : new Date(),
              },
            });
            totalEvents++;
          } catch {}
        }
        if (page >= (data.pages || 1)) break;
        page++;
      } catch { break; }
    }
    current = chunkEnd;
    await sleep(300);
  }
  console.log(`Synced ${totalEvents} events`);

  // ═══ STEP 2: Fetch COD details ═══
  console.log('\n=== STEP 2: COD details ===');
  const needDetails = await prisma.courierTracking.findMany({
    where: { storeConnectionId: STORE_ID, codAmount: null, OR: [{ isDelivered: true }, { isReturned: true }] },
    select: { id: true, awb: true },
  });
  console.log(`${needDetails.length} AWBs need COD details`);

  for (let i = 0; i < needDetails.length; i++) {
    const ct = needDetails[i];
    try {
      const res = await fetch(`${SAMEDAY_API}/api/client/awb/${ct.awb}/status`, { headers: { 'X-AUTH-TOKEN': sdToken } });
      const awbData = await res.json();
      const s = awbData.expeditionSummary;
      await prisma.courierTracking.update({
        where: { id: ct.id },
        data: {
          codAmount: s.cashOnDelivery || 0,
          isCod: (s.cashOnDelivery || 0) > 0,
          servicePayment: s.servicePayment || null,
          county: awbData.expeditionStatus?.county || undefined,
        },
      });
      if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${needDetails.length}`);
      await sleep(300);
    } catch {}
  }

  // ═══ STEP 3: Match ALL AWBs to orders ═══
  console.log('\n=== STEP 3: Match AWBs to orders ===');
  let unmatched = await prisma.courierTracking.findMany({
    where: { storeConnectionId: STORE_ID, orderId: null },
    select: { id: true, awb: true },
  });
  console.log(`${unmatched.length} AWBs to match`);

  let matchCount = 0;
  for (let i = 0; i < unmatched.length; i++) {
    const ct = unmatched[i];
    try {
      const result = await shopifyGql(store.domain, shopToken, `{
        orders(first: 1, query: "${ct.awb}") {
          edges { node { id name displayFinancialStatus } }
        }
      }`);
      const order = result.orders?.edges?.[0]?.node;
      if (order) {
        const localOrder = await prisma.order.findFirst({
          where: { storeConnectionId: STORE_ID, externalId: order.id },
          select: { id: true, financialStatus: true },
        });
        await prisma.courierTracking.update({
          where: { id: ct.id },
          data: { orderId: localOrder?.id || null, orderExternalId: order.id, orderNumber: order.name },
        });
        matchCount++;
      }
      if ((i + 1) % 30 === 0) console.log(`  ${i + 1}/${unmatched.length} (${matchCount} matched)`);
      await sleep(1500);
    } catch (err) {
      if ((i + 1) % 30 === 0) console.log(`  ${i + 1}/${unmatched.length} (error: ${err.message?.slice(0, 50)})`);
    }
  }
  console.log(`Matched ${matchCount}/${unmatched.length}`);

  // ═══ STEP 4: Mark delivered PENDING as PAID ═══
  console.log('\n=== STEP 4: Mark PAID ===');
  // Livrat = Paid, regardless of COD or card
  // Only call Shopify for orders still PENDING
  const toMarkPaid = await prisma.courierTracking.findMany({
    where: {
      storeConnectionId: STORE_ID,
      isDelivered: true,
      shopifyPaymentMarked: false,
      orderExternalId: { not: null },
      order: { financialStatus: 'PENDING' },
    },
    select: { id: true, awb: true, orderExternalId: true, orderNumber: true, orderId: true },
  });
  console.log(`${toMarkPaid.length} PENDING orders to mark as PAID`);

  for (const ct of toMarkPaid) {
    try {
      const result = await shopifyGql(store.domain, shopToken, `
        mutation { orderMarkAsPaid(input: { id: "${ct.orderExternalId}" }) {
          order { id displayFinancialStatus } userErrors { field message }
        } }
      `);
      const errors = result.orderMarkAsPaid?.userErrors;
      if (errors && errors.length > 0) {
        console.log(`  ${ct.orderNumber} error:`, errors[0].message);
      } else {
        console.log(`  ${ct.orderNumber} → PAID`);
      }
      await prisma.courierTracking.update({ where: { id: ct.id }, data: { shopifyPaymentMarked: true, shopifyMarkedAt: new Date() } });
      if (ct.orderId) await prisma.order.update({ where: { id: ct.orderId }, data: { financialStatus: 'PAID', status: 'PAID' } });
      await sleep(2000);
    } catch (err) {
      console.log(`  ${ct.orderNumber} failed:`, err.message?.slice(0, 80));
    }
  }

  // Also mark all delivered non-PENDING as processed (already paid via card)
  const alreadyPaid = await prisma.courierTracking.updateMany({
    where: {
      storeConnectionId: STORE_ID,
      isDelivered: true,
      shopifyPaymentMarked: false,
      orderExternalId: { not: null },
      order: { financialStatus: { not: 'PENDING' } },
    },
    data: { shopifyPaymentMarked: true, shopifyMarkedAt: new Date() },
  });
  console.log(`${alreadyPaid.count} already-paid orders marked as processed`);

  // ═══ STEP 5: Cancel returned orders ═══
  console.log('\n=== STEP 5: Cancel returned ===');
  const toCancel = await prisma.courierTracking.findMany({
    where: {
      storeConnectionId: STORE_ID,
      isReturned: true,
      orderId: { not: null },
      order: { financialStatus: { notIn: ['VOIDED', 'REFUNDED'] } },
    },
    select: { id: true, orderId: true, orderNumber: true, orderExternalId: true },
  });
  console.log(`${toCancel.length} returned orders to cancel`);

  for (const ct of toCancel) {
    try {
      await shopifyGql(store.domain, shopToken, `
        mutation { orderCancel(orderId: "${ct.orderExternalId}", reason: CUSTOMER, notifyCustomer: false, refund: true, restock: true) {
          orderCancelUserErrors { field message }
        } }
      `);
      console.log(`  ${ct.orderNumber} → cancelled`);
      await prisma.order.update({ where: { id: ct.orderId }, data: { financialStatus: 'VOIDED', fulfillmentStatus: 'RETURNED' } });
      await sleep(2000);
    } catch (err) {
      console.log(`  ${ct.orderNumber} cancel:`, err.message?.slice(0, 80));
    }
  }

  // ═══ FINAL STATS ═══
  const stats = {
    total: await prisma.courierTracking.count({ where: { storeConnectionId: STORE_ID } }),
    delivered: await prisma.courierTracking.count({ where: { storeConnectionId: STORE_ID, isDelivered: true } }),
    returned: await prisma.courierTracking.count({ where: { storeConnectionId: STORE_ID, isReturned: true } }),
    matched: await prisma.courierTracking.count({ where: { storeConnectionId: STORE_ID, orderId: { not: null } } }),
    paid: await prisma.courierTracking.count({ where: { storeConnectionId: STORE_ID, shopifyPaymentMarked: true } }),
  };
  console.log('\n=== FINAL ===', JSON.stringify(stats));

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
