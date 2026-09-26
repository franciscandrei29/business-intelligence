/**
 * Incremental sync — runs hourly via cron.
 * Pulls orders modified in the last 3 hours, products updated in the last 24h.
 * Short delay between API calls, serial DB writes (safe for PG).
 */
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import nodemailer from 'nodemailer';

import fs from 'fs';

const SYNC_LOCK = '/tmp/kimono-sync.lock';

// Prevent multiple instances running simultaneously
if (fs.existsSync(SYNC_LOCK)) {
  try {
    const lockPid = parseInt(fs.readFileSync(SYNC_LOCK, 'utf8'));
    // Check if the process is still alive
    try { process.kill(lockPid, 0); console.log('[cron-sync] Another sync is running (pid ' + lockPid + '), exiting.'); process.exit(0); }
    catch { /* Process is dead, stale lock */ fs.unlinkSync(SYNC_LOCK); }
  } catch { fs.unlinkSync(SYNC_LOCK); }
}
fs.writeFileSync(SYNC_LOCK, String(process.pid));
process.on('exit', () => { try { fs.unlinkSync(SYNC_LOCK); } catch {} });
process.on('SIGTERM', () => { try { fs.unlinkSync(SYNC_LOCK); } catch {} process.exit(0); });
process.on('SIGINT', () => { try { fs.unlinkSync(SYNC_LOCK); } catch {} process.exit(0); });


const prisma = new PrismaClient();

function decrypt(data) {
  const [iv, tag, ct] = data.split(':').map((h) => Buffer.from(h, 'hex'));
  const key = Buffer.from(process.env.APP_ENCRYPTION_KEY, 'hex');
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return d.update(ct) + d.final('utf8');
}

const API_VERSION = '2025-04';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gql(shop, token, query, retries = 5) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query }),
    });

    // Rate limited by HTTP status
    if (res.status === 429) {
      const wait = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
      console.log(`  [throttle] HTTP 429, waiting ${wait / 1000}s (attempt ${attempt}/${retries})`);
      await sleep(wait);
      continue;
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();

    // Rate limited by GraphQL error
    if (json.errors && json.errors.some(e => e.extensions?.code === 'THROTTLED')) {
      const wait = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
      console.log(`  [throttle] THROTTLED, waiting ${wait / 1000}s (attempt ${attempt}/${retries})`);
      await sleep(wait);
      continue;
    }

    if (json.errors) throw new Error(JSON.stringify(json.errors).slice(0, 400));
    return json.data;
  }
  throw new Error('Max retries exceeded due to throttling');
}

