#!/usr/bin/env node
// cron-margin-daily.js — Zilnic 07:30
// Calculeaza contribution margin per zi pentru ultimele 7 zile
// si salveaza in DailyMargin pentru incarcare instant

const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

async function computeDailyMargins(storeConnectionId) {
  // Recalculam ultimele 7 zile (overlap pt siguranta)
  const since = new Date(); since.setDate(since.getDate() - 7); since.setHours(0, 0, 0, 0);
  const until = new Date(); until.setHours(23, 59, 59, 999);

  const [orders, productCosts, products] = await Promise.all([
    db.order.findMany({
      where: { storeConnectionId, placedAt: { gte: since, lte: until } },
      select: {
        id: true, orderNumber: true, total: true, subtotal: true,
        discountTotal: true, totalRefunded: true, lineItems: true, placedAt: true,
      },
      orderBy: { placedAt: 'asc' },
    }),
    db.productCost.findMany({ where: { storeConnectionId } }),
    db.product.findMany({
      where: { storeConnectionId },
      select: { externalId: true, costPerUnit: true, sku: true },
    }),
  ]);

  const costMap = new Map(productCosts.map((c) => [c.productExternalId, Number(c.costPerUnit)]));
  const skuToExternalId = new Map();
  for (const p of products) {
    if (p.costPerUnit && !costMap.has(p.externalId)) costMap.set(p.externalId, Number(p.costPerUnit));
    if (p.sku) skuToExternalId.set(p.sku, p.externalId);
  }

  // Grupeaza pe zile
  const byDay = new Map();

  for (const order of orders) {
    const dayKey = order.placedAt.toISOString().slice(0, 10);
    if (!byDay.has(dayKey)) byDay.set(dayKey, { revenue: 0, cogs: 0, discounts: 0, refunds: 0, count: 0 });
    const day = byDay.get(dayKey);

    const revenue = Number(order.total);
    const discounts = Number(order.discountTotal || 0);
    const refunds = Number(order.totalRefunded || 0);

    let orderCOGS = 0;
    if (order.lineItems) {
      try {
        const items = JSON.parse(order.lineItems);
        for (const item of items) {
          let pid = String(item.product_id || item.productId || '');
          if (!costMap.has(pid) && item.sku) {
            const extId = skuToExternalId.get(item.sku);
            if (extId) pid = extId;
          }
          const cost = costMap.get(pid) || 0;
          orderCOGS += cost * (item.quantity || 1);
        }
      } catch {}
    }

    day.revenue += revenue;
    day.cogs += orderCOGS;
    day.discounts += discounts;
    day.refunds += refunds;
    day.count += 1;
  }

  let upsertCount = 0;
  for (const [dayKey, day] of byDay.entries()) {
    const margin = day.revenue - day.cogs - day.discounts - day.refunds;
    const marginPct = day.revenue > 0 ? (margin / day.revenue) * 100 : 0;

    await db.dailyMargin.upsert({
      where: {
        storeConnectionId_date: {
          storeConnectionId,
          date: new Date(dayKey + 'T00:00:00.000Z'),
        },
      },
      create: {
        storeConnectionId,
        date: new Date(dayKey + 'T00:00:00.000Z'),
        revenue: Math.round(day.revenue * 100) / 100,
        cogs: Math.round(day.cogs * 100) / 100,
        margin: Math.round(margin * 100) / 100,
        marginPct: Math.round(marginPct * 100) / 100,
        ordersCount: day.count,
      },
      update: {
        revenue: Math.round(day.revenue * 100) / 100,
        cogs: Math.round(day.cogs * 100) / 100,
        margin: Math.round(margin * 100) / 100,
        marginPct: Math.round(marginPct * 100) / 100,
        ordersCount: day.count,
        calculatedAt: new Date(),
      },
    });
    upsertCount++;
  }

  return { days: upsertCount, totalRevenue: [...byDay.values()].reduce((s, d) => s + d.revenue, 0) };
}

async function main() {
  console.log(`[${new Date().toISOString()}] cron-margin-daily started`);
  const stores = await db.storeConnection.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });

  for (const store of stores) {
    try {
      const result = await computeDailyMargins(store.id);
      console.log(`  Store "${store.name}": ${result.days} zile procesate, revenue total ${Math.round(result.totalRevenue)} RON`);
    } catch (err) {
      console.error(`  Error for store "${store.name}":`, err.message);
    }
  }

  console.log(`[${new Date().toISOString()}] cron-margin-daily finished`);
}

main()
  .catch((e) => { console.error('cron-margin-daily fatal error:', e); process.exit(1); })
  .finally(() => db.$disconnect());
