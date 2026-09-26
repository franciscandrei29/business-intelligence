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

async function fetchReturns(shop, token, cursor) {
  const after = cursor ? `, after: "${cursor}"` : '';
  const query = `{
    orders(first: 50, sortKey: CREATED_AT, reverse: true, query: "return_status:return_requested OR return_status:in_progress OR return_status:returned"${after}) {
      edges {
        cursor
        node {
          id
          returns(first: 20) {
            edges {
              node {
                id
                status
                totalQuantity
                returnLineItems(first: 20) {
                  edges {
                    node {
                      id
                      quantity
                      returnReason
                      returnReasonNote
                    }
                  }
                }
              }
            }
          }
        }
      }
      pageInfo { hasNextPage }
    }
  }`;
  const data = await gql(shop, token, query);
  return {
    rows: data.orders.edges.map((e) => {
      const returns = e.node.returns.edges.map((re) => {
        const lineItems = re.node.returnLineItems.edges.map((li) => ({
          quantity: li.node.quantity,
          reason: li.node.returnReason,
          reasonNote: li.node.returnReasonNote,
        }));
        return {
          id: re.node.id,
          status: re.node.status,
          totalQuantity: re.node.totalQuantity,
          lineItems,
        };
      });
      const totalItems = returns.reduce((s, r) => s + (r.totalQuantity || 0), 0);
      return {
        externalId: e.node.id,
        count: returns.length,
        totalItems,
        items: returns,
      };
    }),
    nextCursor: data.orders.edges.at(-1)?.cursor,
    hasNextPage: data.orders.pageInfo.hasNextPage,
  };
}

async function backfillStore(store) {
  if (store.platform !== 'SHOPIFY') { console.log(`[${store.name}] skip (${store.platform})`); return; }
  const token = decrypt(store.shopifyAccessToken);

  console.log(`[${store.name}] fetching returns...`);
  let cursor, batch = 0, totalReturns = 0, ordersUpdated = 0;
  const MAX = 200;

  while (batch < MAX) {
    const { rows, nextCursor, hasNextPage } = await fetchReturns(store.domain, token, cursor);
    batch++;

    for (const r of rows) {
      if (r.count === 0) continue;
      await prisma.order.updateMany({
        where: { storeConnectionId: store.id, externalId: r.externalId },
        data: {
          returnsCount: r.count,
          returnItems: JSON.stringify(r.items),
        },
      });
      ordersUpdated++;
      totalReturns += r.count;
    }

    console.log(`[${store.name}] batch ${batch}: ${rows.length} orders scanned, ${ordersUpdated} cumulative with returns, ${totalReturns} returns total`);

    if (!hasNextPage) break;
    cursor = nextCursor;
    await new Promise((r) => setTimeout(r, 700));
  }

  console.log(`[${store.name}] DONE — ${ordersUpdated} orders have returns, ${totalReturns} returns total`);
}

async function main() {
  const stores = await prisma.storeConnection.findMany();
  for (const s of stores) {
    try { await backfillStore(s); } catch (e) { console.error(`[${s.name}] FAILED:`, e.message); }
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
