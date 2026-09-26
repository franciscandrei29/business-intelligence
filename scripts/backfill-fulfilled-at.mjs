import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();
const ALGORITHM = 'aes-256-gcm';

function decrypt(data) {
  const [ivHex, tagHex, ciphertextHex] = data.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const key = Buffer.from(process.env.APP_ENCRYPTION_KEY, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}

const API_VERSION = '2025-04';

async function gql(shop, token, query) {
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

async function fetchFulfillmentDates(shop, token, cursor) {
  const after = cursor ? `, after: "${cursor}"` : '';
  const query = `{
    orders(first: 100, sortKey: CREATED_AT, reverse: true, query: "fulfillment_status:fulfilled"${after}) {
      edges {
        cursor
        node {
          id
          fulfillments(first: 1) {
            createdAt
          }
        }
      }
      pageInfo { hasNextPage }
    }
  }`;
  const data = await gql(shop, token, query);
  return {
    pairs: data.orders.edges.map((e) => ({
      externalId: e.node.id,
      fulfilledAt: e.node.fulfillments?.[0]?.createdAt || null,
    })),
    nextCursor: data.orders.edges.at(-1)?.cursor,
    hasNextPage: data.orders.pageInfo.hasNextPage,
  };
}

async function backfillStore(store) {
  if (store.platform !== 'SHOPIFY') { console.log(`[${store.name}] skip (${store.platform})`); return; }
  const token = decrypt(store.shopifyAccessToken);

  console.log(`[${store.name}] starting fulfilledAt backfill...`);
  let cursor;
  let total = 0;
  let updated = 0;
  let batch = 0;
  const MAX_BATCHES = 200; // safety cap

  while (batch < MAX_BATCHES) {
    const { pairs, nextCursor, hasNextPage } = await fetchFulfillmentDates(store.domain, token, cursor);
    batch++;

    // Serial updates to keep PG connections low (was Promise.all — saturated pool)
    let batchUpdated = 0;
    for (const p of pairs) {
      if (!p.fulfilledAt) continue;
      const r = await prisma.order.updateMany({
        where: { storeConnectionId: store.id, externalId: p.externalId, fulfilledAt: null },
        data: { fulfilledAt: new Date(p.fulfilledAt) },
      });
      batchUpdated += r.count;
    }
    total += pairs.length;
    updated += batchUpdated;

    console.log(`[${store.name}] batch ${batch}: ${pairs.length} fetched, ${batchUpdated} updated (cumulative ${updated}/${total})`);

    if (!hasNextPage) break;
    cursor = nextCursor;
    await new Promise((r) => setTimeout(r, 600));
  }

  console.log(`[${store.name}] DONE — updated ${updated} of ${total} fulfilled orders`);
}

async function main() {
  const stores = await prisma.storeConnection.findMany();
  for (const s of stores) {
    try { await backfillStore(s); } catch (e) { console.error(`[${s.name}] FAILED:`, e.message); }
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
