const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const db = new PrismaClient();

async function extractCustomers() {
  const store = await db.storeConnection.findFirst({ where: { platform: 'EMAG' } });
  if (!store) { console.log('No eMag store'); return; }
  
  const key = Buffer.from(process.env.APP_ENCRYPTION_KEY, 'hex');
  const [ivH, tagH, ctH] = store.wooConsumerKey.split(':');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivH,'hex'));
  d.setAuthTag(Buffer.from(tagH,'hex'));
  const apiKey = d.update(Buffer.from(ctH,'hex')) + d.final('utf8');
  
  const [ivH2, tagH2, ctH2] = store.wooConsumerSecret.split(':');
  const d2 = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivH2,'hex'));
  d2.setAuthTag(Buffer.from(tagH2,'hex'));
  const apiSecret = d2.update(Buffer.from(ctH2,'hex')) + d2.final('utf8');
  
  const auth = Buffer.from(apiKey + ':' + apiSecret).toString('base64');
  let page = 1;
  let totalCustomers = 0;
  const seen = new Set();

  console.log('Extracting customers from eMag orders...');
  do {
    const res = await fetch('https://marketplace-api.emag.ro/api-3/order/read', {
      method: 'POST',
      headers: { 'Authorization': 'Basic ' + auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPage: page, itemsPerPage: 100 }),
    });
    const json = await res.json();
    if (!json.results || json.results.length === 0) break;

    for (const order of json.results) {
      const c = order.customer;
      if (!c || !c.id || seen.has(String(c.id))) continue;
      seen.add(String(c.id));

      await db.customer.upsert({
        where: { storeConnectionId_externalId: { storeConnectionId: store.id, externalId: String(c.id) } },
        create: {
          storeConnectionId: store.id,
          externalId: String(c.id),
          email: c.email || null,
          firstName: c.name ? c.name.split(' ')[0] : null,
          lastName: c.name ? c.name.split(' ').slice(1).join(' ') : null,
          phone: c.phone_1 || null,
          totalSpent: 0,
          ordersCount: 0,
        },
        update: {
          email: c.email || undefined,
          firstName: c.name ? c.name.split(' ')[0] : undefined,
          lastName: c.name ? c.name.split(' ').slice(1).join(' ') : undefined,
          phone: c.phone_1 || undefined,
        },
      });
      totalCustomers++;
    }
    
    console.log('Page ' + page + ': ' + totalCustomers + ' customers extracted');
    page++;
    await new Promise(r => setTimeout(r, 1000));
  } while (true);

  // Update order counts and total spent from orders
  const customers = await db.customer.findMany({ where: { storeConnectionId: store.id } });
  for (const cust of customers) {
    const orders = await db.order.findMany({
      where: { storeConnectionId: store.id, customerId: cust.externalId },
      select: { total: true, placedAt: true },
    });
    if (orders.length > 0) {
      const totalSpent = orders.reduce((s, o) => s + Number(o.total), 0);
      const dates = orders.map(o => o.placedAt).sort((a, b) => a.getTime() - b.getTime());
      await db.customer.update({
        where: { id: cust.id },
        data: {
          ordersCount: orders.length,
          totalSpent: Math.round(totalSpent * 100) / 100,
          firstOrderAt: dates[0],
          lastOrderAt: dates[dates.length - 1],
        },
      });
    }
  }

  console.log('Done! Total customers: ' + totalCustomers);
}

extractCustomers().catch(e => console.error(e.message)).finally(() => process.exit());
