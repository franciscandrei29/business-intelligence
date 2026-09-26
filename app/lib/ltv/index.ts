import { db } from '~/lib/db.server';

export interface LtvByChannel {
  channel: string;
  customers: number;
  avgLtv: number;
  avgOrders: number;
  avgAov: number;
  paybackDays: number; // estimated days to recoup CAC
  ltv30: number;
  ltv60: number;
  ltv90: number;
  ltv365: number;
}

export interface LtvByProduct {
  productTitle: string;
  productId: string;
  customersWhoRepeat: number;
  totalCustomers: number;
  repeatRate: number;
  avgLtvOfBuyers: number;
}

export interface LtvResult {
  overallAvgLtv: number;
  overallMedianLtv: number;
  byChannel: LtvByChannel[];
  byProduct: LtvByProduct[];
  ltvDistribution: Array<{ bucket: string; count: number }>;
}

export async function calculateLtv(storeConnectionId: string): Promise<LtvResult> {
  const customers = await db.customer.findMany({
    where: { storeConnectionId, ordersCount: { gte: 1 } },
    select: { id: true, externalId: true, totalSpent: true, ordersCount: true, firstOrderAt: true, lastOrderAt: true, tags: true },
  });

  const orders = await db.order.findMany({
    where: { storeConnectionId },
    select: { customerId: true, total: true, placedAt: true, lineItems: true },
    orderBy: { placedAt: 'asc' },
  });

  if (customers.length === 0) {
    return { overallAvgLtv: 0, overallMedianLtv: 0, byChannel: [], byProduct: [], ltvDistribution: [] };
  }

  // Overall LTV
  const ltvValues = customers.map((c) => Number(c.totalSpent)).sort((a, b) => a - b);
  const overallAvgLtv = ltvValues.reduce((a, b) => a + b, 0) / ltvValues.length;
  const overallMedianLtv = ltvValues[Math.floor(ltvValues.length / 2)] || 0;

  // LTV distribution buckets
  const buckets = [
    { label: '0-50 RON', min: 0, max: 50 },
    { label: '50-100 RON', min: 50, max: 100 },
    { label: '100-250 RON', min: 100, max: 250 },
    { label: '250-500 RON', min: 250, max: 500 },
    { label: '500-1000 RON', min: 500, max: 1000 },
    { label: '1000+ RON', min: 1000, max: Infinity },
  ];
  const ltvDistribution = buckets.map((b) => ({
    bucket: b.label,
    count: ltvValues.filter((v) => v >= b.min && v < b.max).length,
  }));

  // LTV by channel (using customer tags or order source if available)
  // Since we don't have UTM data natively, we'll derive from tags or use "Direct" as default
  const channelMap: Record<string, { customers: Set<string>; totalSpent: number; totalOrders: number }> = {};

  for (const customer of customers) {
    // Try to determine channel from tags
    let channel = 'Direct';
    const tags = customer.tags || [];
    for (const tag of tags) {
      const lower = tag.toLowerCase();
      if (lower.includes('facebook') || lower.includes('meta') || lower.includes('fb')) channel = 'Meta/Facebook';
      else if (lower.includes('google') || lower.includes('gads')) channel = 'Google Ads';
      else if (lower.includes('email') || lower.includes('klaviyo') || lower.includes('mailchimp')) channel = 'Email';
      else if (lower.includes('organic') || lower.includes('seo')) channel = 'Organic';
      else if (lower.includes('tiktok')) channel = 'TikTok';
      else if (lower.includes('instagram')) channel = 'Instagram';
      else if (lower.includes('referral') || lower.includes('affiliate')) channel = 'Referral';
    }

    if (!channelMap[channel]) channelMap[channel] = { customers: new Set(), totalSpent: 0, totalOrders: 0 };
    channelMap[channel].customers.add(customer.externalId);
    channelMap[channel].totalSpent += Number(customer.totalSpent);
    channelMap[channel].totalOrders += customer.ordersCount;
  }

  const byChannel: LtvByChannel[] = Object.entries(channelMap).map(([channel, data]) => {
    const count = data.customers.size;
    const avgLtv = count > 0 ? data.totalSpent / count : 0;
    const avgOrders = count > 0 ? data.totalOrders / count : 0;
    const avgAov = data.totalOrders > 0 ? data.totalSpent / data.totalOrders : 0;

    // Rough LTV projections based on current spending patterns
    const dailyRate = avgLtv / 365;
    return {
      channel,
      customers: count,
      avgLtv: Math.round(avgLtv * 100) / 100,
      avgOrders: Math.round(avgOrders * 10) / 10,
      avgAov: Math.round(avgAov * 100) / 100,
      paybackDays: avgAov > 0 ? Math.round(avgAov / (dailyRate || 1)) : 999,
      ltv30: Math.round(dailyRate * 30 * 100) / 100,
      ltv60: Math.round(dailyRate * 60 * 100) / 100,
      ltv90: Math.round(dailyRate * 90 * 100) / 100,
      ltv365: Math.round(avgLtv * 100) / 100,
    };
  }).sort((a, b) => b.avgLtv - a.avgLtv);

  // LTV by product — which products drive repeat purchases
  const productBuyers: Record<string, { title: string; buyers: Set<string>; repeaters: Set<string> }> = {};

  // Map customer order counts
  const customerOrderCount: Record<string, number> = {};
  for (const c of customers) {
    customerOrderCount[c.id] = c.ordersCount;
  }

  for (const order of orders) {
    if (!order.lineItems || !order.customerId) continue;
    try {
      const items = JSON.parse(order.lineItems);
      for (const item of items) {
        const pid = item.productId || item.title || '';
        if (!pid) continue;
        if (!productBuyers[pid]) productBuyers[pid] = { title: item.title || pid, buyers: new Set(), repeaters: new Set() };
        productBuyers[pid].buyers.add(order.customerId);
        if ((customerOrderCount[order.customerId] || 0) > 1) {
          productBuyers[pid].repeaters.add(order.customerId);
        }
      }
    } catch {}
  }

  // Calculate LTV of buyers for each product
  const customerLtv: Record<string, number> = {};
  for (const c2 of customers) customerLtv[c2.id] = Number(c2.totalSpent);

  const byProduct: LtvByProduct[] = Object.entries(productBuyers)
    .map(([pid, data]) => {
      const buyerLtvs = [...data.buyers].map((cid) => customerLtv[cid] || 0);
      const avgLtv = buyerLtvs.length > 0 ? buyerLtvs.reduce((a, b) => a + b, 0) / buyerLtvs.length : 0;
      return {
        productTitle: data.title,
        productId: pid,
        totalCustomers: data.buyers.size,
        customersWhoRepeat: data.repeaters.size,
        repeatRate: data.buyers.size > 0 ? Math.round((data.repeaters.size / data.buyers.size) * 1000) / 10 : 0,
        avgLtvOfBuyers: Math.round(avgLtv * 100) / 100,
      };
    })
    .filter((p) => p.totalCustomers >= 3)
    .sort((a, b) => b.avgLtvOfBuyers - a.avgLtvOfBuyers)
    .slice(0, 20);

  return { overallAvgLtv: Math.round(overallAvgLtv * 100) / 100, overallMedianLtv: Math.round(overallMedianLtv * 100) / 100, byChannel, byProduct, ltvDistribution };
}