async function syncShopifyIncremental(store) {
  const token = decrypt(store.shopifyAccessToken);
  const now = new Date();
  // Window = max(lastSync..now, 2h default). Adds 15min overlap for safety.
  const bufferMs = 15 * 60 * 1000;
  const defaultWindowMs = 2 * 60 * 60 * 1000;
  const lastSync = store.lastSyncAt ? new Date(store.lastSyncAt).getTime() : 0;
  const isInitialSync = lastSync === 0;
  const windowStart = lastSync > 0 ? lastSync - bufferMs : now.getTime() - (2 * 365 * 24 * 60 * 60 * 1000);
  const since = new Date(windowStart);

  const updatedAfter = since.toISOString();
  const updatedAfterProducts = since.toISOString();

  // --- CUSTOMERS ---
  const existingCustCount = await prisma.customer.count({ where: { storeConnectionId: store.id } });
  const custSince = existingCustCount > 1000
    ? new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    : updatedAfter;
  if (existingCustCount > 1000) {
    console.log(`  [customers] ${existingCustCount} exist, fetching last 24h only`);
  }
  let custCursor;
  let custCount = 0;
  do {
    const after = custCursor ? `, after: "${custCursor}"` : '';
    const q = `{
      customers(first: 50, query: "updated_at:>'${custSince}'", sortKey: UPDATED_AT, reverse: true${after}) {
        edges { cursor node {
          id email firstName lastName phone amountSpent { amount }
          numberOfOrders
          createdAt updatedAt emailMarketingConsent { marketingState }
          lastOrder { createdAt }
          tags
        } }
        pageInfo { hasNextPage }
      }
    }`;
    const data = await gql(store.domain, token, q);
    for (const e of data.customers.edges) {
      const c = e.node;
      try {
        await prisma.customer.upsert({
          where: { storeConnectionId_externalId: { storeConnectionId: store.id, externalId: c.id } },
          create: {
            storeConnectionId: store.id,
            externalId: c.id,
            email: c.email || null,
            firstName: c.firstName || null,
            lastName: c.lastName || null,
            phone: c.phone || null,
            totalSpent: parseFloat(c.amountSpent?.amount || '0'),
            ordersCount: parseInt(String(c.numberOfOrders || '0'), 10),
            firstOrderAt: c.createdAt ? new Date(c.createdAt) : null,
            lastOrderAt: c.lastOrder?.createdAt ? new Date(c.lastOrder.createdAt) : null,
            tags: c.tags || [],
            emailSubscribed: c.emailMarketingConsent?.marketingState === "SUBSCRIBED",
          },
          update: {
            email: c.email || null,
            firstName: c.firstName || null,
            lastName: c.lastName || null,
            phone: c.phone || null,
            totalSpent: parseFloat(c.amountSpent?.amount || '0'),
            ordersCount: parseInt(String(c.numberOfOrders || '0'), 10),
            lastOrderAt: c.lastOrder?.createdAt ? new Date(c.lastOrder.createdAt) : null,
            tags: c.tags || [],
            emailSubscribed: c.emailMarketingConsent?.marketingState === "SUBSCRIBED",
          },
        });
        custCount++;
      } catch (err) {
        console.error(`[${store.name}] customer upsert failed ${c.id}: ${err.message}`);
      }
    }
    custCursor = data.customers.pageInfo.hasNextPage ? data.customers.edges.at(-1).cursor : null;
    if (custCursor) await sleep(1500);
  } while (custCursor);

  // --- ORDERS (updated in last 3h) ---
  // Build map of customerExternalId -> customerId for fast lookup
  const allCustomers = await prisma.customer.findMany({
    where: { storeConnectionId: store.id },
    select: { id: true, externalId: true },
  });
  const custMap = new Map(allCustomers.map((c) => [c.externalId, c.id]));

  let ordCursor;
  let ordCount = 0;
  do {
    const after = ordCursor ? `, after: "${ordCursor}"` : '';
    const q = `{
      orders(first: 50, query: "updated_at:>'${updatedAfter}'", sortKey: UPDATED_AT, reverse: true${after}) {
        edges { cursor node {
          id name createdAt displayFinancialStatus displayFulfillmentStatus returnStatus
          totalPriceSet { shopMoney { amount currencyCode } }
          subtotalPriceSet { shopMoney { amount } }
          totalRefundedSet { shopMoney { amount } }
          totalDiscountsSet { shopMoney { amount } }
          customer { id }
          discountCode
          fulfillments(first: 1) { createdAt }
          lineItems(first: 50) { edges { node { title quantity originalUnitPriceSet { shopMoney { amount } } product { id } sku } } }
        } }
        pageInfo { hasNextPage }
      }
    }`;
    const data = await gql(store.domain, token, q);
    for (const e of data.orders.edges) {
      const n = e.node;
      const lineItems = n.lineItems.edges.map((li) => ({
        title: li.node.title,
        quantity: li.node.quantity,
        price: parseFloat(li.node.originalUnitPriceSet?.shopMoney?.amount || '0'),
        sku: li.node.sku,
        productId: li.node.product?.id,
      }));
      const customerId = n.customer?.id ? custMap.get(n.customer.id) ?? null : null;
      try {
        await prisma.order.upsert({
          where: { storeConnectionId_externalId: { storeConnectionId: store.id, externalId: n.id } },
          create: {
            storeConnectionId: store.id,
            externalId: n.id,
            orderNumber: n.name || null,
            customerId,
            total: parseFloat(n.totalPriceSet?.shopMoney?.amount || '0'),
            subtotal: n.subtotalPriceSet?.shopMoney?.amount ? parseFloat(n.subtotalPriceSet.shopMoney.amount) : null,
            totalRefunded: n.totalRefundedSet?.shopMoney?.amount ? parseFloat(n.totalRefundedSet.shopMoney.amount) : null,
            discountTotal: n.totalDiscountsSet?.shopMoney?.amount ? parseFloat(n.totalDiscountsSet.shopMoney.amount) : null,
            currency: n.totalPriceSet?.shopMoney?.currencyCode || 'RON',
            status: n.displayFinancialStatus || 'UNKNOWN',
            financialStatus: n.displayFinancialStatus || null,
            fulfillmentStatus: n.displayFulfillmentStatus || null,
            itemsCount: lineItems.reduce((s, li) => s + li.quantity, 0),
            lineItems: JSON.stringify(lineItems),
            discountCode: n.discountCode || null,
            placedAt: new Date(n.createdAt),
            fulfilledAt: n.fulfillments?.[0]?.createdAt ? new Date(n.fulfillments[0].createdAt) : null,
          },
          update: {
            customerId,
            total: parseFloat(n.totalPriceSet?.shopMoney?.amount || '0'),
            totalRefunded: n.totalRefundedSet?.shopMoney?.amount ? parseFloat(n.totalRefundedSet.shopMoney.amount) : null,
            discountTotal: n.totalDiscountsSet?.shopMoney?.amount ? parseFloat(n.totalDiscountsSet.shopMoney.amount) : null,
            status: n.displayFinancialStatus || 'UNKNOWN',
            financialStatus: n.displayFinancialStatus || null,
            fulfillmentStatus: n.displayFulfillmentStatus || null,
            itemsCount: lineItems.reduce((s, li) => s + li.quantity, 0),
            lineItems: JSON.stringify(lineItems),
            fulfilledAt: n.fulfillments?.[0]?.createdAt ? new Date(n.fulfillments[0].createdAt) : null,
            discountCode: n.discountCode || null,
          },
        });
        ordCount++;
      } catch (err) {
        console.error(`[${store.name}] order upsert failed ${n.id}: ${err.message}`);
      }
    }
    ordCursor = data.orders.pageInfo.hasNextPage ? data.orders.edges.at(-1).cursor : null;
    if (ordCursor) await sleep(1500);
  } while (ordCursor);

  // --- PRODUCTS (updated in last 24h) ---
  let prodCursor;
  let prodCount = 0;
  do {
    const after = prodCursor ? `, after: "${prodCursor}"` : '';
    const q = `{
      products(first: 50, query: "updated_at:>'${updatedAfterProducts}'", sortKey: UPDATED_AT, reverse: true${after}) {
        edges { cursor node {
          id title handle vendor productType tags status
          featuredImage { url }
          variants(first: 1) { edges { node { price compareAtPrice sku inventoryQuantity inventoryItem { unitCost { amount currencyCode } } } } }
        } }
        pageInfo { hasNextPage }
      }
    }`;
    const data = await gql(store.domain, token, q);
    for (const e of data.products.edges) {
      const p = e.node;
      const v = p.variants.edges[0]?.node;
      const unitCost = v?.inventoryItem?.unitCost?.amount ? parseFloat(v.inventoryItem.unitCost.amount) : null;
      try {
        await prisma.product.upsert({
          where: { storeConnectionId_externalId: { storeConnectionId: store.id, externalId: p.id } },
          create: {
            storeConnectionId: store.id,
            externalId: p.id,
            title: p.title,
            sku: v?.sku || null,
            price: parseFloat(v?.price || '0'),
            compareAtPrice: v?.compareAtPrice ? parseFloat(v.compareAtPrice) : null,
            costPerUnit: unitCost,
            inventory: v?.inventoryQuantity || 0,
            vendor: p.vendor || null,
            productType: p.productType || null,
            tags: p.tags || [],
            imageUrl: p.featuredImage?.url || null,
            handle: p.handle || null,
            status: p.status || 'active',
          },
          update: {
            title: p.title,
            sku: v?.sku || null,
            price: parseFloat(v?.price || '0'),
            compareAtPrice: v?.compareAtPrice ? parseFloat(v.compareAtPrice) : null,
            costPerUnit: unitCost,
            inventory: v?.inventoryQuantity || 0,
            vendor: p.vendor || null,
            productType: p.productType || null,
            tags: p.tags || [],
            imageUrl: p.featuredImage?.url || null,
            handle: p.handle || null,
            status: p.status || 'active',
          },
        });
        prodCount++;
      } catch (err) {
        console.error(`[${store.name}] product upsert failed ${p.id}: ${err.message}`);
      }
    }
    prodCursor = data.products.pageInfo.hasNextPage ? data.products.edges.at(-1).cursor : null;
    if (prodCursor) await sleep(1500);
  } while (prodCursor);

  // First sync done? Mark and notify owner via email (one-time only).
  const isFirstSync = !store.firstSyncCompletedAt;
  await prisma.storeConnection.update({
    where: { id: store.id },
    data: {
      lastSyncAt: new Date(),
      syncStatus: 'COMPLETED',
      ...(isFirstSync ? { firstSyncCompletedAt: new Date() } : {}),
    },
  });

  if (isFirstSync) {
    try {
      // Look up the team owner — sync emails go to the team owner's email
      const owner = await prisma.user.findUnique({
        where: { id: store.userId },
        select: { email: true, fullName: true },
      });
      if (owner) {
        await sendFirstSyncCompletedEmail({
          toEmail: owner.email,
          fullName: owner.fullName,
          storeName: store.name,
          counts: { customers: custCount, orders: ordCount, products: prodCount },
          storeId: store.id,
        });
      }
    } catch (err) {
      console.error('[cron-sync] first-sync email failed for', store.name, '-', err.message);
    }
  }

  return { customers: custCount, orders: ordCount, products: prodCount };
}

