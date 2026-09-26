/**
 * Backfill refunds from Shopify (captures cancellations + partial refunds).
 * Filters orders by financial_status to avoid scanning everything.
 */
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

function decrypt(data) {
  const [iv, tag, ct] = data.split(':').map((h) => Buffer.from(h, 'hex'));
  const key = Buffer.from(process.env.APP_ENCRYPTION_KEY, 'hex');
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return d.update(ct) + d.final('utf8');
}

const API_VERSION = '2025-04';

async function gql(shop, token, query) {
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors).slice(0, 300));
  return json.data;
}

async function backfillStore(store) {
  if (store.platform !== 'SHOPIFY') { console.log(`[${store.name}] skip (${store.platform})`); return; }
  const token = decrypt(store.shopifyAccessToken);
  console.log(`[${store.name}] fetching orders with refunds/cancellations...`);

  let cursor, batch = 0, totalMatches = 0, updated = 0;
  while (batch < 200) {
    const after = cursor ? `, after: "${cursor}"` : '';
    // Query orders that are refunded/partially_refunded OR cancelled
    const q = `{
      orders(first: 100, sortKey: CREATED_AT, reverse: true, query: "financial_status:refunded OR financial_status:partially_refunded OR status:cancelled"${after}) {
        edges {
          cursor
          node {
            id
            totalRefundedSet { shopMoney { amount } }
            cancelledAt
            cancelReason
            refunds {
              id
              createdAt
              note
              totalRefundedSet { shopMoney { amount } }
              refundLineItems(first: 10) {
                edges { node { quantity restocked restockType lineItem { title sku } } }
              }
            }
          }
        }
        pageInfo { hasNextPage }
      }
    }`;
    const data = await gql(store.domain, token, q);
    batch++;
    const rows = data.orders.edges;
    totalMatches += rows.length;

    for (const e of rows) {
      const n = e.node;
      const totalRefunded = parseFloat(n.totalRefundedSet?.shopMoney?.amount || '0');
      const refunds = (n.refunds || []).map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        note: r.note,
        amount: parseFloat(r.totalRefundedSet?.shopMoney?.amount || '0'),
        items: (r.refundLineItems?.edges || []).map((le) => ({
          quantity: le.node.quantity,
          restocked: le.node.restocked,
          restockType: le.node.restockType,
          title: le.node.lineItem?.title,
          sku: le.node.lineItem?.sku,
        })),
      }));

      const res = await prisma.order.updateMany({
        where: { storeConnectionId: store.id, externalId: n.id },
        data: {
          totalRefunded,
          returnsCount: refunds.length,
          returnItems: refunds.length > 0 ? JSON.stringify({ type: 'refunds', cancelledAt: n.cancelledAt, cancelReason: n.cancelReason, refunds }) : null,
        },
      });
      updated += res.count;
    }

    console.log(`[${store.name}] batch ${batch}: ${rows.length} matches, cumulative ${updated} updated`);

    if (!data.orders.pageInfo.hasNextPage) break;
    cursor = rows.at(-1)?.cursor;
    await new Promise((r) => setTimeout(r, 600));
  }

  console.log(`[${store.name}] DONE — ${updated} orders updated (${totalMatches} matches found)`);
}

async function main() {
  const stores = await prisma.storeConnection.findMany();
  for (const s of stores) {
    try { await backfillStore(s); }
    catch (e) { console.error(`[${s.name}] FAILED:`, e.message); }
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
