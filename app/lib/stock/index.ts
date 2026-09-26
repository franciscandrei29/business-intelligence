import { db } from '~/lib/db.server';

export async function calculateStockAlerts(storeConnectionId: string, thresholdDays = 30) {
  const products = await db.product.findMany({
    where: { storeConnectionId, status: 'ACTIVE' },
    select: { externalId: true, title: true, inventory: true, price: true },
  });

  // Get orders from last 90 days
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const fifteenDaysAgo = new Date();
  fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);

  const recentOrders = await db.order.findMany({
    where: { storeConnectionId, placedAt: { gte: ninetyDaysAgo } },
    select: { lineItems: true, placedAt: true },
  });

  // Calculate sales per product in different windows
  const salesData: Record<string, {
    last90: number;
    last30: number;
    last15: number;
    lastSaleDate: Date;
  }> = {};

  for (const order of recentOrders) {
    if (!order.lineItems) continue;
    try {
      const items = JSON.parse(order.lineItems);
      for (const item of items) {
        const pid = item.productId || item.sku || '';
        if (!pid) continue;
        const qty = item.quantity || 0;

        if (!salesData[pid]) {
          salesData[pid] = { last90: 0, last30: 0, last15: 0, lastSaleDate: order.placedAt };
        }

        salesData[pid].last90 += qty;
        if (order.placedAt >= thirtyDaysAgo) salesData[pid].last30 += qty;
        if (order.placedAt >= fifteenDaysAgo) salesData[pid].last15 += qty;
        if (order.placedAt > salesData[pid].lastSaleDate) {
          salesData[pid].lastSaleDate = order.placedAt;
        }
      }
    } catch {}
  }

  await db.stockAlert.deleteMany({ where: { storeConnectionId } });

  const alerts: Array<{
    productExternalId: string;
    productTitle: string;
    currentStock: number;
    velocityPerDay: number;
    daysRemaining: number;
    severity: string;
  }> = [];

  const now = Date.now();

  for (const product of products) {
    const data = salesData[product.externalId];

    // Skip products with zero sales in 90 days — truly inactive
    if (!data || data.last90 === 0) continue;

    const daysSinceLastSale = Math.floor((now - data.lastSaleDate.getTime()) / (1000 * 60 * 60 * 24));

    // Skip products that haven't sold in 60+ days
    if (daysSinceLastSale > 60) continue;

    // Calculate velocity (use best available window)
    const velocity30 = data.last30 / 30;
    const velocity15 = data.last15 / 15;

    // Use the higher velocity (if sales are accelerating, predict faster depletion)
    const velocityPerDay = Math.max(velocity30, velocity15);

    if (velocityPerDay === 0) continue;

    // Detect acceleration: last 15 days selling faster than previous 15 days
    const prev15Sales = data.last30 - data.last15;
    const prev15Velocity = prev15Sales / 15;
    const isAccelerating = velocity15 > prev15Velocity * 1.5 && data.last15 >= 3;

    // Calculate days remaining
    let daysRemaining: number;
    if (product.inventory <= 0) {
      daysRemaining = 0;
    } else {
      daysRemaining = Math.floor(product.inventory / velocityPerDay);
    }

    // Determine severity
    let severity: string;
    if (product.inventory <= 0 && daysSinceLastSale <= 30) {
      // Out of stock AND was selling recently — urgent
      severity = 'critical';
    } else if (product.inventory <= 0) {
      // Out of stock, sold 30-60 days ago — less urgent but still notable
      severity = 'high';
    } else if (daysRemaining <= 7) {
      severity = 'critical';
    } else if (daysRemaining <= 14 || (daysRemaining <= 21 && isAccelerating)) {
      severity = 'high';
    } else if (daysRemaining <= 30) {
      severity = 'medium';
    } else {
      continue; // > 30 days of stock, no alert needed
    }

    // Add extra info for accelerating products
    let title = product.title;

    alerts.push({
      productExternalId: product.externalId,
      productTitle: title,
      currentStock: product.inventory,
      velocityPerDay: Math.round(velocityPerDay * 100) / 100,
      daysRemaining,
      severity,
    });
  }

  const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2 };
  alerts.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9) || a.daysRemaining - b.daysRemaining);

  // Limit to top 100 most urgent
  const topAlerts = alerts.slice(0, 100);

  for (const alert of topAlerts) {
    await db.stockAlert.create({
      data: { storeConnectionId, ...alert },
    });
  }

  return topAlerts;
}
