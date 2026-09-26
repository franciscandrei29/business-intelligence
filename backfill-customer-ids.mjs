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

async function shopifyGraphQL(shop, token, query) {
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Shopify HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error('GraphQL errors: ' + JSON.stringify(json.errors));
  return json.data;
}

async function fetchOrderCustomerPairs(shop, token, cursor) {
  const afterClause = cursor ? `, after: "${cursor}"` : '';
  const query = `{
    orders(first: 100, sortKey: CREATED_AT, reverse: true${afterClause}) {
      edges {
        cursor
        node { id customer { id } }
      }
      pageInfo { hasNextPage }
    }
  }`;
  const data = await shopifyGraphQL(shop, token, query);
  return {
    pairs: data.orders.edges.map((e) => ({
      orderExternalId: e.node.id,
      customerExternalId: e.node.customer?.id || null,
    })),
    nextCursor: data.orders.edges.at(-1)?.cursor,
    hasNextPage: data.orders.pageInfo.hasNextPage,
  };
}

async function backfillStore(store) {
  if (store.platform !== 'SHOPIFY') {
    console.log(`[${store.name}] skip (${store.platform})`);
    return;
  }
  console.log(`[${store.name}] starting backfill...`);

  const token = decrypt(store.shopifyAccessToken);

  // Build customer externalId -> id map
  const customers = await prisma.customer.findMany({
    where: { storeConnectionId: store.id },
    select: { id: true, externalId: true },
  });
  const customerMap = new Map(customers.map((c) => [c.externalId, c.id]));
  console.log(`[${store.name}] ${customerMap.size} customers mapped`);

  let cursor;
  let totalUpdated = 0;
  let totalProcessed = 0;
  let batchNum = 0;

  do {
    const { pairs, nextCursor, hasNextPage } = await fetchOrderCustomerPairs(store.domain, token, cursor);
    batchNum++;

    const updates = [];
    for (const p of pairs) {
      totalProcessed++;
      if (!p.customerExternalId) continue;
      const customerId = customerMap.get(p.customerExternalId);
      if (!customerId) continue;
      updates.push(
        prisma.order.updateMany({
          where: { storeConnectionId: store.id, externalId: p.orderExternalId, customerId: null },
          data: { customerId },
        })
      );
    }
    const results = await Promise.all(updates);
    const updated = results.reduce((s, r) => s + r.count, 0);
    totalUpdated += updated;

    console.log(`[${store.name}] batch ${batchNum}: processed ${pairs.length}, updated ${updated} (cumulative ${totalUpdated}/${totalProcessed})`);

    cursor = hasNextPage ? nextCursor : null;
    await new Promise((r) => setTimeout(r, 600));
  } while (cursor);

  console.log(`[${store.name}] DONE — updated ${totalUpdated} of ${totalProcessed} orders`);
}

async function main() {
  const stores = await prisma.storeConnection.findMany();
  for (const store of stores) {
    try {
      await backfillStore(store);
    } catch (e) {
      console.error(`[${store.name}] FAILED:`, e.message);
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
