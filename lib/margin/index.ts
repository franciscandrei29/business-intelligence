import { db } from '~/lib/db.server';

export interface OrderMargin {
  orderId: string;
  orderNumber: string | null;
  date: Date;
  revenue: number;
  cogs: number;
  shipping: number;
  discounts: number;
  refunds: number;
  contributionMargin: number;
  marginPercent: number;
}

export interface MarginSummary {
  totalRevenue: number;
  totalCOGS: number;
  totalShipping: number;
  totalDiscounts: number;
  totalRefunds: number;
  totalContributionMargin: number;
  avgMarginPercent: number;
  ordersAnalyzed: number;
  negativeOrdersCount: number;
  negativeOrdersLoss: number;
  lowMarginCount: number;
  dailyMargins: Array<{ date: string; revenue: number; margin: number; marginPct: number }>;
  worstOrders: OrderMargin[];
  bestOrders: OrderMargin[];
  allOrders: OrderMargin[];
  coverage: { productsWithCost: number; productsTotal: number; costCoveragePct: number };
}

export async function calculateContributionMargin(storeConnectionId: string, days = 30): Promise<MarginSummary> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const orders = await db.order.findMany({
    where: { storeConnectionId, placedAt: { gte: since } },
    select: {
      id: true, orderNumber: true, total: true, subtotal: true,
      discountTotal: true, totalRefunded: true, lineItems: true, placedAt: true,
    },
    orderBy: { placedAt: 'desc' },
  });

  // Get product costs
  const productCosts = await db.productCost.findMany({ where: { storeConnectionId } });
  const costMap = new Map(productCosts.map((c) => [c.productExternalId, Number(c.costPerUnit)]));

  // Also get costs from products table + SKU map for lineItems that only carry SKU
  const products = await db.product.findMany({
    where: { storeConnectionId },
    select: { externalId: true, costPerUnit: true, sku: true },
  });
  const skuToExternalId = new Map<string, string>();
  for (const p of products) {
    if (p.costPerUnit && !costMap.has(p.externalId)) {
      costMap.set(p.externalId, Number(p.costPerUnit));
    }
    if (p.sku) skuToExternalId.set(p.sku, p.externalId);
  }

  let totalRevenue = 0, totalCOGS = 0, totalShipping = 0, totalDiscounts = 0, totalRefunds = 0;
  const orderMargins: OrderMargin[] = [];
  const dailyMap: Record<string, { revenue: number; margin: number }> = {};

  for (const order of orders) {
    const revenue = Number(order.total);
    const discounts = Number(order.discountTotal || 0);
    const refunds = Number(order.totalRefunded || 0);

    // Calculate COGS from line items
    let orderCOGS = 0;
    if (order.lineItems) {
      try {
        const items = JSON.parse(order.lineItems);
        for (const item of items) {
          let pid = String(item.product_id || item.productId || '');
          if (!pid && item.sku) pid = skuToExternalId.get(String(item.sku)) || '';
          const cost = pid ? costMap.get(pid) || 0 : 0;
          orderCOGS += cost * (item.quantity || 0);
        }
      } catch {}
    }

    // Estimate shipping as ~5% of subtotal if not tracked separately
    const shipping = revenue * 0.05;

    const contributionMargin = revenue - orderCOGS - shipping - discounts - refunds;
    const marginPercent = revenue > 0 ? (contributionMargin / revenue) * 100 : 0;

    totalRevenue += revenue;
    totalCOGS += orderCOGS;
    totalShipping += shipping;
    totalDiscounts += discounts;
    totalRefunds += refunds;

    orderMargins.push({
      orderId: order.id,
      orderNumber: order.orderNumber,
      date: order.placedAt,
      revenue: Math.round(revenue * 100) / 100,
      cogs: Math.round(orderCOGS * 100) / 100,
      shipping: Math.round(shipping * 100) / 100,
      discounts: Math.round(discounts * 100) / 100,
      refunds: Math.round(refunds * 100) / 100,
      contributionMargin: Math.round(contributionMargin * 100) / 100,
      marginPercent: Math.round(marginPercent * 10) / 10,
    });

    const dateStr = order.placedAt.toISOString().slice(0, 10);
    if (!dailyMap[dateStr]) dailyMap[dateStr] = { revenue: 0, margin: 0 };
    dailyMap[dateStr].revenue += revenue;
    dailyMap[dateStr].margin += contributionMargin;
  }

  const totalContribution = totalRevenue - totalCOGS - totalShipping - totalDiscounts - totalRefunds;
  const avgMarginPercent = totalRevenue > 0 ? (totalContribution / totalRevenue) * 100 : 0;

  const dailyMargins = Object.entries(dailyMap)
    .map(([date, d]) => ({
      date,
      revenue: Math.round(d.revenue * 100) / 100,
      margin: Math.round(d.margin * 100) / 100,
      marginPct: d.revenue > 0 ? Math.round((d.margin / d.revenue) * 1000) / 10 : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const sortedByMargin = [...orderMargins].sort((a, b) => a.contributionMargin - b.contributionMargin);

  const negativeOrders = orderMargins.filter((o) => o.contributionMargin < 0);
  const negativeOrdersLoss = negativeOrders.reduce((s, o) => s + o.contributionMargin, 0);
  const lowMargin = orderMargins.filter((o) => o.marginPercent < 15).length;

  const productsTotal = products.length;
  const productsWithCost = products.filter((p) => p.costPerUnit && Number(p.costPerUnit) > 0).length;
  const costCoveragePct = productsTotal > 0 ? (productsWithCost / productsTotal) * 100 : 0;

  return {
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalCOGS: Math.round(totalCOGS * 100) / 100,
    totalShipping: Math.round(totalShipping * 100) / 100,
    totalDiscounts: Math.round(totalDiscounts * 100) / 100,
    totalRefunds: Math.round(totalRefunds * 100) / 100,
    totalContributionMargin: Math.round(totalContribution * 100) / 100,
    avgMarginPercent: Math.round(avgMarginPercent * 10) / 10,
    ordersAnalyzed: orders.length,
    negativeOrdersCount: negativeOrders.length,
    negativeOrdersLoss: Math.round(negativeOrdersLoss * 100) / 100,
    lowMarginCount: lowMargin,
    dailyMargins,
    worstOrders: sortedByMargin.slice(0, 10),
    bestOrders: sortedByMargin.slice(-10).reverse(),
    allOrders: orderMargins,
    coverage: {
      productsWithCost,
      productsTotal,
      costCoveragePct: Math.round(costCoveragePct * 10) / 10,
    },
  };
}
