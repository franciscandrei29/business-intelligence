const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const db = new PrismaClient();

async function fix() {
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
  let updated = 0;

  console.log('Fixing eMag order-customer links...');
  do {
    const res = await fetch('https://marketplace-api.emag.ro/api-3/order/read', {
      method: 'POST',
      headers: { 'Authorization': 'Basic ' + auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPage: page, itemsPerPage: 100 }),
    });
    const json = await res.json();
    if (!json.results || json.results.length === 0) break;

    for (const order of json.results) {
      if (!order.customer?.id) continue;
      const custId = String(order.customer.id);
      const orderId = String(order.id);
      
      // Update the order with customerId
      const dbOrder = await db.order.findFirst({
        where: { storeConnectionId: store.id, externalId: orderId },
      });
      if (dbOrder && !dbOrder.customerId) {
        await db.order.update({
          where: { id: dbOrder.id },
          data: { customerId: custId },
        });
        updated++;
      }
    }
    
    console.log('Page ' + page + ': ' + updated + ' orders linked');
    page++;
    await new Promise(r => setTimeout(r, 1000));
  } while (true);

  // Now recalculate customer stats from linked orders
  const customers = await db.customer.findMany({ where: { storeConnectionId: store.id } });
  let statsUpdated = 0;
  for (const cust of customers) {
    const orders = await db.order.findMany({
      where: { storeConnectionId: store.id, customerId: cust.externalId },
      select: { total: true, placedAt: true },
      orderBy: { placedAt: 'asc' },
    });
    if (orders.length > 0) {
      const totalSpent = orders.reduce((s, o) => s + Number(o.total), 0);
      await db.customer.update({
        where: { id: cust.id },
        data: {
          ordersCount: orders.length,
          totalSpent: Math.round(totalSpent * 100) / 100,
          firstOrderAt: orders[0].placedAt,
          lastOrderAt: orders[orders.length - 1].placedAt,
        },
      });
      statsUpdated++;
    }
  }

  console.log('Done! ' + updated + ' orders linked, ' + statsUpdated + ' customer stats updated');
}

fix().catch(e => console.error(e.message)).finally(() => process.exit());
