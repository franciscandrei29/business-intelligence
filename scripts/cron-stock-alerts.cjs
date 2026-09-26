#!/usr/bin/env node
// Stock Alerts — runs daily at 06:00
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

async function main() {
  const stores = await db.storeConnection.findMany({ where: { isActive: true } });
  for (const store of stores) {
    try {
      // Inline stock alert calculation
      const products = await db.product.findMany({
        where: { storeConnectionId: store.id, status: 'ACTIVE' },
        select: { externalId: true, title: true, inventory: true },
      });

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const orders = await db.order.findMany({
        where: { storeConnectionId: store.id, placedAt: { gte: thirtyDaysAgo } },
        select: { lineItems: true },
      });

      const salesByProduct = {};
      for (const order of orders) {
        if (!order.lineItems) continue;
        try {
          const items = JSON.parse(order.lineItems);
          for (const item of items) {
            const pid = item.productId || item.sku || '';
            if (pid) salesByProduct[pid] = (salesByProduct[pid] || 0) + (item.quantity || 0);
          }
        } catch {}
      }

      await db.stockAlert.deleteMany({ where: { storeConnectionId: store.id } });
      let alertCount = 0;

      for (const product of products) {
        const totalSold = salesByProduct[product.externalId] || 0;
        const velocity = totalSold / 30;
        if (velocity < 0.1) continue;  // Skip products with negligible sales

        const daysRemaining = product.inventory <= 0 ? 0 : velocity > 0 ? Math.floor(product.inventory / velocity) : 999;
        if (daysRemaining <= 30 || product.inventory <= 0) {
          await db.stockAlert.create({
            data: {
              storeConnectionId: store.id,
              productExternalId: product.externalId,
              productTitle: product.title,
              currentStock: product.inventory,
              velocityPerDay: Math.round(velocity * 100) / 100,
              daysRemaining,
              severity: daysRemaining === 0 ? 'critical' : daysRemaining <= 3 ? 'high' : 'medium',
            },
          });
          alertCount++;
        }
      }
      console.log(`[stock-alerts] Store ${store.name}: ${alertCount} alerts`);
    } catch (err) {
      console.error(`[stock-alerts] Error for store ${store.id}:`, err.message);
    }
  }
}

main().catch(console.error).finally(() => db.$disconnect());
