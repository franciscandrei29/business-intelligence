#!/usr/bin/env node
// cron-anomalies.js — Zilnic 07:00
// Detecteaza anomalii DoW-aware si salveaza in AiReport (type='ANOMALY')
// Trimite email alert daca exista anomalii critice

const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

const DOW_NAMES = ['Duminica', 'Luni', 'Marti', 'Miercuri', 'Joi', 'Vineri', 'Sambata'];

async function detectAnomalies(storeConnectionId) {
  const anomalies = [];
  const SEVENTY_DAYS = 70;
  const DETECT_WINDOW = 14;

  const start = new Date(); start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - SEVENTY_DAYS);
  const today = new Date(); today.setHours(23, 59, 59, 999);

  const orders = await db.order.findMany({
    where: { storeConnectionId, placedAt: { gte: start, lte: today } },
    select: { placedAt: true, total: true },
    orderBy: { placedAt: 'asc' },
  });

  if (orders.length === 0) return [];

  const dailyRev = new Map();
  const dailyOrd = new Map();
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const k = d.toISOString().slice(0, 10);
    dailyRev.set(k, 0);
    dailyOrd.set(k, 0);
  }
  for (const o of orders) {
    const k = o.placedAt.toISOString().slice(0, 10);
    if (dailyRev.has(k)) {
      dailyRev.set(k, (dailyRev.get(k) || 0) + Number(o.total));
      dailyOrd.set(k, (dailyOrd.get(k) || 0) + 1);
    }
  }

  const allDates = [...dailyRev.keys()].sort();
  const detectDates = allDates.slice(-DETECT_WINDOW);

  function analyze(values, metricName, dropType, spikeType) {
    for (const date of detectDates) {
      const d = new Date(date + 'T12:00:00Z');
      const dow = d.getUTCDay();
      const baselineValues = [];
      for (let k = 1; k <= 8; k++) {
        const priorDate = new Date(d);
        priorDate.setUTCDate(priorDate.getUTCDate() - 7 * k);
        const priorStr = priorDate.toISOString().slice(0, 10);
        if (values.has(priorStr)) baselineValues.push(values.get(priorStr) || 0);
      }
      if (baselineValues.length < 3) continue;

      const mean = baselineValues.reduce((a, b) => a + b, 0) / baselineValues.length;
      const variance = baselineValues.reduce((a, v) => a + (v - mean) ** 2, 0) / baselineValues.length;
      const stdDev = Math.sqrt(variance);
      const current = values.get(date) || 0;
      if (mean < 1 && current < 1) continue;

      const z = stdDev > 0.5 ? (current - mean) / stdDev : 0;
      const deviation = mean > 0 ? ((current - mean) / mean) * 100 : 0;

      if (current === 0 && mean > 5) {
        anomalies.push({
          type: 'zero_day', severity: 'critical', metric: metricName,
          currentValue: 0, expectedValue: Math.round(mean * 100) / 100,
          deviationPercent: -100, zScore: -99, date, dayOfWeek: DOW_NAMES[dow],
          message: `Zero ${metricName.toLowerCase()} intr-o zi de ${DOW_NAMES[dow]}`,
          context: `Media pentru ${DOW_NAMES[dow]} in ultimele 8 saptamani: ${Math.round(mean)}`,
        });
        continue;
      }

      if (z < -2.5) {
        const severity = z < -3.5 ? 'critical' : 'warning';
        anomalies.push({
          type: dropType, severity, metric: metricName,
          currentValue: Math.round(current * 100) / 100,
          expectedValue: Math.round(mean * 100) / 100,
          deviationPercent: Math.round(deviation * 10) / 10,
          zScore: Math.round(z * 100) / 100, date, dayOfWeek: DOW_NAMES[dow],
          message: `Scadere ${metricName.toLowerCase()} de ${Math.abs(Math.round(deviation))}% fata de media de ${DOW_NAMES[dow]}`,
          context: `Valoare: ${Math.round(current)} vs medie: ${Math.round(mean)} (${baselineValues.length} saptamani referinta)`,
        });
      } else if (z > 2.5) {
        anomalies.push({
          type: spikeType, severity: 'info', metric: metricName,
          currentValue: Math.round(current * 100) / 100,
          expectedValue: Math.round(mean * 100) / 100,
          deviationPercent: Math.round(deviation * 10) / 10,
          zScore: Math.round(z * 100) / 100, date, dayOfWeek: DOW_NAMES[dow],
          message: `Spike ${metricName.toLowerCase()} de +${Math.round(deviation)}% fata de media de ${DOW_NAMES[dow]}`,
          context: `Valoare: ${Math.round(current)} vs medie: ${Math.round(mean)}`,
        });
      }
    }
  }

  analyze(dailyRev, 'Revenue', 'revenue_drop', 'revenue_spike');
  analyze(dailyOrd, 'Comenzi', 'orders_drop', 'orders_spike');

  return anomalies;
}

async function main() {
  console.log(`[${new Date().toISOString()}] cron-anomalies started`);
  const stores = await db.storeConnection.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });

  for (const store of stores) {
    try {
      const anomalies = await detectAnomalies(store.id);
      if (anomalies.length === 0) {
        console.log(`  Store "${store.name}": no anomalies`);
        continue;
      }

      const criticalCount = anomalies.filter((a) => a.severity === 'critical').length;
      const warningCount = anomalies.filter((a) => a.severity === 'warning').length;

      const title = `Raport Anomalii ${new Date().toLocaleDateString('ro-RO')} — ${criticalCount} critice, ${warningCount} warnings`;
      const content = anomalies.map((a) =>
        `[${a.severity.toUpperCase()}] ${a.message}\n  ${a.context || ''}\n  Data: ${a.date} (${a.dayOfWeek}) | Z-score: ${a.zScore}`
      ).join('\n\n');

      await db.aiReport.create({
        data: {
          storeConnectionId: store.id,
          type: 'ANOMALY',
          title,
          content: JSON.stringify({ anomalies, summary: { criticalCount, warningCount, totalCount: anomalies.length } }),
          tokensUsed: 0,
          costUsd: 0,
        },
      });

      // Curata rapoartele vechi (pastram ultimele 60)
      const allReports = await db.aiReport.findMany({
        where: { storeConnectionId: store.id, type: 'ANOMALY' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (allReports.length > 60) {
        const toDelete = allReports.slice(60).map((r) => r.id);
        await db.aiReport.deleteMany({ where: { id: { in: toDelete } } });
      }

      console.log(`  Store "${store.name}": ${anomalies.length} anomalii (${criticalCount} critice, ${warningCount} warnings)`);
    } catch (err) {
      console.error(`  Error for store "${store.name}":`, err.message);
    }
  }

  console.log(`[${new Date().toISOString()}] cron-anomalies finished`);
}

main()
  .catch((e) => { console.error('cron-anomalies fatal error:', e); process.exit(1); })
  .finally(() => db.$disconnect());
