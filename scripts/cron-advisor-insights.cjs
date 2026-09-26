#!/usr/bin/env node
// cron-advisor-insights.js - Zilnic 06:30
// Analizeaza toate datele magazinului si genereaza 5-10 insights proactive cu GPT-4o
// Stocate in AiInsight (type='ADVISOR_DAILY') pentru AI Advisor chat context
require('dotenv').config({ path: '/root/business-intelligence-kimono-nu-seo/.env' });
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

async function gatherStoreData(storeId) {
  const now = new Date();
  const d7 = new Date(now); d7.setDate(d7.getDate() - 7);
  const d30 = new Date(now); d30.setDate(d30.getDate() - 30);
  const d7prev = new Date(d7); d7prev.setDate(d7prev.getDate() - 7);

  const [
    recentOrders, prevOrders, allCustomers, newCustomers,
    stockAlerts, rfmCounts, productCount,
    latestForecast, latestAnomaly,
  ] = await Promise.all([
    db.order.findMany({ where: { storeConnectionId: storeId, placedAt: { gte: d7, lte: now } }, select: { total: true, totalRefunded: true, lineItems: true, placedAt: true } }),
    db.order.findMany({ where: { storeConnectionId: storeId, placedAt: { gte: d7prev, lt: d7 } }, select: { total: true } }),
    db.customer.count({ where: { storeConnectionId: storeId } }),
    db.customer.count({ where: { storeConnectionId: storeId, firstOrderAt: { gte: d7 } } }),
    db.stockAlert.findMany({ where: { storeConnectionId: storeId }, orderBy: { daysRemaining: 'asc' }, take: 10 }),
    db.rfmSegment.groupBy({ by: ['segment'], where: { storeConnectionId: storeId }, _count: { segment: true } }),
    db.product.count({ where: { storeConnectionId: storeId, status: 'ACTIVE' } }),
    db.dailyForecast.findFirst({ where: { storeConnectionId: storeId }, orderBy: { calculatedAt: 'desc' } }),
    db.aiReport.findFirst({ where: { storeConnectionId: storeId, type: 'ANOMALY' }, orderBy: { createdAt: 'desc' } }),
  ]);

  // Calcul vanzari
  const rev7 = recentOrders.reduce((s, o) => s + Number(o.total), 0);
  const revPrev7 = prevOrders.reduce((s, o) => s + Number(o.total), 0);
  const changePct = revPrev7 > 0 ? ((rev7 - revPrev7) / revPrev7) * 100 : 0;
  const aov = recentOrders.length > 0 ? rev7 / recentOrders.length : 0;
  const refundOrders = recentOrders.filter((o) => Number(o.totalRefunded || 0) > 0);
  const refundRate = recentOrders.length > 0 ? (refundOrders.length / recentOrders.length) * 100 : 0;

  // Top produse 7 zile
  const productSales = new Map();
  for (const order of recentOrders) {
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

  // RFM summary
  const rfmMap = {};
  for (const r of rfmCounts) rfmMap[r.segment] = r._count.segment;

  // Anomalii recente
  let recentAnomalies = [];
  if (latestAnomaly) {
    try {
      const data = JSON.parse(latestAnomaly.content);
      recentAnomalies = (data.anomalies || []).filter((a) => a.severity === 'critical' || a.severity === 'warning').slice(0, 5);
    } catch (e) {}
  }

  return {
    rev7, revPrev7, changePct, aov, orders7: recentOrders.length, refundRate,
    allCustomers, newCustomers, productCount,
    stockAlerts: stockAlerts.map((a) => ({ title: a.productTitle, daysRemaining: a.daysRemaining, severity: a.severity, stock: a.currentStock })),
    rfm: rfmMap,
    topProducts,
    forecast: latestForecast ? { next30: Number(latestForecast.next30), next60: Number(latestForecast.next60), growthPct: latestForecast.growthPct } : null,
    recentAnomalies,
  };
}

async function generateInsights(storeName, d) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  const sign = d.changePct > 0 ? '+' : '';
  const stockCritical = d.stockAlerts.filter((a) => a.severity === 'critical').length;
  const stockHigh = d.stockAlerts.filter((a) => a.severity === 'high').length;

  const context = [
    'MAGAZIN: ' + storeName,
    'Data: ' + new Date().toLocaleDateString('ro-RO'),
    '',
    'VANZARI (ultimele 7 zile):',
    '- Revenue: ' + Math.round(d.rev7).toLocaleString('ro-RO') + ' RON (' + sign + d.changePct.toFixed(1) + '% vs sapt anterioara)',
    '- Comenzi: ' + d.orders7 + ', AOV: ' + Math.round(d.aov) + ' RON',
    '- Rata returnuri: ' + d.refundRate.toFixed(1) + '%',
    '',
    'CLIENTI:',
    '- Total: ' + d.allCustomers + ', Noi (7z): ' + d.newCustomers,
    '- Champions: ' + (d.rfm['Champions'] || 0) + ', Loyal: ' + (d.rfm['Loyal Customers'] || 0),
    '- At Risk: ' + (d.rfm['At Risk'] || 0) + ', Lost: ' + (d.rfm['Lost'] || 0),
    '',
    'STOC:',
    '- Alerte critice: ' + stockCritical + ', ridicate: ' + stockHigh,
    d.stockAlerts.length > 0 ? d.stockAlerts.slice(0, 5).map((a) => '  * ' + a.title + ': ' + a.daysRemaining + ' zile, stoc=' + a.stock + ' (' + a.severity + ')').join('\n') : '  * Fara alerte',
    '',
    'TOP PRODUSE:',
    d.topProducts.map((p, i) => (i + 1) + '. ' + p.title + ' - ' + p.units + ' buc, ' + Math.round(p.revenue) + ' RON').join('\n'),
    d.forecast ? 'FORECAST: next30=' + Math.round(d.forecast.next30) + ' RON (crestere proiectata ' + (d.forecast.growthPct > 0 ? '+' : '') + d.forecast.growthPct.toFixed(1) + '%)' : '',
    d.recentAnomalies.length > 0 ? 'ANOMALII RECENTE:\n' + d.recentAnomalies.map((a) => '- [' + a.severity + '] ' + a.message).join('\n') : '',
    '',
    'SARCINA: Analizeaza datele si genereaza recomandari structurate.',
    'RASPUNDE STRICT in format JSON valid (fara markdown, fara ``` ):',
    '{"recommendations": [',
    '  {"priority": "urgent", "title": "...", "description": "...", "action": "...", "category": "..."},',
    '  ...',
    ']}',
    '',
    'Categorii de priority: "urgent" (rezolva azi), "important" (rezolva in 3 zile), "improvement" (optimizare pe termen mediu), "opportunity" (oportunitate de crestere).',
    'Categorii de category: "vanzari", "stoc", "clienti", "marketing", "operatiuni", "financiar".',
    'Genereaza 5-8 recomandari. Fii specific si actionabil. In romana.',
  ].join('\n');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL_CHAT || 'gpt-4o',
      messages: [
        { role: 'system', content: 'Esti agentul AI al platformei Kimono BI. REGULI STRICTE: 1) Bazeaza-te EXCLUSIV pe datele furnizate. 2) NU inventa cifre, procente sau tendinte. 3) Daca nu ai date suficiente pentru o recomandare, NU o include. 4) Fiecare recomandare trebuie sa citeze date concrete din context. 5) Raspunzi DOAR cu JSON valid, fara text suplimentar, fara markdown.' },
        { role: 'user', content: context },
      ],
      max_tokens: 2000,
      temperature: 0.1,
    }),
  });

  if (!response.ok) throw new Error('OpenAI error: ' + response.status);
  const data = await response.json();
  const tokensUsed = data.usage.total_tokens || 0;

  // Health score simplu bazat pe vanzari + stoc + retentie
  // Health Score: balanced formula (0-100)
  let healthScore = 50; // neutral base

  // Revenue trend (max +/- 20)
  if (d.changePct > 20) healthScore += 20;
  else if (d.changePct > 10) healthScore += 15;
  else if (d.changePct > 0) healthScore += 5;
  else if (d.changePct > -10) healthScore -= 5;
  else if (d.changePct > -20) healthScore -= 10;
  else healthScore -= 15;

  // Stock health (max -15): only penalize high-velocity stockouts
  const highVelStockouts = d.stockAlerts.filter(a => a.stock <= 0 && a.daysRemaining === 0).length;
  if (highVelStockouts > 10) healthScore -= 15;
  else if (highVelStockouts > 5) healthScore -= 10;
  else if (highVelStockouts > 0) healthScore -= 5;

  // Customer health (max +/- 15)
  const championsCount = d.rfm['Champions'] || 0;
  const loyalCount = d.rfm['Loyal Customers'] || 0;
  const atRiskCount = d.rfm['At Risk'] || 0;
  const lostCount = d.rfm['Lost'] || 0;
  const goodRatio = (championsCount + loyalCount) / Math.max(1, d.allCustomers);
  const badRatio = (atRiskCount + lostCount) / Math.max(1, d.allCustomers);
  if (goodRatio > 0.1) healthScore += 10;
  else if (goodRatio > 0.05) healthScore += 5;
  if (badRatio > 0.4) healthScore -= 10;
  else if (badRatio > 0.25) healthScore -= 5;

  // Refund rate (max -10)
  if (d.refundRate > 10) healthScore -= 10;
  else if (d.refundRate > 5) healthScore -= 5;

  // Order volume (max +10)
  if (d.orders7 > 50) healthScore += 10;
  else if (d.orders7 > 20) healthScore += 5;
  else if (d.orders7 === 0) healthScore -= 10;

  healthScore = Math.max(0, Math.min(100, healthScore));

  return {
    content: data.choices[0].message.content || '',
    tokensUsed,
    costUsd: (tokensUsed / 1000) * 0.005,
    healthScore,
  };
}

