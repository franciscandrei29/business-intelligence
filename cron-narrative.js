#!/usr/bin/env node
// cron-narrative.js - Luni 01:00 - Pre-genereaza raportul saptamanal AI cu GPT-4o
require('dotenv').config({ path: '/root/business-intelligence-kimono-nu-seo/.env' });
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

async function computeWeeklyMetrics(storeId) {
  const now = new Date();
  const weekStart = new Date(now); weekStart.setDate(weekStart.getDate() - 7);
  const prevWeekStart = new Date(weekStart); prevWeekStart.setDate(prevWeekStart.getDate() - 7);

  const [thisWeekOrders, prevWeekOrders, newThisWeek, newPrevWeek, champions, atRisk, stockAlerts, rfmCounts] = await Promise.all([
    db.order.findMany({ where: { storeConnectionId: storeId, placedAt: { gte: weekStart, lte: now } }, select: { total: true, placedAt: true, totalRefunded: true, lineItems: true }, orderBy: { placedAt: 'asc' } }),
    db.order.findMany({ where: { storeConnectionId: storeId, placedAt: { gte: prevWeekStart, lt: weekStart } }, select: { total: true } }),
    db.customer.count({ where: { storeConnectionId: storeId, firstOrderAt: { gte: weekStart, lte: now } } }),
    db.customer.count({ where: { storeConnectionId: storeId, firstOrderAt: { gte: prevWeekStart, lt: weekStart } } }),
    db.rfmSegment.count({ where: { storeConnectionId: storeId, segment: 'Champions' } }),
    db.rfmSegment.count({ where: { storeConnectionId: storeId, segment: { in: ['At Risk', 'Lost'] } } }),
    db.stockAlert.findMany({ where: { storeConnectionId: storeId, severity: { in: ['critical', 'high'] } }, take: 5 }),
    db.rfmSegment.groupBy({ by: ['segment'], where: { storeConnectionId: storeId }, _count: { segment: true } }),
  ]);

  const revThis = thisWeekOrders.reduce((s, o) => s + Number(o.total), 0);
  const revPrev = prevWeekOrders.reduce((s, o) => s + Number(o.total), 0);
  const changePct = revPrev > 0 ? ((revThis - revPrev) / revPrev) * 100 : 0;
  const refundOrders = thisWeekOrders.filter((o) => Number(o.totalRefunded || 0) > 0);
  const productSales = new Map();
  for (const order of thisWeekOrders) {
    if (!order.lineItems) continue;
    try {
      const items = JSON.parse(order.lineItems);
      for (const item of items) {
        const pid = item.product_id || item.productId || item.title;
        const ex = productSales.get(pid) || { title: item.title || 'Produs', units: 0, revenue: 0 };
        ex.units += item.quantity || 1;
        ex.revenue += (item.price || 0) * (item.quantity || 1);
        productSales.set(pid, ex);
      }
    } catch (e) {}
  }
  const topProducts = [...productSales.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  const byDay = {};
  for (let d = new Date(weekStart); d <= now; d.setDate(d.getDate() + 1)) {
    byDay[d.toISOString().slice(0, 10)] = { revenue: 0, orders: 0 };
  }
  for (const o of thisWeekOrders) {
    const k = o.placedAt.toISOString().slice(0, 10);
    if (byDay[k]) { byDay[k].revenue += Number(o.total); byDay[k].orders++; }
  }

  return {
    weekStart: weekStart.toLocaleDateString('ro-RO'),
    weekEnd: now.toLocaleDateString('ro-RO'),
    revenue: { thisWeek: revThis, prevWeek: revPrev, changePct, aov: thisWeekOrders.length > 0 ? revThis / thisWeekOrders.length : 0, orders: thisWeekOrders.length, ordersPrev: prevWeekOrders.length },
    customers: { newThis: newThisWeek, newPrev: newPrevWeek, champions, atRisk },
    rfm: rfmCounts.map((r) => ({ segment: r.segment, count: r._count.segment })),
    topProducts,
    stockAlerts: stockAlerts.map((a) => ({ title: a.productTitle, daysRemaining: a.daysRemaining, severity: a.severity })),
    refunds: { count: refundOrders.length, amount: refundOrders.reduce((s, o) => s + Number(o.totalRefunded), 0), rate: thisWeekOrders.length > 0 ? (refundOrders.length / thisWeekOrders.length) * 100 : 0 },
    byDay: Object.entries(byDay).map(([date, v]) => ({ date, ...v })),
  };
}

async function generateNarrative(storeName, m) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  const sign = m.revenue.changePct > 0 ? '+' : '';
  const prompt = [
    'Esti analistul magazinului ' + storeName + '. Genereaza raport saptamanal ' + m.weekStart + ' - ' + m.weekEnd + '.',
    'Revenue: ' + Math.round(m.revenue.thisWeek).toLocaleString('ro-RO') + ' RON (' + sign + m.revenue.changePct.toFixed(1) + '% vs prev: ' + Math.round(m.revenue.prevWeek).toLocaleString('ro-RO') + ' RON)',
    'Comenzi: ' + m.revenue.orders + ' (vs ' + m.revenue.ordersPrev + '), AOV: ' + Math.round(m.revenue.aov) + ' RON',
    'Clienti noi: ' + m.customers.newThis + ' (vs ' + m.customers.newPrev + '), Champions: ' + m.customers.champions + ', At Risk+Lost: ' + m.customers.atRisk,
    'RFM: ' + m.rfm.map((r) => r.segment + ':' + r.count).join(', '),
    'Top produse: ' + m.topProducts.map((p, i) => (i + 1) + '.' + p.title + '-' + p.units + 'buc,' + Math.round(p.revenue) + 'RON').join('; '),
    'Stoc critic: ' + (m.stockAlerts.length > 0 ? m.stockAlerts.map((a) => a.title + '(' + a.daysRemaining + 'z,' + a.severity + ')').join('; ') : 'niciuna'),
    'Returnuri: ' + m.refunds.count + ' comenzi, ' + Math.round(m.refunds.amount) + ' RON, rata: ' + m.refunds.rate.toFixed(1) + '%',
    'Revenue/zi: ' + m.byDay.map((d) => d.date + ':' + Math.round(d.revenue) + 'RON').join(', '),
    '',
    'Structura obligatorie in romana:',
    '1. SUMAR EXECUTIV (3-4 fraze)',
    '2. ANALIZA VANZARI (trend, explicatii)',
    '3. CLIENTI SI RETENTIE (RFM, nou vs vechi)',
    '4. PRODUSE (ce a mers, ce necesita atentie)',
    '5. RISCURI SI ACTIUNI (stoc, retentie, returnuri)',
    '6. RECOMANDARI CONCRETE (5 actiuni cu prioritate High/Medium/Low)',
  ].join('\n');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL_CHAT || 'gpt-4o',
      messages: [
        { role: 'system', content: 'Expert analist business ecommerce Romania. Raspunde DOAR in romana, structurat, cu date precise.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 2500,
      temperature: 0.4,
    }),
  });

  if (!response.ok) throw new Error('OpenAI error: ' + response.status);
  const data = await response.json();
  const tokensUsed = data.usage.total_tokens || 0;
  return { content: data.choices[0].message.content || '', tokensUsed, costUsd: (tokensUsed / 1000) * 0.005 };
}

