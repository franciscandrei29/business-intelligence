import { db } from '~/lib/db.server';

export interface NarrativeMetrics {
  store: { id: string; name: string; platform: string; domain: string };
  period: { weekStart: Date; weekEnd: Date; prevWeekStart: Date; prevWeekEnd: Date };
  revenue: {
    thisWeek: number;
    prevWeek: number;
    changePct: number;
    ordersThis: number;
    ordersPrev: number;
    aovThis: number;
    aovPrev: number;
  };
  customers: {
    newThis: number;
    newPrev: number;
    repeatThis: number;
    activeThis: number;
    atRisk: number;
    champions: number;
  };
  topProducts: Array<{ title: string; units: number; revenue: number }>;
  worstProducts: Array<{ title: string; inventory: number; lostRevenue: number }>;
  inventoryAlerts: Array<{ title: string; daysRemaining: number; severity: string }>;
  refunds: { count: number; amount: number; rate: number };
  trends: {
    byDay: Array<{ date: string; revenue: number; orders: number }>;
  };
  anomalies: Array<{ title: string; detectedAt: Date }>;
}

function fmtMoney(n: number): string {
  return `${Math.round(n).toLocaleString('ro-RO')} RON`;
}

export async function computeNarrativeMetrics(storeId: string): Promise<NarrativeMetrics> {
  const store = await db.storeConnection.findUniqueOrThrow({
    where: { id: storeId },
    select: { id: true, name: true, platform: true, domain: true },
  });

  const now = new Date();
  const weekEnd = now;
  const weekStart = new Date(now); weekStart.setDate(weekStart.getDate() - 7);
  const prevWeekStart = new Date(weekStart); prevWeekStart.setDate(prevWeekStart.getDate() - 7);
  const prevWeekEnd = new Date(weekStart);

  // Revenue both weeks
  const [thisWeekOrders, prevWeekOrders] = await Promise.all([
    db.order.findMany({
      where: { storeConnectionId: storeId, placedAt: { gte: weekStart, lte: weekEnd } },
      select: { total: true, placedAt: true, totalRefunded: true, lineItems: true, customerId: true },
      orderBy: { placedAt: 'asc' },
    }),
    db.order.findMany({
      where: { storeConnectionId: storeId, placedAt: { gte: prevWeekStart, lt: weekStart } },
      select: { total: true, customerId: true },
    }),
  ]);

  const revThis = thisWeekOrders.reduce((s, o) => s + Number(o.total), 0);
  const revPrev = prevWeekOrders.reduce((s, o) => s + Number(o.total), 0);
  const changePct = revPrev > 0 ? ((revThis - revPrev) / revPrev) * 100 : 0;
  const aovThis = thisWeekOrders.length > 0 ? revThis / thisWeekOrders.length : 0;
  const aovPrev = prevWeekOrders.length > 0 ? revPrev / prevWeekOrders.length : 0;

  // Customers: new this week (firstOrderAt in window) and repeat
  const [newThis, newPrev, repeatCount, totalActive, championsRow, atRiskRow] = await Promise.all([
    db.customer.count({ where: { storeConnectionId: storeId, firstOrderAt: { gte: weekStart, lte: weekEnd } } }),
    db.customer.count({ where: { storeConnectionId: storeId, firstOrderAt: { gte: prevWeekStart, lt: weekStart } } }),
    db.customer.count({ where: { storeConnectionId: storeId, ordersCount: { gte: 2 } } }),
    db.customer.count({ where: { storeConnectionId: storeId, ordersCount: { gte: 1 } } }),
    db.rfmSegment.count({ where: { storeConnectionId: storeId, segment: 'Champions' } }),
    db.rfmSegment.count({ where: { storeConnectionId: storeId, segment: { in: ['At Risk', 'Lost'] } } }),
  ]);

  // Top products this week (by units) with SKU fallback
  const products = await db.product.findMany({
    where: { storeConnectionId: storeId },
    select: { externalId: true, sku: true, title: true, inventory: true, price: true },
  });
  const skuMap = new Map<string, string>();
  const prodById = new Map<string, typeof products[0]>();
  for (const p of products) {
    prodById.set(p.externalId, p);
    if (p.sku) skuMap.set(p.sku, p.externalId);
  }
  const unitsThisWeek = new Map<string, { units: number; revenue: number; title: string }>();
  for (const o of thisWeekOrders) {
    if (!o.lineItems) continue;
    try {
      const items = JSON.parse(o.lineItems);
      for (const it of items) {
        let pid = String(it.product_id || it.productId || '');
        if (!pid && it.sku) pid = skuMap.get(String(it.sku)) || '';
        const title = it.title || it.name || prodById.get(pid)?.title || 'Necunoscut';
        const key = pid || title;
        const qty = Number(it.quantity || 1);
        const price = Number(it.price || it.sale_price || 0);
        const cur = unitsThisWeek.get(key) || { units: 0, revenue: 0, title };
        cur.units += qty;
        cur.revenue += qty * price;
        unitsThisWeek.set(key, cur);
      }
    } catch {}
  }
  const topProducts = [...unitsThisWeek.values()]
    .sort((a, b) => b.units - a.units)
    .slice(0, 8)
    .map((p) => ({ title: p.title, units: p.units, revenue: Math.round(p.revenue) }));

  // Worst products: out-of-stock with past sales history = probable lost revenue
  const d30 = new Date(now); d30.setDate(d30.getDate() - 30);
  const past30 = await db.order.findMany({
    where: { storeConnectionId: storeId, placedAt: { gte: d30 } },
    select: { lineItems: true },
  });
  const soldPerProd = new Map<string, number>();
  const revPerProd = new Map<string, { total: number; title: string }>();
  for (const o of past30) {
    if (!o.lineItems) continue;
    try {
      const items = JSON.parse(o.lineItems);
      for (const it of items) {
        let pid = String(it.product_id || it.productId || '');
        if (!pid && it.sku) pid = skuMap.get(String(it.sku)) || '';
        if (!pid) continue;
        const qty = Number(it.quantity || 1);
        const price = Number(it.price || it.sale_price || 0);
        soldPerProd.set(pid, (soldPerProd.get(pid) || 0) + qty);
        const cur = revPerProd.get(pid) || { total: 0, title: it.title || prodById.get(pid)?.title || '' };
        cur.total += qty * price;
        revPerProd.set(pid, cur);
      }
    } catch {}
  }
  const worstProducts = products
    .filter((p) => p.inventory <= 0 && soldPerProd.has(p.externalId))
    .map((p) => {
      const rev = revPerProd.get(p.externalId)?.total || 0;
      return { title: p.title, inventory: p.inventory, lostRevenue: Math.round(rev / 30 * 7) };
    })
    .sort((a, b) => b.lostRevenue - a.lostRevenue)
    .slice(0, 5);

  // Stock alerts (from StockAlert if any)
  const stockAlerts = await db.stockAlert.findMany({
    where: { storeConnectionId: storeId },
    orderBy: { daysRemaining: 'asc' },
    take: 5,
    select: { productTitle: true, daysRemaining: true, severity: true },
  });
  const inventoryAlerts = stockAlerts.map((a) => ({ title: a.productTitle, daysRemaining: a.daysRemaining, severity: a.severity }));

  // Refunds this week
  const refundedThisWeek = thisWeekOrders.filter((o) => Number(o.totalRefunded || 0) > 0);
  const refundAmount = refundedThisWeek.reduce((s, o) => s + Number(o.totalRefunded || 0), 0);
  const refundRate = thisWeekOrders.length > 0 ? (refundedThisWeek.length / thisWeekOrders.length) * 100 : 0;

  // By day trend (last 14 days)
  const d14 = new Date(now); d14.setDate(d14.getDate() - 14);
  const ordersDay = await db.order.findMany({
    where: { storeConnectionId: storeId, placedAt: { gte: d14 } },
    select: { placedAt: true, total: true },
  });
  const dayMap = new Map<string, { revenue: number; orders: number }>();
  for (let i = 0; i < 14; i++) {
    const d = new Date(now); d.setDate(d.getDate() - (13 - i));
    dayMap.set(d.toISOString().slice(0, 10), { revenue: 0, orders: 0 });
  }
  for (const o of ordersDay) {
    const k = o.placedAt.toISOString().slice(0, 10);
    const cur = dayMap.get(k);
    if (cur) { cur.revenue += Number(o.total); cur.orders += 1; }
  }
  const byDay = [...dayMap.entries()].map(([date, d]) => ({ date, revenue: Math.round(d.revenue), orders: d.orders }));

  // Anomalies
  const anomalyReports = await db.aiReport.findMany({
    where: { storeConnectionId: storeId, type: 'ANOMALY', createdAt: { gte: weekStart } },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { title: true, createdAt: true },
  });
  const anomalies = anomalyReports.map((a) => ({ title: a.title, detectedAt: a.createdAt }));

  return {
    store,
    period: { weekStart, weekEnd, prevWeekStart, prevWeekEnd },
    revenue: {
      thisWeek: Math.round(revThis),
      prevWeek: Math.round(revPrev),
      changePct: Math.round(changePct * 10) / 10,
      ordersThis: thisWeekOrders.length,
      ordersPrev: prevWeekOrders.length,
      aovThis: Math.round(aovThis * 100) / 100,
      aovPrev: Math.round(aovPrev * 100) / 100,
    },
    customers: {
      newThis,
      newPrev,
      repeatThis: repeatCount,
      activeThis: totalActive,
      atRisk: atRiskRow,
      champions: championsRow,
    },
    topProducts,
    worstProducts,
    inventoryAlerts,
    refunds: { count: refundedThisWeek.length, amount: Math.round(refundAmount), rate: Math.round(refundRate * 10) / 10 },
    trends: { byDay },
    anomalies,
  };
}
