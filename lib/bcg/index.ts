import { db } from '~/lib/db.server';

export interface BcgProduct {
  externalId: string;
  title: string;
  vendor: string | null;
  price: number;
  costPerUnit: number | null;
  revenue: number;
  revenueGrowth: number;
  margin: number;
  category: 'Stars' | 'Cash Cows' | 'Question Marks' | 'Dogs';
}

export interface BcgResult {
  products: BcgProduct[];
  quadrants: Record<string, { count: number; revenue: number }>;
  medianGrowth: number;
  medianMargin: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function calculateBcg(storeConnectionId: string): Promise<BcgResult> {
  const now = new Date();
  const d90 = new Date(now); d90.setDate(d90.getDate() - 90);
  const d30 = new Date(now); d30.setDate(d30.getDate() - 30);
  const d60 = new Date(now); d60.setDate(d60.getDate() - 60);

  const products = await db.product.findMany({
    where: { storeConnectionId, status: 'active' },
    select: { externalId: true, title: true, vendor: true, price: true, costPerUnit: true, sku: true },
  });

  // Build SKU -> externalId map for fallback matching when lineItems lack productId
  const skuToExternalId = new Map<string, string>();
  for (const p of products) {
    if (p.sku) skuToExternalId.set(p.sku, p.externalId);
  }

  const orders90 = await db.order.findMany({
    where: { storeConnectionId, placedAt: { gte: d90 } },
    select: { lineItems: true, placedAt: true },
  });

  // Calculate revenue per product for different periods
  const revenueLast30: Record<string, number> = {};
  const revenuePrev30: Record<string, number> = {};
  const revenueAll90: Record<string, number> = {};

  for (const order of orders90) {
    if (!order.lineItems) continue;
    let items: any[];
    try { items = JSON.parse(order.lineItems); } catch { continue; }
    const orderDate = new Date(order.placedAt);

    for (const item of items) {
      let pid = String(item.product_id || item.productId || item.externalId || '');
      if (!pid && item.sku) pid = skuToExternalId.get(String(item.sku)) || '';
      const qty = Number(item.quantity || 1);
      const price = Number(item.price || item.sale_price || 0);
      const rev = qty * price;
      if (!pid) continue;

      revenueAll90[pid] = (revenueAll90[pid] || 0) + rev;
      if (orderDate >= d30) {
        revenueLast30[pid] = (revenueLast30[pid] || 0) + rev;
      } else if (orderDate >= d60) {
        revenuePrev30[pid] = (revenuePrev30[pid] || 0) + rev;
      }
    }
  }

  const bcgProducts: BcgProduct[] = [];

  for (const p of products) {
    const revenue = revenueAll90[p.externalId] || 0;
    if (revenue === 0) continue;

    const last30 = revenueLast30[p.externalId] || 0;
    const prev30 = revenuePrev30[p.externalId] || 0;
    const growth = prev30 > 0 ? ((last30 - prev30) / prev30) * 100 : (last30 > 0 ? 100 : 0);

    const cost = p.costPerUnit ? Number(p.costPerUnit) : 0;
    const price = Number(p.price);
    const margin = price > 0 ? ((price - cost) / price) * 100 : 0;

    bcgProducts.push({
      externalId: p.externalId,
      title: p.title,
      vendor: p.vendor,
      price,
      costPerUnit: cost || null,
      revenue,
      revenueGrowth: Math.round(growth * 10) / 10,
      margin: Math.round(margin * 10) / 10,
      category: 'Dogs', // placeholder, classified below
    });
  }

  const growths = bcgProducts.map((p) => p.revenueGrowth);
  const margins = bcgProducts.map((p) => p.margin);
  const medianGrowth = median(growths);
  const medianMargin = median(margins);

  for (const p of bcgProducts) {
    const highGrowth = p.revenueGrowth >= medianGrowth;
    const highMargin = p.margin >= medianMargin;
    if (highGrowth && highMargin) p.category = 'Stars';
    else if (!highGrowth && highMargin) p.category = 'Cash Cows';
    else if (highGrowth && !highMargin) p.category = 'Question Marks';
    else p.category = 'Dogs';
  }

  const quadrants: Record<string, { count: number; revenue: number }> = {
    Stars: { count: 0, revenue: 0 },
    'Cash Cows': { count: 0, revenue: 0 },
    'Question Marks': { count: 0, revenue: 0 },
    Dogs: { count: 0, revenue: 0 },
  };

  for (const p of bcgProducts) {
    quadrants[p.category].count++;
    quadrants[p.category].revenue += p.revenue;
  }

  bcgProducts.sort((a, b) => {
    const order = { Stars: 0, 'Cash Cows': 1, 'Question Marks': 2, Dogs: 3 };
    return (order[a.category] - order[b.category]) || (b.revenue - a.revenue);
  });

  return { products: bcgProducts, quadrants, medianGrowth, medianMargin };
}
