import { db } from '~/lib/db.server';

/**
 * Builds a rich, pre-computed data snapshot for Ask AI.
 * All metrics are pre-calculated so GPT just reads and reports.
 */
export async function buildStoreContext(storeId: string): Promise<string> {
  const now = new Date();
  const d7 = new Date(now.getTime() - 7 * 86400000);
  const d14 = new Date(now.getTime() - 14 * 86400000);
  const d30 = new Date(now.getTime() - 30 * 86400000);
  const d90 = new Date(now.getTime() - 90 * 86400000);
  const d180 = new Date(now.getTime() - 180 * 86400000);
  const d365 = new Date(now.getTime() - 365 * 86400000);
  const ieri = new Date(now); ieri.setDate(ieri.getDate() - 1); ieri.setHours(0, 0, 0, 0);
  const azi = new Date(now); azi.setHours(0, 0, 0, 0);
  const alaltaieri = new Date(now); alaltaieri.setDate(alaltaieri.getDate() - 2); alaltaieri.setHours(0, 0, 0, 0);

  const store = await db.storeConnection.findUnique({
    where: { id: storeId },
    select: { name: true, platform: true, domain: true },
  });
  if (!store) return '';

  const L: string[] = [];
  const fmt = (n: number) => n.toLocaleString('ro-RO');

  // ── COUNTS ──
  const [prodTotal, ordTotal, custTotal, prodActive] = await Promise.all([
    db.product.count({ where: { storeConnectionId: storeId } }),
    db.order.count({ where: { storeConnectionId: storeId } }),
    db.customer.count({ where: { storeConnectionId: storeId } }),
    db.product.count({ where: { storeConnectionId: storeId, status: 'ACTIVE' } }),
  ]);
  const prodInactive = prodTotal - prodActive;

  // ── REVENUE PER PERIOD ──
  const periods: Record<string, { orders: number; revenue: number }> = {};
  for (const [label, since] of [['7d', d7], ['30d', d30], ['90d', d90], ['180d', d180], ['365d', d365]] as const) {
    const a = await db.order.aggregate({
      where: { storeConnectionId: storeId, placedAt: { gte: since } },
      _count: true, _sum: { total: true, totalRefunded: true },
    });
    periods[label] = { orders: a._count, revenue: Math.round(Number(a._sum.total || 0) - Number(a._sum.totalRefunded || 0)) };
  }
  const aov30 = periods['30d'].orders > 0 ? Math.round(periods['30d'].revenue / periods['30d'].orders) : 0;
  const aov90 = periods['90d'].orders > 0 ? Math.round(periods['90d'].revenue / periods['90d'].orders) : 0;
  const avgDailyRev = Math.round(periods['7d'].revenue / 7);
  const avgDailyOrd = Math.round(periods['7d'].orders / 7);

  // ── YESTERDAY / TODAY ──
  const ieriAgg = await db.order.aggregate({ where: { storeConnectionId: storeId, placedAt: { gte: ieri, lt: azi } }, _count: true, _sum: { total: true } });
  const aziAgg = await db.order.aggregate({ where: { storeConnectionId: storeId, placedAt: { gte: azi } }, _count: true, _sum: { total: true } });
  const alaltaieriAgg = await db.order.aggregate({ where: { storeConnectionId: storeId, placedAt: { gte: alaltaieri, lt: ieri } }, _count: true, _sum: { total: true } });

  // ── WEEK TREND ──
  const twRev = periods['7d'].revenue;
  const lwAgg = await db.order.aggregate({ where: { storeConnectionId: storeId, placedAt: { gte: d14, lt: d7 } }, _count: true, _sum: { total: true, totalRefunded: true } });
  const lwRev = Math.round(Number(lwAgg._sum.total || 0) - Number(lwAgg._sum.totalRefunded || 0));
  const weekDelta = lwRev > 0 ? Math.round(((twRev - lwRev) / lwRev) * 100) : 0;

  // ── NEW CUSTOMERS ──
  const newCust: Record<string, number> = {};
  for (const [l, s] of [['30d', d30], ['90d', d90], ['180d', d180]] as const) {
    newCust[l] = await db.customer.count({ where: { storeConnectionId: storeId, firstOrderAt: { gte: s } } });
  }

  // ── REPEAT BUYERS ──
  const buyerData: Record<string, { oneTime: number; repeat: number; repeatPct: string }> = {};
  for (const [l, s] of [['30d', d30], ['90d', d90]] as const) {
    try {
      const cg = await db.order.groupBy({ by: ['customerId'], where: { storeConnectionId: storeId, placedAt: { gte: s }, customerId: { not: null } }, _count: true });
      const ot = cg.filter(c => c._count === 1).length;
      const rp = cg.filter(c => c._count > 1).length;
      const total = ot + rp;
      buyerData[l] = { oneTime: ot, repeat: rp, repeatPct: total > 0 ? ((rp / total) * 100).toFixed(1) : '0' };
    } catch { buyerData[l] = { oneTime: 0, repeat: 0, repeatPct: '0' }; }
  }

  // ── RFM ──
  let rfmLines: string[] = [];
  try {
    const rfm = await db.rfmSegment.groupBy({ by: ['segment'], where: { storeConnectionId: storeId }, _count: true });
    rfm.sort((a, b) => b._count - a._count);
    rfmLines = rfm.map(s => `${s.segment}: ${fmt(s._count)} clienti`);
  } catch { }

  // ── REFUNDS ──
  const refTotal = await db.order.count({ where: { storeConnectionId: storeId, placedAt: { gte: d90 } } });
  const refCount = await db.order.count({ where: { storeConnectionId: storeId, placedAt: { gte: d90 }, totalRefunded: { gt: 0 } } });
  const refAgg = await db.order.aggregate({ where: { storeConnectionId: storeId, placedAt: { gte: d90 }, totalRefunded: { gt: 0 } }, _sum: { totalRefunded: true } });
  const refAmount = Math.round(Number(refAgg._sum.totalRefunded || 0));
  const refRate = refTotal > 0 ? ((refCount / refTotal) * 100).toFixed(1) : '0';
  const refAvg = refCount > 0 ? Math.round(refAmount / refCount) : 0;

  // ── MARGIN ──
  let marginLines: string[] = [];
  try {
    const md = await db.dailyMargin.findMany({ where: { storeConnectionId: storeId }, orderBy: { date: 'desc' }, take: 30, select: { date: true, revenue: true, cogs: true, margin: true, marginPct: true } });
    if (md.length > 0) {
      const tR = md.reduce((s, d) => s + Number(d.revenue), 0);
      const tC = md.reduce((s, d) => s + Number(d.cogs), 0);
      const tM = md.reduce((s, d) => s + Number(d.margin), 0);
      const avgPct = tR > 0 ? ((tM / tR) * 100).toFixed(1) : '0';
      marginLines.push(`Perioada: ultimele ${md.length} zile cu date`);
      marginLines.push(`Venit total: ${fmt(Math.round(tR))} RON`);
      marginLines.push(`Cost produse (COGS): ${fmt(Math.round(tC))} RON`);
      marginLines.push(`Marja bruta: ${fmt(Math.round(tM))} RON (${avgPct}%)`);
      marginLines.push(`Profit mediu per zi: ${fmt(Math.round(tM / md.length))} RON`);
      marginLines.push('Ultimele 3 zile:');
      md.slice(0, 3).forEach(d => {
        marginLines.push(`  ${d.date.toISOString().slice(0, 10)}: venit ${fmt(Math.round(Number(d.revenue)))}, cost ${fmt(Math.round(Number(d.cogs)))}, marja ${fmt(Math.round(Number(d.margin)))} RON (${Number(d.marginPct).toFixed(1)}%)`);
      });
    }
  } catch { }

  // ── TOP CUSTOMERS ──
  let topCustLines: string[] = [];
  try {
    const tc = await db.customer.findMany({ where: { storeConnectionId: storeId, ordersCount: { gt: 0 } }, orderBy: { totalSpent: 'desc' }, take: 10, select: { firstName: true, lastName: true, email: true, ordersCount: true, totalSpent: true } });
    const topTotal = tc.reduce((s, c) => s + Number(c.totalSpent), 0);
    const topPctOfYear = periods['365d'].revenue > 0 ? ((topTotal / periods['365d'].revenue) * 100).toFixed(1) : '0';
    topCustLines.push(`Top 10 clienti = ${fmt(Math.round(topTotal))} RON (${topPctOfYear}% din venitul anual)`);
    tc.forEach((c, i) => {
      const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Anonim';
      topCustLines.push(`  ${i + 1}. ${name}: ${c.ordersCount} comenzi, ${fmt(Math.round(Number(c.totalSpent)))} RON`);
    });
  } catch { }

  // ── DOW ──
  let dowLines: string[] = [];
  try {
    const o90 = await db.order.findMany({ where: { storeConnectionId: storeId, placedAt: { gte: d90 } }, select: { placedAt: true, total: true, totalRefunded: true } });
    const dn = ['Duminica', 'Luni', 'Marti', 'Miercuri', 'Joi', 'Vineri', 'Sambata'];
    const dm: Record<number, { o: number; r: number }> = {};
    for (const o of o90) { const d = o.placedAt.getDay(); if (!dm[d]) dm[d] = { o: 0, r: 0 }; dm[d].o++; dm[d].r += Number(o.total) - Number(o.totalRefunded || 0); }
    const sorted = Object.entries(dm).sort((a, b) => b[1].r - a[1].r);
    dowLines.push(`Cea mai buna zi: ${dn[Number(sorted[0][0])]} (${sorted[0][1].o} comenzi, ${fmt(Math.round(sorted[0][1].r))} RON)`);
    dowLines.push(`Cea mai slaba zi: ${dn[Number(sorted[sorted.length - 1][0])]} (${sorted[sorted.length - 1][1].o} comenzi, ${fmt(Math.round(sorted[sorted.length - 1][1].r))} RON)`);
    sorted.forEach(([d, v]) => dowLines.push(`  ${dn[Number(d)]}: ${v.o} comenzi, ${fmt(Math.round(v.r))} RON`));
  } catch { }

  // ── DISCOUNTS ──
  let discountLines: string[] = [];
  try {
    const dc = await db.order.groupBy({ by: ['discountCode'], where: { storeConnectionId: storeId, placedAt: { gte: d90 }, discountCode: { not: null } }, _count: true, _sum: { total: true }, orderBy: { _count: { discountCode: 'desc' } }, take: 5 });
    const valid = dc.filter(d => d.discountCode?.trim());
    valid.forEach(d => discountLines.push(`${d.discountCode}: ${d._count} utilizari, ${fmt(Math.round(Number(d._sum.total || 0)))} RON`));
  } catch { }

  // ── STOCK ──
  let stockLines: string[] = [];
  try {
    const sa = await db.stockAlert.findMany({ where: { storeConnectionId: storeId }, orderBy: { daysRemaining: 'asc' }, take: 10, select: { productTitle: true, daysRemaining: true, severity: true, currentStock: true } });
    const outOfStock = sa.filter(a => a.currentStock === 0);
    stockLines.push(`Produse cu stoc 0: ${outOfStock.length} produse critice`);
    sa.forEach(a => stockLines.push(`  ${a.productTitle}: ${a.currentStock} buc, ${a.daysRemaining} zile ramase (${a.severity})`));
  } catch { }

  // ── TOP PRODUCTS ──
  let topProdLines: string[] = [];
  try {
    const tp = await db.product.findMany({ where: { storeConnectionId: storeId, status: 'ACTIVE' }, orderBy: { price: 'desc' }, take: 10, select: { title: true, price: true, inventory: true } });
    tp.forEach((p, i) => topProdLines.push(`  ${i + 1}. ${p.title}: ${fmt(Number(p.price))} RON (stoc: ${p.inventory})`));
  } catch { }

  // ── DAILY 7 DAYS ──
  let dailyLines: string[] = [];
  try {
    const zile = ['Duminica', 'Luni', 'Marti', 'Miercuri', 'Joi', 'Vineri', 'Sambata'];
    for (let i = 6; i >= 0; i--) {
      const ds = new Date(now); ds.setDate(ds.getDate() - i); ds.setHours(0, 0, 0, 0);
      const de = new Date(ds); de.setDate(de.getDate() + 1);
      const a = await db.order.aggregate({ where: { storeConnectionId: storeId, placedAt: { gte: ds, lt: de } }, _count: true, _sum: { total: true, totalRefunded: true } });
      const r = Math.round(Number(a._sum.total || 0) - Number(a._sum.totalRefunded || 0));
      const lbl = i === 0 ? 'Azi' : i === 1 ? 'Ieri' : ds.toISOString().slice(0, 10);
      dailyLines.push(`${lbl} (${zile[ds.getDay()]}): ${a._count} comenzi, ${fmt(r)} RON`);
    }
  } catch { }

  // ── LTV estimate ──
  const ltv = custTotal > 0 ? Math.round(periods['365d'].revenue / custTotal) : 0;
  const ltvActive = newCust['90d'] > 0 ? Math.round(periods['90d'].revenue / newCust['90d']) : 0;

  // ── BUILD OUTPUT ──
  L.push(`MAGAZIN: ${store.name} (${store.domain}) | Data: ${now.toISOString().slice(0, 10)}`);
  L.push('');
  L.push(`SUMAR: ${fmt(prodTotal)} produse (${fmt(prodActive)} active, ${fmt(prodInactive)} inactive), ${fmt(ordTotal)} comenzi totale, ${fmt(custTotal)} clienti`);
  L.push('');
  L.push('VANZARI:');
  L.push(`  Azi: ${aziAgg._count} comenzi, ${fmt(Math.round(Number(aziAgg._sum.total || 0)))} RON`);
  L.push(`  Ieri: ${ieriAgg._count} comenzi, ${fmt(Math.round(Number(ieriAgg._sum.total || 0)))} RON`);
  L.push(`  Alaltaieri: ${alaltaieriAgg._count} comenzi, ${fmt(Math.round(Number(alaltaieriAgg._sum.total || 0)))} RON`);
  L.push(`  Ultimele 7 zile: ${fmt(periods['7d'].orders)} comenzi, ${fmt(periods['7d'].revenue)} RON (medie ${fmt(avgDailyOrd)} comenzi/zi, ${fmt(avgDailyRev)} RON/zi)`);
  L.push(`  Ultimele 30 zile: ${fmt(periods['30d'].orders)} comenzi, ${fmt(periods['30d'].revenue)} RON`);
  L.push(`  Ultimele 90 zile: ${fmt(periods['90d'].orders)} comenzi, ${fmt(periods['90d'].revenue)} RON`);
  L.push(`  Ultimele 180 zile: ${fmt(periods['180d'].orders)} comenzi, ${fmt(periods['180d'].revenue)} RON`);
  L.push(`  Ultimul an: ${fmt(periods['365d'].orders)} comenzi, ${fmt(periods['365d'].revenue)} RON`);
  L.push(`  Trend saptamanal: ${weekDelta >= 0 ? '+' : ''}${weekDelta}% fata de saptamana trecuta (${fmt(twRev)} vs ${fmt(lwRev)} RON)`);
  L.push('');
  L.push(`AOV (valoare medie comanda): ${fmt(aov30)} RON (30d) | ${fmt(aov90)} RON (90d)`);
  L.push(`LTV estimat (venit per client): ${fmt(ltv)} RON (anual) | ${fmt(ltvActive)} RON (90d per client nou)`);
  L.push('');
  L.push(`CLIENTI NOI: ${fmt(newCust['30d'])} (30d) | ${fmt(newCust['90d'])} (90d) | ${fmt(newCust['180d'])} (180d)`);
  L.push(`REPEAT BUYERS 30d: ${fmt(buyerData['30d'].repeat)} repeat din ${fmt(buyerData['30d'].oneTime + buyerData['30d'].repeat)} (${buyerData['30d'].repeatPct}%)`);
  L.push(`REPEAT BUYERS 90d: ${fmt(buyerData['90d'].repeat)} repeat din ${fmt(buyerData['90d'].oneTime + buyerData['90d'].repeat)} (${buyerData['90d'].repeatPct}%)`);
  L.push('');
  if (rfmLines.length) { L.push('SEGMENTE RFM:'); rfmLines.forEach(l => L.push(`  ${l}`)); L.push(''); }
  L.push(`RETURURI (90d): ${refCount} din ${fmt(refTotal)} comenzi (${refRate}%), total ${fmt(refAmount)} RON, medie ${fmt(refAvg)} RON per retur`);
  L.push('');
  if (marginLines.length) { L.push('PROFIT SI MARJA:'); marginLines.forEach(l => L.push(`  ${l}`)); L.push(''); }
  if (topCustLines.length) { L.push('TOP CLIENTI:'); topCustLines.forEach(l => L.push(`  ${l}`)); L.push(''); }

  // ── Top selling products (by quantity from lineItems) ──
  try {
    const recentOrders = await db.order.findMany({
      where: { storeConnectionId: storeId, placedAt: { gte: d90 }, lineItems: { not: null } },
      select: { lineItems: true },
    });
    const salesMap: Record<string, { title: string; qty: number; revenue: number }> = {};
    for (const o of recentOrders) {
      try {
        const items = JSON.parse(o.lineItems as string);
        for (const item of items) {
          const pid = String(item.product_id || item.productId || '');
          const title = item.title || item.name || 'Unknown';
          const qty = item.quantity || 1;
          const price = parseFloat(item.price || '0') * qty;
          if (!pid) continue;
          if (!salesMap[pid]) salesMap[pid] = { title, qty: 0, revenue: 0 };
          salesMap[pid].qty += qty;
          salesMap[pid].revenue += price;
        }
      } catch {}
    }
    const topSales = Object.values(salesMap).sort((a, b) => b.qty - a.qty).slice(0, 15);
    if (topSales.length > 0) {
      L.push('TOP 15 PRODUSE VANDUTE (90 ZILE, DUPA CANTITATE):');
      topSales.forEach((p, i) => L.push('  ' + (i + 1) + '. ' + p.title + ': ' + p.qty + ' buc vandute, ' + Math.round(p.revenue) + ' RON'));
      L.push('');
    }
  } catch { /* skip */ }

  if (topProdLines.length) { L.push('CELE MAI SCUMPE PRODUSE:'); topProdLines.forEach(l => L.push(l)); L.push(''); }
  if (dowLines.length) { L.push('PERFORMANTA PE ZILE (90d):'); dowLines.forEach(l => L.push(`  ${l}`)); L.push(''); }
  if (discountLines.length) { L.push('CODURI DISCOUNT (90d):'); discountLines.forEach(l => L.push(`  ${l}`)); L.push(''); }
  if (stockLines.length) { L.push('STOC:'); stockLines.forEach(l => L.push(`  ${l}`)); L.push(''); }
  if (dailyLines.length) { L.push('VANZARI PE ZILE (ULTIMELE 7):'); dailyLines.forEach(l => L.push(`  ${l}`)); L.push(''); }


  // ── Monthly breakdown (12 months) ──
  try {
    L.push('VANZARI LUNARE (12 LUNI):');
    const months: string[] = ['Ian','Feb','Mar','Apr','Mai','Iun','Iul','Aug','Sep','Oct','Nov','Dec'];
    let bestMonth = { label: '', rev: 0 };
    let worstMonth = { label: '', rev: Infinity };
    for (let i = 11; i >= 0; i--) {
      const ms = new Date(now); ms.setMonth(ms.getMonth() - i); ms.setDate(1); ms.setHours(0, 0, 0, 0);
      const me = new Date(ms); me.setMonth(me.getMonth() + 1);
      const ma = await db.order.aggregate({
        where: { storeConnectionId: storeId, placedAt: { gte: ms, lt: me } },
        _count: true, _sum: { total: true, totalRefunded: true },
      });
      const rev = Math.round(Number(ma._sum.total || 0) - Number(ma._sum.totalRefunded || 0));
      const label = `${months[ms.getMonth()]} ${ms.getFullYear()}`;
      L.push(`  ${label}: ${ma._count} comenzi, ${rev.toLocaleString('ro-RO')} RON`);
      if (rev > bestMonth.rev) bestMonth = { label, rev };
      if (rev < worstMonth.rev && ma._count > 0) worstMonth = { label, rev };
    }
    L.push(`  Cea mai buna luna: ${bestMonth.label} (${bestMonth.rev.toLocaleString('ro-RO')} RON)`);
    L.push(`  Cea mai slaba luna: ${worstMonth.label} (${worstMonth.rev.toLocaleString('ro-RO')} RON)`);
    L.push('');
  } catch { /* skip */ }

  // ── Best / Worst days in last 365 days ──
  try {
    const allOrders = await db.order.findMany({
      where: { storeConnectionId: storeId, placedAt: { gte: d365 } },
      select: { placedAt: true, total: true, totalRefunded: true },
    });
    const dayMap: Record<string, { orders: number; revenue: number }> = {};
    const zileSapt = ['Dum', 'Lun', 'Mar', 'Mie', 'Joi', 'Vin', 'Sam'];
    for (const o of allOrders) {
      const d = o.placedAt.toISOString().slice(0, 10);
      if (!dayMap[d]) dayMap[d] = { orders: 0, revenue: 0 };
      dayMap[d].orders++;
      dayMap[d].revenue += Number(o.total) - Number(o.totalRefunded || 0);
    }
    const sorted = Object.entries(dayMap).sort((a, b) => a[1].revenue - b[1].revenue);
    // Exclude today (incomplete)
    const todayStr = now.toISOString().slice(0, 10);
    const filtered = sorted.filter(([d]) => d !== todayStr);

    // Per current year (2026)
    const currentYear = now.getFullYear();
    const thisYearDays = filtered.filter(([d]) => d.startsWith(String(currentYear)));
    const thisYearSorted = thisYearDays.sort((a, b) => a[1].revenue - b[1].revenue);

    if (thisYearSorted.length > 0) {
      L.push(`CELE MAI BUNE ZILE DIN ${currentYear}:`);
      thisYearSorted.slice(-5).reverse().forEach(([d, v]) => {
        const dow = zileSapt[new Date(d).getDay()];
        L.push(`  ${d} (${dow}): ${v.orders} comenzi, ${Math.round(v.revenue).toLocaleString('ro-RO')} RON`);
      });
      L.push('');

      L.push(`CELE MAI SLABE ZILE DIN ${currentYear}:`);
      thisYearSorted.slice(0, 5).forEach(([d, v]) => {
        const dow = zileSapt[new Date(d).getDay()];
        L.push(`  ${d} (${dow}): ${v.orders} comenzi, ${Math.round(v.revenue).toLocaleString('ro-RO')} RON`);
      });
      L.push('');
    }

    L.push('TOP 5 CELE MAI BUNE ZILE (ULTIMUL AN):');
    filtered.slice(-5).reverse().forEach(([d, v]) => {
      const dow = zileSapt[new Date(d).getDay()];
      L.push(`  ${d} (${dow}): ${v.orders} comenzi, ${Math.round(v.revenue).toLocaleString('ro-RO')} RON`);
    });
    L.push('');

    L.push('TOP 5 CELE MAI SLABE ZILE (ULTIMUL AN):');
    filtered.slice(0, 5).forEach(([d, v]) => {
      const dow = zileSapt[new Date(d).getDay()];
      L.push(`  ${d} (${dow}): ${v.orders} comenzi, ${Math.round(v.revenue).toLocaleString('ro-RO')} RON`);
    });
    L.push('');
  } catch { /* skip */ }

  return L.join('\n');
}