async function main() {
  console.log('[' + new Date().toISOString() + '] cron-narrative started');
  const stores = await db.storeConnection.findMany({ where: { isActive: true }, select: { id: true, name: true } });
  for (const store of stores) {
    try {
      const metrics = await computeWeeklyMetrics(store.id);
      const { content, tokensUsed, costUsd } = await generateNarrative(store.name, metrics);
      await db.aiReport.create({
        data: { storeConnectionId: store.id, type: 'NARRATIVE', title: 'Raport Saptamanal ' + metrics.weekStart + ' - ' + metrics.weekEnd, content, tokensUsed, costUsd },
      });
      const all = await db.aiReport.findMany({ where: { storeConnectionId: store.id, type: 'NARRATIVE' }, orderBy: { createdAt: 'desc' }, select: { id: true } });
      if (all.length > 52) await db.aiReport.deleteMany({ where: { id: { in: all.slice(52).map((r) => r.id) } } });
      console.log('  Store ' + store.name + ': generat (' + tokensUsed + ' tokens, $' + costUsd.toFixed(4) + ')');
    } catch (err) { console.error('  Error for ' + store.name + ':', err.message); }
  }
  console.log('[' + new Date().toISOString() + '] cron-narrative finished');
}
main().catch((e) => { console.error('Fatal:', e); process.exit(1); }).finally(() => db.$disconnect());
