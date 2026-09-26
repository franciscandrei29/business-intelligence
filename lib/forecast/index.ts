import { db } from '~/lib/db.server';

interface ForecastPoint {
  date: string;
  predicted: number;
  lower: number;
  upper: number;
}

interface ForecastResult {
  daily: ForecastPoint[];
  history: Array<{ date: string; actual: number }>;
  summary: {
    next30: number;
    next60: number;
    next90: number;
    prev30: number;
    growthPct30: number;
    trend: 'up' | 'down' | 'flat';
    trendPercent: number;
    seasonalityDetected: boolean;
    confidenceLow30: number;
    confidenceHigh30: number;
    method: string;
  };
}

/**
 * Additive Holt-Winters Triple Exponential Smoothing with weekly seasonality.
 * Robust against zero days and short histories.
 */
function holtWintersForecast(data: number[], horizon: number, period = 7) {
  const n = data.length;
  if (n < period * 2) {
    // Fall back to simple moving average if not enough data
    const avg = data.reduce((s, v) => s + v, 0) / Math.max(1, n);
    const forecast: number[] = Array(horizon).fill(avg);
    const residuals = data.map((v) => v - avg);
    const stdev = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / Math.max(1, residuals.length));
    return { forecast, stdev, method: 'moving-average' };
  }

  const alpha = 0.3;
  const beta = 0.05;
  const gamma = 0.3;

  // Initial level = average of first period
  let L = data.slice(0, period).reduce((s, v) => s + v, 0) / period;

  // Initial trend = mean of period-over-period diffs
  let T = 0;
  for (let i = 0; i < period; i++) {
    T += (data[i + period] - data[i]) / period;
  }
  T /= period;

  // Initial seasonal factors (additive): use mean of (data[i] - L) grouped by (i % period) across first 2 periods
  const seasonal: number[] = Array(period).fill(0);
  const counts = Array(period).fill(0);
  for (let i = 0; i < period * 2 && i < n; i++) {
    seasonal[i % period] += data[i] - L;
    counts[i % period]++;
  }
  for (let i = 0; i < period; i++) if (counts[i] > 0) seasonal[i] /= counts[i];

  const residuals: number[] = [];

  // Run through data, updating parameters
  for (let t = 0; t < n; t++) {
    const sIdx = t % period;
    const prevL = L;
    const prevT = T;
    const prevS = seasonal[sIdx];

    const yhat = prevL + prevT + prevS;
    residuals.push(data[t] - yhat);

    L = alpha * (data[t] - prevS) + (1 - alpha) * (prevL + prevT);
    T = beta * (L - prevL) + (1 - beta) * prevT;
    seasonal[sIdx] = gamma * (data[t] - L) + (1 - gamma) * prevS;
  }

  // Dampen trend for long horizons to avoid runaway extrapolation
  const phi = 0.95;
  let dampedTrendSum = 0;
  const forecast: number[] = [];
  for (let h = 1; h <= horizon; h++) {
    dampedTrendSum += Math.pow(phi, h - 1) * T;
    const sIdx = (n + h - 1) % period;
    const pred = L + dampedTrendSum + seasonal[sIdx];
    forecast.push(Math.max(0, pred));
  }

  // Residual stdev (ignore first period where seasonal init is warming up)
  const cleanResiduals = residuals.slice(period);
  const stdev = cleanResiduals.length > 0
    ? Math.sqrt(cleanResiduals.reduce((s, r) => s + r * r, 0) / cleanResiduals.length)
    : 0;

  return { forecast, stdev, method: 'holt-winters' };
}

export async function generateForecast(storeConnectionId: string, daysToForecast = 90): Promise<ForecastResult> {
  const now = new Date();
  const start = new Date(now); start.setDate(start.getDate() - 365);

  const orders = await db.order.findMany({
    where: { storeConnectionId, placedAt: { gte: start, lte: now } },
    select: { placedAt: true, total: true },
    orderBy: { placedAt: 'asc' },
  });

  // Build daily series from start to today (fill missing days with 0)
  const dailyMap = new Map<string, number>();
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    dailyMap.set(d.toISOString().slice(0, 10), 0);
  }
  for (const o of orders) {
    const k = o.placedAt.toISOString().slice(0, 10);
    if (dailyMap.has(k)) dailyMap.set(k, (dailyMap.get(k) || 0) + Number(o.total));
  }

  const dates = [...dailyMap.keys()].sort();
  const values = dates.map((d) => dailyMap.get(d) || 0);

  // Detect weekly seasonality by computing DoW factors
  const dowSum = Array(7).fill(0);
  const dowCount = Array(7).fill(0);
  for (let i = 0; i < dates.length; i++) {
    const dow = new Date(dates[i]).getUTCDay();
    dowSum[dow] += values[i];
    dowCount[dow]++;
  }
  const dowAvg = dowSum.map((s, i) => dowCount[i] > 0 ? s / dowCount[i] : 0);
  const overallAvg = dowAvg.reduce((a, b) => a + b, 0) / 7;
  const dowRatios = dowAvg.map((a) => overallAvg > 0 ? a / overallAvg : 1);
  const seasonalityDetected = Math.max(...dowRatios) - Math.min(...dowRatios) > 0.3;

  // Run Holt-Winters
  const { forecast: hwForecast, stdev, method } = holtWintersForecast(values, daysToForecast, 7);

  // Build forecast points with confidence intervals
  const forecastPoints: ForecastPoint[] = [];
  for (let i = 0; i < daysToForecast; i++) {
    const fd = new Date(now); fd.setDate(fd.getDate() + i + 1);
    const dateStr = fd.toISOString().slice(0, 10);
    const predicted = hwForecast[i];
    // CI widens slowly with horizon; 1.96 = ~95%
    const uncertainty = stdev * 1.96 * Math.sqrt(1 + i / 60);
    forecastPoints.push({
      date: dateStr,
      predicted: Math.round(predicted * 100) / 100,
      lower: Math.max(0, Math.round((predicted - uncertainty) * 100) / 100),
      upper: Math.round((predicted + uncertainty) * 100) / 100,
    });
  }

  const sum30 = hwForecast.slice(0, 30).reduce((s, v) => s + v, 0);
  const sum60 = hwForecast.slice(0, 60).reduce((s, v) => s + v, 0);
  const sum90 = hwForecast.reduce((s, v) => s + v, 0);
  const prev30 = values.slice(-30).reduce((s, v) => s + v, 0);

  const growth = prev30 > 0 ? ((sum30 - prev30) / prev30) * 100 : 0;
  const trend = growth > 5 ? 'up' : growth < -5 ? 'down' : 'flat';

  // Confidence interval for next-30 summary
  const ci30Delta = stdev * 1.96 * Math.sqrt(30);
  const confidenceLow30 = Math.max(0, Math.round(sum30 - ci30Delta));
  const confidenceHigh30 = Math.round(sum30 + ci30Delta);

  // Prepare historic series — last 60 days for context
  const history = dates.slice(-60).map((d, i) => ({
    date: d,
    actual: Math.round(values[values.length - 60 + i] || 0),
  }));

  return {
    daily: forecastPoints,
    history,
    summary: {
      next30: Math.round(sum30 * 100) / 100,
      next60: Math.round(sum60 * 100) / 100,
      next90: Math.round(sum90 * 100) / 100,
      prev30: Math.round(prev30),
      growthPct30: Math.round(growth * 10) / 10,
      trend,
      trendPercent: Math.round(growth * 10) / 10,
      seasonalityDetected,
      confidenceLow30,
      confidenceHigh30,
      method,
    },
  };
}
