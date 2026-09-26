const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const db = new PrismaClient();

async function syncCustomers() {
  const store = await db.storeConnection.findFirst();

  const key = Buffer.from(process.env.APP_ENCRYPTION_KEY, 'hex');
  const [ivH, tagH, ctH] = store.shopifyAccessToken.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivH, 'hex'));
  decipher.setAuthTag(Buffer.from(tagH, 'hex'));
  const token = decipher.update(Buffer.from(ctH, 'hex')) + decipher.final('utf8');

  const url = 'https://' + store.domain + '/admin/api/2025-04/graphql.json';
  const headers = { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token };

  // Test if read_customers scope works
  console.log('Testing read_customers scope...');
  const testRes = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ query: '{ customers(first: 1) { edges { node { id email } } } }' }) });
  const testJson = await testRes.json();
  if (testJson.errors?.some(e => e.extensions?.code === 'ACCESS_DENIED')) {
    console.log('ERROR: read_customers scope not available. Add it in Shopify Admin > Settings > Apps > Your app > Configuration > Admin API access scopes');
    return;
  }
  console.log('read_customers scope OK!');

  let cursor = null;
  let total = 0;

  console.log('Starting customers sync for ' + store.name + '...');
  do {
    const afterClause = cursor ? `, after: "${cursor}"` : '';
    const query = `{ customers(first: 50${afterClause}) { edges { cursor node { id email firstName lastName phone amountSpent { amount } numberOfOrders firstOrder: orders(first: 1, sortKey: CREATED_AT) { edges { node { createdAt } } } lastOrder: orders(first: 1, sortKey: CREATED_AT, reverse: true) { edges { node { createdAt } } } tags } } pageInfo { hasNextPage } } }`;

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ query }) });
    const json = await res.json();

    if (json.errors?.some(e => e.extensions?.code === 'THROTTLED')) {
      console.log('Throttled, waiting 5s...');
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }

    if (!json.data || !json.data.customers) {
      console.log('API error:', JSON.stringify(json.errors || json).substring(0, 300));
      break;
    }

    const edges = json.data.customers.edges;
    for (const e of edges) {
      const n = e.node;
      const firstOrderDate = n.firstOrder?.edges[0]?.node?.createdAt;
      const lastOrderDate = n.lastOrder?.edges[0]?.node?.createdAt;

      await db.customer.upsert({
        where: { storeConnectionId_externalId: { storeConnectionId: store.id, externalId: n.id } },
        create: {
          storeConnectionId: store.id, externalId: n.id,
          email: n.email || null, firstName: n.firstName || null, lastName: n.lastName || null,
          phone: n.phone || null, totalSpent: parseFloat(n.amountSpent?.amount || '0'),
          ordersCount: parseInt(n.numberOfOrders || '0', 10),
          firstOrderAt: firstOrderDate ? new Date(firstOrderDate) : null,
          lastOrderAt: lastOrderDate ? new Date(lastOrderDate) : null,
          tags: n.tags || [],
        },
        update: {
          email: n.email || null, firstName: n.firstName || null, lastName: n.lastName || null,
          phone: n.phone || null, totalSpent: parseFloat(n.amountSpent?.amount || '0'),
          ordersCount: parseInt(n.numberOfOrders || '0', 10),
          firstOrderAt: firstOrderDate ? new Date(firstOrderDate) : null,
          lastOrderAt: lastOrderDate ? new Date(lastOrderDate) : null,
          tags: n.tags || [],
        },
      });
      cursor = e.cursor;
    }
    total += edges.length;
    console.log('Customers imported: ' + total);

    if (!json.data.customers.pageInfo.hasNextPage) break;
    await new Promise(r => setTimeout(r, 2000));
  } while (true);

  console.log('Total customers synced: ' + total);
}

syncCustomers().catch(e => console.error('ERROR:', e.message)).finally(() => process.exit());