async function main() {
  console.log('[' + new Date().toISOString() + '] cron-advisor-insights started');
  const stores = await db.storeConnection.findMany({ where: {}, select: { id: true, name: true } });
  for (const store of stores) {
    try {
      const data = await gatherStoreData(store.id);
      const { content, tokensUsed, costUsd, healthScore } = await generateInsights(store.name, data);

      await db.aiInsight.create({
        data: {
          storeConnectionId: store.id,
          type: 'ADVISOR_DAILY',
          periodDays: 7,
          causalAnalysis: content,
          recommendations: JSON.stringify({
            rev7: data.rev7, changePct: data.changePct, orders7: data.orders7,
            stockCritical: data.stockAlerts.filter((a) => a.severity === 'critical').length,
            atRisk: data.rfm['At Risk'] || 0,
          }),
          dataSnapshot: JSON.stringify({ topProducts: data.topProducts, stockAlerts: data.stockAlerts, rfm: data.rfm }),
          healthScore,
          tokensUsed,
          costUsd,
        },
      });

      // Pastreaza ultimele 90 (3 luni)
      const all = await db.aiInsight.findMany({ where: { storeConnectionId: store.id, type: 'ADVISOR_DAILY' }, orderBy: { generatedAt: 'desc' }, select: { id: true } });
      if (all.length > 90) await db.aiInsight.deleteMany({ where: { id: { in: all.slice(90).map((r) => r.id) } } });

      console.log('  Store ' + store.name + ': insights generat, healthScore=' + healthScore + ' (' + tokensUsed + ' tokens, $' + costUsd.toFixed(4) + ')');
    } catch (err) { console.error('  Error for ' + store.name + ':', err.message); }
  }
  console.log('[' + new Date().toISOString() + '] cron-advisor-insights finished');
}
main().catch((e) => { console.error('Fatal:', e); process.exit(1); }).finally(() => db.$disconnect());
