#!/usr/bin/env node
// cron-forecast.js — Zilnic 01:00
// Pre-calculeaza forecast Holt-Winters 30/60/90 zile per store
// si salveaza in DailyForecast pentru incarcare instant pe dashboard

const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

// ─── Holt-Winters Triple Exponential Smoothing (additive, weekly seasonality) ───
function holtWintersForecast(data, horizon, period = 7) {
  const n = data.length;
  if (n < period * 2) {
    const avg = data.reduce((s, v) => s + v, 0) / Math.max(1, n);
    const forecast = Array(horizon).fill(avg);
    const residuals = data.map((v) => v - avg);
    const stdev = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / Math.max(1, residuals.length));
    return { forecast, stdev, method: 'moving-average' };
  }

  const alpha = 0.3, beta = 0.05, gamma = 0.3;
  let L = data.slice(0, period).reduce((s, v) => s + v, 0) / period;
  let T = 0;
  for (let i = 0; i < period; i++) T += (data[i + period] - data[i]) / period;
  T /= period;

  const seasonal = Array(period).fill(0);
  const counts = Array(period).fill(0);
  for (let i = 0; i < period * 2 && i < n; i++) {
    seasonal[i % period] += data[i] - L;
    counts[i % period]++;
  }
  for (let i = 0; i < period; i++) if (counts[i] > 0) seasonal[i] /= counts[i];

  const residuals = [];
  for (let t = 0; t < n; t++) {
    const sIdx = t % period;
    const prevL = L, prevT = T, prevS = seasonal[sIdx];
    const yhat = prevL + prevT + prevS;
    residuals.push(data[t] - yhat);
    L = alpha * (data[t] - prevS) + (1 - alpha) * (prevL + prevT);
    T = beta * (L - prevL) + (1 - beta) * prevT;
    seasonal[sIdx] = gamma * (data[t] - L) + (1 - gamma) * prevS;
  }

  const phi = 0.95;
  let dampedTrendSum = 0;
  const forecast = [];
  for (let h = 1; h <= horizon; h++) {
    dampedTrendSum += Math.pow(phi, h - 1) * T;
    const sIdx = (n + h - 1) % period;
    forecast.push(Math.max(0, L + dampedTrendSum + seasonal[sIdx]));
  }

  const cleanResiduals = residuals.slice(period);
  const stdev = cleanResiduals.length > 0
    ? Math.sqrt(cleanResiduals.reduce((s, r) => s + r * r, 0) / cleanResiduals.length)
    : 0;

  return { forecast, stdev, method: 'holt-winters' };
}

function sumRange(arr, from, to) {
  return arr.slice(from, to).reduce((s, v) => s + v, 0);
}

async function computeForecast(storeConnectionId) {
  const now = new Date();
  const start = new Date(now); start.setDate(start.getDate() - 365);

  const orders = await db.order.findMany({
    where: { storeConnectionId, placedAt: { gte: start, lte: now } },
    select: { placedAt: true, total: true },
    orderBy: { placedAt: 'asc' },
  });

  // Build daily revenue series
  const dailyMap = new Map();
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    dailyMap.set(d.toISOString().slice(0, 10), 0);
  }
  for (const o of orders) {
    const k = o.placedAt.toISOString().slice(0, 10);
    if (dailyMap.has(k)) dailyMap.set(k, (dailyMap.get(k) || 0) + Number(o.total));
  }

  const sortedDates = [...dailyMap.keys()].sort();
  const series = sortedDates.map((d) => dailyMap.get(d));

  const { forecast, stdev, method } = holtWintersForecast(series, 90);

  const next30 = sumRange(forecast, 0, 30);
  const next60 = sumRange(forecast, 0, 60);
  const next90 = sumRange(forecast, 0, 90);
  const prev30 = sumRange(series, series.length - 30, series.length);
  const growthPct = prev30 > 0 ? ((next30 - prev30) / prev30) * 100 : 0;

  // Build forecast points for chart
  const daily = forecast.slice(0, 90).map((predicted, i) => {
    const d = new Date(today); d.setDate(d.getDate() + i + 1);
    const z = 1.645;
    return {
      date: d.toISOString().slice(0, 10),
      predicted: Math.round(predicted * 100) / 100,
      lower: Math.max(0, Math.round((predicted - z * stdev) * 100) / 100),
      upper: Math.round((predicted + z * stdev) * 100) / 100,
    };
  });

  const forecastData = JSON.stringify({
    daily,
    summary: { next30, next60, next90, prev30, growthPct, method, stdev },
    generatedAt: new Date().toISOString(),
  });

  // Upsert — pastram maxim 30 inregistrari per store (1 luna)
  await db.dailyForecast.create({
    data: {
      storeConnectionId,
      forecastData,
      next30: Math.round(next30 * 100) / 100,
      next60: Math.round(next60 * 100) / 100,
      next90: Math.round(next90 * 100) / 100,
      prev30: Math.round(prev30 * 100) / 100,
      growthPct: Math.round(growthPct * 100) / 100,
      method,
    },
  });

  // Curata inregistrarile vechi (pastram ultimele 30)
  const all = await db.dailyForecast.findMany({
    where: { storeConnectionId },
    orderBy: { calculatedAt: 'desc' },
    select: { id: true },
  });
  if (all.length > 30) {
    const toDelete = all.slice(30).map((r) => r.id);
    await db.dailyForecast.deleteMany({ where: { id: { in: toDelete } } });
  }

  return { next30, next60, next90, prev30, growthPct, method };
}

async function main() {
  console.log(`[${new Date().toISOString()}] cron-forecast started`);
  const stores = await db.storeConnection.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });
  console.log(`Found ${stores.length} active store(s)`);

  for (const store of stores) {
    try {
      const result = await computeForecast(store.id);
      console.log(`  Store "${store.name}": next30=${Math.round(result.next30)} RON, growth=${result.growthPct.toFixed(1)}%, method=${result.method}`);
    } catch (err) {
      console.error(`  Error for store "${store.name}":`, err.message);
    }
  }

  console.log(`[${new Date().toISOString()}] cron-forecast finished`);
}

main()
  .catch((e) => { console.error('cron-forecast fatal error:', e); process.exit(1); })
  .finally(() => db.$disconnect());
