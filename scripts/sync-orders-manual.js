#!/usr/bin/env node
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const db = new PrismaClient();

async function syncOrders() {
  const store = await db.storeConnection.findFirst();

  const key = Buffer.from(process.env.APP_ENCRYPTION_KEY, 'hex');
  const [ivH, tagH, ctH] = store.shopifyAccessToken.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivH, 'hex'));
  decipher.setAuthTag(Buffer.from(tagH, 'hex'));
  const token = decipher.update(Buffer.from(ctH, 'hex')) + decipher.final('utf8');

  const url = 'https://' + store.domain + '/admin/api/2025-04/graphql.json';
  const headers = { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token };

  let cursor = null;
  let total = 0;

  console.log('Starting orders sync for ' + store.name + '...');
  do {
    const afterClause = cursor ? `, after: "${cursor}"` : '';
    const query = `{ orders(first: 50${afterClause}) { edges { cursor node { id name createdAt totalPriceSet { shopMoney { amount currencyCode } } subtotalPriceSet { shopMoney { amount } } totalDiscountsSet { shopMoney { amount } } displayFinancialStatus displayFulfillmentStatus lineItems(first: 20) { edges { node { title quantity originalUnitPriceSet { shopMoney { amount } } sku } } } } } pageInfo { hasNextPage } } }`;

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ query }) });
    const json = await res.json();

    if (!json.data || !json.data.orders) {
      console.log('API error:', JSON.stringify(json.errors || json).substring(0, 300));
      break;
    }

    const edges = json.data.orders.edges;
    for (const e of edges) {
      const n = e.node;
      const lineItems = (n.lineItems?.edges || []).map(li => ({
        title: li.node.title, quantity: li.node.quantity,
        price: parseFloat(li.node.originalUnitPriceSet?.shopMoney?.amount || '0'),
        sku: li.node.sku
      }));
      const itemsCount = lineItems.reduce((s, li) => s + li.quantity, 0);

      await db.order.upsert({
        where: { storeConnectionId_externalId: { storeConnectionId: store.id, externalId: n.id } },
        create: {
          storeConnectionId: store.id, externalId: n.id, orderNumber: n.name,
          total: parseFloat(n.totalPriceSet?.shopMoney?.amount || '0'),
          subtotal: n.subtotalPriceSet?.shopMoney?.amount ? parseFloat(n.subtotalPriceSet.shopMoney.amount) : null,
          discountTotal: n.totalDiscountsSet?.shopMoney?.amount ? parseFloat(n.totalDiscountsSet.shopMoney.amount) : null,
          currency: n.totalPriceSet?.shopMoney?.currencyCode || 'RON',
          status: n.displayFinancialStatus || 'UNKNOWN',
          financialStatus: n.displayFinancialStatus || null,
          fulfillmentStatus: n.displayFulfillmentStatus || null,
          itemsCount, lineItems: JSON.stringify(lineItems),
          placedAt: new Date(n.createdAt),
        },
        update: {
          total: parseFloat(n.totalPriceSet?.shopMoney?.amount || '0'),
          status: n.displayFinancialStatus || 'UNKNOWN',
          itemsCount, lineItems: JSON.stringify(lineItems),
        },
      });
      cursor = e.cursor;
    }
    total += edges.length;
    console.log('Orders imported: ' + total);

    if (!json.data.orders.pageInfo.hasNextPage) break;
    await new Promise(r => setTimeout(r, 500));
  } while (true);

  console.log('Total orders synced: ' + total);
  await db.storeConnection.update({
    where: { id: store.id },
    data: { syncStatus: 'COMPLETED', lastSyncAt: new Date() },
  });
  console.log('Store marked COMPLETED');
}

syncOrders().catch(e => console.error('ERROR:', e.message)).finally(() => process.exit());