// ---------- First-sync completed email ----------
async function sendFirstSyncCompletedEmail({ toEmail, fullName, storeName, counts, storeId }) {
  const port = Number(process.env.SMTP_PORT) || 25;
  const config = {
    host: process.env.SMTP_HOST || '127.0.0.1',
    port,
    secure: port === 465,
    tls: { rejectUnauthorized: false },
  };
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    config.auth = { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };
  }
  const transporter = nodemailer.createTransport(config);
  const appUrl = process.env.APP_URL || 'https://bi.kimonogroup.ro';
  const from = process.env.SMTP_FROM || 'Kimono BI <noreply@kimonogroup.ro>';
  const firstName = (fullName || '').split(' ')[0];

  const fmt = (n) => new Intl.NumberFormat('ro-RO').format(n);

  const html = `<!DOCTYPE html>
<html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#FAFAF9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0A0A0A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAFAF9;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border:1px solid #EAEAEA;">
        <tr><td style="background:#0A0A0A;padding:24px 28px;border-bottom:4px solid #D85A30;">
          <div style="display:inline-block;vertical-align:middle;width:34px;height:34px;background:#D85A30;border-radius:8px;text-align:center;line-height:34px;color:#FFFFFF;font-size:16px;font-weight:800;">K</div>
          <div style="display:inline-block;vertical-align:middle;margin-left:10px;color:#FFFFFF;font-size:18px;font-weight:700;">Kimono <span style="color:#D85A30;">BI</span></div>
          <div style="color:#888780;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;margin-top:6px;font-weight:500;">Sincronizare · Finalizat</div>
        </td></tr>
        <tr><td style="padding:32px 28px;">
          <h1 style="margin:0 0 18px;font-size:22px;font-weight:600;color:#0A0A0A;line-height:1.25;">Datele tale sunt gata${firstName ? ', ' + firstName : ''}</h1>
          <p style="font-size:14px;line-height:1.6;color:#0A0A0A;margin:0 0 18px;">
            Primul import pentru <strong>${storeName}</strong> s-a încheiat. Toate produsele, comenzile și clienții sunt acum în Kimono BI.
          </p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;border:1px solid #EAEAEA;background:#FAFAF9;">
            <tr>
              <td style="padding:14px;width:33.33%;text-align:center;border-right:1px solid #EAEAEA;">
                <div style="font-size:10px;font-weight:700;color:#888780;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Comenzi</div>
                <div style="font-size:22px;font-weight:600;color:#D85A30;">${fmt(counts.orders)}</div>
              </td>
              <td style="padding:14px;width:33.33%;text-align:center;border-right:1px solid #EAEAEA;">
                <div style="font-size:10px;font-weight:700;color:#888780;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Clienți</div>
                <div style="font-size:22px;font-weight:600;color:#0369a1;">${fmt(counts.customers)}</div>
              </td>
              <td style="padding:14px;width:33.34%;text-align:center;">
                <div style="font-size:10px;font-weight:700;color:#888780;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Produse</div>
                <div style="font-size:22px;font-weight:600;color:#7c3aed;">${fmt(counts.products)}</div>
              </td>
            </tr>
          </table>
          <p style="font-size:13px;line-height:1.65;color:#525252;margin:0 0 14px;">
            <strong style="color:#0A0A0A;">Următorii pași:</strong>
          </p>
          <ul style="margin:0 0 22px;padding-left:18px;font-size:13px;line-height:1.7;color:#0A0A0A;">
            <li>Dashboard Today se populează cu KPI-uri în timp real.</li>
            <li>RFM, Cohorts, LTV, Churn — calculate automat din comenzi.</li>
            <li>AI Advisor zilnic și Smart Alerts pe stoc.</li>
            <li>Sincronizările următoare rulează automat la fiecare 60 minute (configurabil per magazin).</li>
          </ul>
          <div style="margin:24px 0;">
            <a href="${appUrl}/dashboard" style="display:inline-block;padding:14px 28px;background:#FF5A1F;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:14px;border:2px solid #0a0a0a;letter-spacing:0.3px;">
              Deschide Dashboard
            </a>
          </div>
          <p style="font-size:12px;line-height:1.55;color:#888780;margin:18px 0 0;border-top:1px solid #EAEAEA;padding-top:18px;">
            Pentru întrebări sau ajutor, scrie-ne la <a href="mailto:office@kimonogroup.ro" style="color:#D85A30;font-weight:600;">office@kimonogroup.ro</a>.
          </p>
        </td></tr>
        <tr><td style="background:#FAFAF9;padding:18px 28px;border-top:1px solid #EAEAEA;font-size:11px;color:#888780;line-height:1.6;text-align:center;">
          <strong style="color:#0A0A0A;">Kimono BI</strong> · Operat de GLOBAL DISTRIBUTION CENTER SRL<br>
          <a href="${appUrl}" style="color:#888780;text-decoration:underline;">bi.kimonogroup.ro</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = `Sincronizarea pentru ${storeName} s-a încheiat.

