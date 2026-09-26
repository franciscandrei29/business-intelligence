import { db } from '~/lib/db.server';

export interface RepeatAnalytics {
  totalCustomers: number;
  oneTimers: number;
  repeaters: number;
  repeatRate: number;
  avgDaysToSecondPurchase: number;
  medianDaysToSecondPurchase: number;
  revenueFromRepeat: number;
  revenueFromOneTime: number;
  repeatRevenuePercent: number;
  productsDriverRepeat: Array<{ title: string; repeatRate: number; totalBuyers: number; avgTimeTo2nd: number }>;
  repeatByMonth: Array<{ month: string; newCustomers: number; repeatedWithin90: number; rate: number }>;
}

export async function calculateRepeatPurchase(storeConnectionId: string): Promise<RepeatAnalytics> {
  const customers = await db.customer.findMany({
    where: { storeConnectionId, ordersCount: { gte: 1 } },
    select: { externalId: true, ordersCount: true, totalSpent: true, firstOrderAt: true, lastOrderAt: true },
  });

  const orders = await db.order.findMany({
    where: { storeConnectionId },
    select: { customerId: true, placedAt: true, total: true, lineItems: true },
    orderBy: { placedAt: 'asc' },
  });

  const totalCustomers = customers.length;
  const repeaters = customers.filter((c) => c.ordersCount >= 2);
  const oneTimers = customers.filter((c) => c.ordersCount === 1);
  const repeatRate = totalCustomers > 0 ? (repeaters.length / totalCustomers) * 100 : 0;

  // Revenue split
  const revenueFromRepeat = repeaters.reduce((s, c) => s + Number(c.totalSpent), 0);
  const revenueFromOneTime = oneTimers.reduce((s, c) => s + Number(c.totalSpent), 0);
  const totalRevenue = revenueFromRepeat + revenueFromOneTime;
  const repeatRevenuePercent = totalRevenue > 0 ? (revenueFromRepeat / totalRevenue) * 100 : 0;

  // Days to second purchase
  const daysToSecond: number[] = [];
  // Group orders by customer
  const customerOrders: Record<string, Date[]> = {};
  for (const o of orders) {
    if (!o.customerId) continue;
    if (!customerOrders[o.customerId]) customerOrders[o.customerId] = [];
    customerOrders[o.customerId].push(o.placedAt);
  }

  for (const [, dates] of Object.entries(customerOrders)) {
    if (dates.length >= 2) {
      const sorted = dates.sort((a, b) => a.getTime() - b.getTime());
      const gap = Math.floor((sorted[1].getTime() - sorted[0].getTime()) / (1000 * 60 * 60 * 24));
      if (gap > 0) daysToSecond.push(gap);
    }
  }

  daysToSecond.sort((a, b) => a - b);
  const avgDaysToSecond = daysToSecond.length > 0 ? daysToSecond.reduce((a, b) => a + b, 0) / daysToSecond.length : 0;
  const medianDaysToSecond = daysToSecond.length > 0 ? daysToSecond[Math.floor(daysToSecond.length / 2)] : 0;

  // Products that drive repeat purchases
  const productRepeat: Record<string, { title: string; buyers: Set<string>; repeatBuyers: Set<string>; gapDays: number[] }> = {};

  for (const order of orders) {
    if (!order.lineItems || !order.customerId) continue;
    const custOrderCount = customerOrders[order.customerId]?.length || 0;
    try {
      const items = JSON.parse(order.lineItems);
      for (const item of items) {
        const title = item.title || '';
        if (!title) continue;
        if (!productRepeat[title]) productRepeat[title] = { title, buyers: new Set(), repeatBuyers: new Set(), gapDays: [] };
        productRepeat[title].buyers.add(order.customerId);
        if (custOrderCount >= 2) {
          productRepeat[title].repeatBuyers.add(order.customerId);
        }
      }
    } catch {}
  }

  const productsDriverRepeat = Object.values(productRepeat)
    .filter((p) => p.buyers.size >= 5)
    .map((p) => ({
      title: p.title,
      totalBuyers: p.buyers.size,
      repeatRate: p.buyers.size > 0 ? Math.round((p.repeatBuyers.size / p.buyers.size) * 1000) / 10 : 0,
      avgTimeTo2nd: Math.round(avgDaysToSecond),
    }))
    .sort((a, b) => b.repeatRate - a.repeatRate)
    .slice(0, 15);

  // Repeat by cohort month (customers acquired in month X, how many repeat within 90 days)
  const cohortRepeat: Record<string, { newCustomers: number; repeated: number }> = {};
  for (const c of customers) {
    if (!c.firstOrderAt) continue;
    const month = c.firstOrderAt.toISOString().slice(0, 7);
    if (!cohortRepeat[month]) cohortRepeat[month] = { newCustomers: 0, repeated: 0 };
    cohortRepeat[month].newCustomers++;
    if (c.ordersCount >= 2 && c.lastOrderAt) {
      const daysBetween = Math.floor((c.lastOrderAt.getTime() - c.firstOrderAt.getTime()) / (1000 * 60 * 60 * 24));
      if (daysBetween <= 90) cohortRepeat[month].repeated++;
    }
  }

  const repeatByMonth = Object.entries(cohortRepeat)
    .map(([month, data]) => ({
      month,
      newCustomers: data.newCustomers,
      repeatedWithin90: data.repeated,
      rate: data.newCustomers > 0 ? Math.round((data.repeated / data.newCustomers) * 1000) / 10 : 0,
    }))
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-12);

  return {
    totalCustomers,
    oneTimers: oneTimers.length,
    repeaters: repeaters.length,
    repeatRate: Math.round(repeatRate * 10) / 10,
    avgDaysToSecondPurchase: Math.round(avgDaysToSecond),
    medianDaysToSecondPurchase: medianDaysToSecond,
    revenueFromRepeat: Math.round(revenueFromRepeat * 100) / 100,
    revenueFromOneTime: Math.round(revenueFromOneTime * 100) / 100,
    repeatRevenuePercent: Math.round(repeatRevenuePercent * 10) / 10,
    productsDriverRepeat,
    repeatByMonth,
  };
}
