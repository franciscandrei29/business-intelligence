import { db } from '~/lib/db.server';

export interface ProductProfitability {
  productId: string;
  title: string;
  sku: string | null;
  price: number;
  costPerUnit: number;
  margin: number; // absolute
  marginPercent: number;
  unitsSold: number;
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
}

export interface StoreProfitSummary {
  totalRevenue: number;
  totalCOGS: number;
  grossProfit: number;
  grossMarginPercent: number;
  productsWithCost: number;
  productsWithoutCost: number;
  topProfitable: ProductProfitability[];
  leastProfitable: ProductProfitability[];
}

export async function calculateProfitability(storeConnectionId: string): Promise<StoreProfitSummary> {
  // Get all products with their costs
  const products = await db.product.findMany({
    where: { storeConnectionId },
    select: { externalId: true, title: true, sku: true, price: true, costPerUnit: true },
  });

  // Also check ProductCost table for manual overrides
  const manualCosts = await db.productCost.findMany({
    where: { storeConnectionId },
  });
  const costMap = new Map(manualCosts.map((c) => [c.productExternalId, Number(c.costPerUnit)]));

  // Get orders with line items for last 12 months
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

  const orders = await db.order.findMany({
    where: { storeConnectionId, placedAt: { gte: twelveMonthsAgo } },
    select: { lineItems: true, total: true },
  });

  // Calculate sales per product
  const productSales: Record<string, { units: number; revenue: number }> = {};
  let totalRevenue = 0;

  for (const order of orders) {
    totalRevenue += Number(order.total);
    if (!order.lineItems) continue;
    try {
      const items = JSON.parse(order.lineItems);
      for (const item of items) {
        const pid = item.productId || '';
        if (!pid) continue;
        if (!productSales[pid]) productSales[pid] = { units: 0, revenue: 0 };
        productSales[pid].units += item.quantity || 0;
        productSales[pid].revenue += (item.price || 0) * (item.quantity || 0);
      }
    } catch {}
  }

  // Build profitability per product
  const profitData: ProductProfitability[] = [];
  let totalCOGS = 0;
  let productsWithCost = 0;
  let productsWithoutCost = 0;

  for (const product of products) {
    const sales = productSales[product.externalId];
    if (!sales || sales.units === 0) continue;

    const cost = costMap.get(product.externalId) ?? (product.costPerUnit ? Number(product.costPerUnit) : null);

    if (cost === null) {
      productsWithoutCost++;
      continue;
    }

    productsWithCost++;
    const price = Number(product.price);
    const margin = price - cost;
    const marginPercent = price > 0 ? (margin / price) * 100 : 0;
    const totalCost = cost * sales.units;
    const totalProfit = sales.revenue - totalCost;
    totalCOGS += totalCost;

    profitData.push({
      productId: product.externalId,
      title: product.title,
      sku: product.sku,
      price,
      costPerUnit: cost,
      margin: Math.round(margin * 100) / 100,
      marginPercent: Math.round(marginPercent * 10) / 10,
      unitsSold: sales.units,
      totalRevenue: Math.round(sales.revenue * 100) / 100,
      totalCost: Math.round(totalCost * 100) / 100,
      totalProfit: Math.round(totalProfit * 100) / 100,
    });
  }

  profitData.sort((a, b) => b.totalProfit - a.totalProfit);

  const grossProfit = totalRevenue - totalCOGS;
  const grossMarginPercent = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

  return {
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalCOGS: Math.round(totalCOGS * 100) / 100,
    grossProfit: Math.round(grossProfit * 100) / 100,
    grossMarginPercent: Math.round(grossMarginPercent * 10) / 10,
    productsWithCost,
    productsWithoutCost,
    topProfitable: profitData.slice(0, 10),
    leastProfitable: profitData.slice(-10).reverse(),
  };
}
