#!/usr/bin/env node
// cron-ltv-weekly.js - Luni 03:00 - Pre-calculeaza LTV per client si distribuie in AiInsight
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

async function calculateLtv(storeConnectionId) {
  const customers = await db.customer.findMany({
    where: { storeConnectionId, ordersCount: { gte: 1 } },
    select: { externalId: true, totalSpent: true, ordersCount: true, firstOrderAt: true, lastOrderAt: true },
  });

  if (customers.length === 0) return { overallAvgLtv: 0, overallMedianLtv: 0, segments: {}, distribution: [] };

  const ltvValues = customers.map((c) => Number(c.totalSpent)).sort((a, b) => a - b);
  const overallAvgLtv = ltvValues.reduce((a, b) => a + b, 0) / ltvValues.length;
  const overallMedianLtv = ltvValues[Math.floor(ltvValues.length / 2)] || 0;

  const buckets = [
    { label: '0-50 RON', min: 0, max: 50 },
    { label: '50-200 RON', min: 50, max: 200 },
    { label: '200-500 RON', min: 200, max: 500 },
    { label: '500-1000 RON', min: 500, max: 1000 },
    { label: '1000-2500 RON', min: 1000, max: 2500 },
    { label: '2500+ RON', min: 2500, max: Infinity },
  ];

  const distribution = buckets.map((b) => ({
    bucket: b.label,
    count: ltvValues.filter((v) => v >= b.min && v < b.max).length,
  }));

  // LTV pe perioade (30/90/365 zile de la prima comanda)
  const now = Date.now();
  const ltv30 = customers.filter((c) => c.firstOrderAt && (now - new Date(c.firstOrderAt).getTime()) >= 30 * 86400000).map((c) => Number(c.totalSpent));
  const ltv90 = customers.filter((c) => c.firstOrderAt && (now - new Date(c.firstOrderAt).getTime()) >= 90 * 86400000).map((c) => Number(c.totalSpent));
  const ltv365 = customers.filter((c) => c.firstOrderAt && (now - new Date(c.firstOrderAt).getTime()) >= 365 * 86400000).map((c) => Number(c.totalSpent));

  const avg = (arr) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  const repeatCustomers = customers.filter((c) => c.ordersCount >= 2).length;
  const repeatRate = customers.length > 0 ? (repeatCustomers / customers.length) * 100 : 0;
  const topCustomers = [...customers].sort((a, b) => Number(b.totalSpent) - Number(a.totalSpent)).slice(0, 10).map((c) => ({ externalId: c.externalId, totalSpent: Number(c.totalSpent), ordersCount: c.ordersCount }));

  return {
    totalCustomers: customers.length,
    overallAvgLtv: Math.round(overallAvgLtv * 100) / 100,
    overallMedianLtv: Math.round(overallMedianLtv * 100) / 100,
    repeatRate: Math.round(repeatRate * 10) / 10,
    repeatCustomers,
    ltv30: Math.round(avg(ltv30) * 100) / 100,
    ltv90: Math.round(avg(ltv90) * 100) / 100,
    ltv365: Math.round(avg(ltv365) * 100) / 100,
    distribution,
    topCustomers,
  };
}

async function main() {
  console.log('[' + new Date().toISOString() + '] cron-ltv-weekly started');
  const stores = await db.storeConnection.findMany({ where: { isActive: true }, select: { id: true, name: true } });
  for (const store of stores) {
    try {
      const result = await calculateLtv(store.id);
      const content = JSON.stringify(result, null, 2);
      const summary = 'LTV mediu: ' + result.overallAvgLtv + ' RON, median: ' + result.overallMedianLtv + ' RON, repeat rate: ' + result.repeatRate + '%, clienti: ' + result.totalCustomers;

      await db.aiInsight.create({
        data: {
          storeConnectionId: store.id,
          type: 'LTV_WEEKLY',
          periodDays: 365,
          causalAnalysis: summary,
          recommendations: JSON.stringify({ ltv30: result.ltv30, ltv90: result.ltv90, ltv365: result.ltv365, distribution: result.distribution, topCustomers: result.topCustomers }),
          dataSnapshot: content,
          healthScore: Math.min(100, Math.round(result.repeatRate * 2)),
          tokensUsed: 0,
          costUsd: 0,
        },
      });

      // Pastreaza ultimele 52 (1 an)
      const all = await db.aiInsight.findMany({ where: { storeConnectionId: store.id, type: 'LTV_WEEKLY' }, orderBy: { generatedAt: 'desc' }, select: { id: true } });
      if (all.length > 52) await db.aiInsight.deleteMany({ where: { id: { in: all.slice(52).map((r) => r.id) } } });

      console.log('  Store ' + store.name + ': LTV avg=' + result.overallAvgLtv + ' RON, repeatRate=' + result.repeatRate + '%');
    } catch (err) { console.error('  Error for ' + store.name + ':', err.message); }
  }
  console.log('[' + new Date().toISOString() + '] cron-ltv-weekly finished');
}
main().catch((e) => { console.error('Fatal:', e); process.exit(1); }).finally(() => db.$disconnect());