Comenzi: ${fmt(counts.orders)}
Clienți: ${fmt(counts.customers)}
Produse: ${fmt(counts.products)}

Deschide dashboard: ${appUrl}/dashboard

Kimono BI`;

  await transporter.sendMail({
    from,
    to: toEmail,
    subject: `${storeName} e gata — ${fmt(counts.orders)} comenzi, ${fmt(counts.customers)} clienți importate`,
    html,
    text,
  });
  console.log(`[cron-sync] first-sync email sent to ${toEmail} for ${storeName}`);
}

async function main() {
  const ts = new Date().toISOString();
  console.log(`[cron-sync] ${ts} starting`);
  const force = process.argv.includes('--force');
  const storeIdArg = process.argv.find((a) => a.startsWith('--store='))?.split('=')[1];
  const stores = await prisma.storeConnection.findMany({
    where: storeIdArg ? { id: storeIdArg } : undefined,
  });
  const now = Date.now();
  for (const store of stores) {
    if (store.platform !== 'SHOPIFY') {
      console.log(`[${store.name}] skip (${store.platform})`);
      continue;
    }
    // Respect per-store interval unless forced or disabled (interval <= 0)
    const intervalMs = (store.syncIntervalMinutes ?? 60) * 60 * 1000;
    if (!force && intervalMs > 0 && store.lastSyncAt) {
      const sinceLast = now - new Date(store.lastSyncAt).getTime();
      if (sinceLast < intervalMs - 60 * 1000) {
        // -1min tolerance so cron at :15 still runs a store with 60min interval set at :16
        const remainingMin = Math.ceil((intervalMs - sinceLast) / 60000);
        console.log(`[${store.name}] skip (${remainingMin}min până la următorul sync, interval ${store.syncIntervalMinutes}m)`);
        continue;
      }
    }
    if (!force && store.syncIntervalMinutes !== null && store.syncIntervalMinutes !== undefined && store.syncIntervalMinutes <= 0) {
      console.log(`[${store.name}] skip (sync automat dezactivat)`);
      continue;
    }
    try {
      const r = await syncShopifyIncremental(store);
      console.log(`[${store.name}] ${r.customers}c ${r.orders}o ${r.products}p`);
    } catch (e) {
      console.error(`[${store.name}] FAILED: ${e.message}`);
      // Update lastSyncAt even on failure so UI shows recent attempt
      try {
        await prisma.storeConnection.update({
          where: { id: store.id },
          data: { lastSyncAt: new Date() },
        });
      } catch {}
    }
  }
  console.log(`[cron-sync] done`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
