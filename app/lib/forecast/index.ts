import { db } from '~/lib/db.server';

interface ForecastPoint {
  date: string;
  predicted: number;
  lower: number;
  upper: number;
  conservative: number;
  optimistic: number;
}

interface ForecastResult {
  daily: ForecastPoint[];
  history: Array<{ date: string; actual: number }>;
  scenarios: {
    conservative: { next30: number; next60: number; next90: number; label: string };
    base: { next30: number; next60: number; next90: number; label: string };
    optimistic: { next30: number; next60: number; next90: number; label: string };
  };
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
    baseline: number;
    medianDaily: number;
    trendPerDay: number;
    yoyAvailable: boolean;
    yoyGrowthPct?: number;
    yoySeasonalityApplied: boolean;
    modelsUsed: string[];
  };
}

function median(vals: number[]): number {
  if (vals.length === 0) return 0;
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function trimmedMean(vals: number[], trim = 0.1): number {
  if (vals.length === 0) return 0;
  const sorted = [...vals].sort((a, b) => a - b);
  const k = Math.floor(sorted.length * trim);
  const trimmed = sorted.slice(k, sorted.length - k);
  return trimmed.reduce((s, v) => s + v, 0) / Math.max(1, trimmed.length);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Romanian e-commerce seasonal calendar — damped, realistic multipliers.
 * Based on typical Romanian D2C e-commerce patterns.
 */
function ecomSeasonalMultiplier(date: Date): number {
  const m = date.getMonth();
  const d = date.getDate();

  const monthly = [
    0.85, // Ian — post-sarbatori
    0.92, // Feb
    1.00, // Mar
    1.02, // Apr — Easter bump averaged
    0.98, // May
    0.90, // Iun — sezonul estival incepe
    0.85, // Iul — vacante
    0.82, // Aug — vacante peak
    1.00, // Sep — back to school
    1.05, // Oct
    1.35, // Nov — Black Friday averaged over full month
    1.18, // Dec — Christmas shopping averaged
  ];
  let f = monthly[m];

  // Specific events (conservative bumps — not too aggressive)
  if (m === 0 && d <= 5) f *= 0.75; // Jan slump
  if (m === 1 && d >= 10 && d <= 14) f *= 1.10; // Valentine's
  if (m === 2 && d >= 5 && d <= 8) f *= 1.15; // 8 Martie
  if (m === 4 && d >= 1 && d <= 3) f *= 0.75; // 1 Mai
  if (m === 5 && d >= 1 && d <= 3) f *= 1.08; // Ziua Copilului
  if (m === 7 && d >= 12 && d <= 18) f *= 0.80; // Sf. Maria
  if (m === 8 && d >= 1 && d <= 10) f *= 1.12; // Back to school
  if (m === 10 && d >= 20 && d <= 30) f *= 1.8; // Black Friday week (already 1.35 × 1.8 = ~2.4x)
  if (m === 11 && d >= 1 && d <= 7) f *= 1.25; // Cyber Monday
  if (m === 11 && d >= 15 && d <= 23) f *= 1.35; // Christmas shopping
  if (m === 11 && d >= 24) f *= 0.60; // Post-Christmas

  return f;
}

export async function generateForecast(storeConnectionId: string, daysToForecast = 90): Promise<ForecastResult> {
  const now = new Date(); now.setHours(23, 59, 59, 999);
  const start = new Date(now); start.setFullYear(start.getFullYear() - 2); start.setHours(0, 0, 0, 0);

  const orders = await db.order.findMany({
    where: { storeConnectionId, placedAt: { gte: start, lte: now } },
    select: { placedAt: true, total: true },
    orderBy: { placedAt: 'asc' },
  });

  if (orders.length === 0) return emptyResult();

  // Daily series
  const dailyMap = new Map<string, number>();
  for (let d = new Date(start); d <= now; d.setDate(d.getDate() + 1)) {
    dailyMap.set(d.toISOString().slice(0, 10), 0);
  }
  for (const o of orders) {
    const k = o.placedAt.toISOString().slice(0, 10);
    if (dailyMap.has(k)) dailyMap.set(k, (dailyMap.get(k) || 0) + Number(o.total));
  }
  const dates = [...dailyMap.keys()].sort();
  const values = dates.map((d) => dailyMap.get(d) || 0);

  // ===== Baseline: robust trimmed mean of last 28 days (IGNORES zero-outlier days) =====
  const last28 = values.slice(-28);
  const nonZero28 = last28.filter((v) => v > 0);
  const baseline = nonZero28.length >= 10 ? trimmedMean(nonZero28, 0.1) : trimmedMean(last28, 0.1);
  const medianDaily = median(last28);

  // ===== Momentum (info only) =====
  const last14 = values.slice(-14);
  const prev14 = values.slice(-28, -14);
  const recentMean = last14.length > 0 ? last14.reduce((s, v) => s + v, 0) / last14.length : 0;
  const priorMean = prev14.length > 0 ? prev14.reduce((s, v) => s + v, 0) / prev14.length : 0;
  const momentumPct = priorMean > 0 ? ((recentMean - priorMean) / priorMean) * 100 : 0;
  const trendPerDay = priorMean > 0 ? (recentMean - priorMean) / 14 : 0;

  // ===== DoW factors from last 56 days (only non-zero days) =====
  const last56Values = values.slice(-56);
  const last56Dates = dates.slice(-56);
  const dowSum = Array(7).fill(0);
  const dowCount = Array(7).fill(0);
  for (let i = 0; i < last56Values.length; i++) {
    if (last56Values[i] === 0) continue; // skip outages
    const dow = new Date(last56Dates[i] + 'T12:00:00Z').getUTCDay();
    dowSum[dow] += last56Values[i];
    dowCount[dow]++;
  }
  const dowAvg = dowSum.map((s, i) => (dowCount[i] > 0 ? s / dowCount[i] : 0));
  const overallAvg = dowAvg.reduce((a, b) => a + b, 0) / 7;
  const dowFactors = dowAvg.map((a) => (overallAvg > 0 ? a / overallAvg : 1));
  const seasonalityDetected = Math.max(...dowFactors) - Math.min(...dowFactors) > 0.25;

  // ===== YoY validation: do we have RELIABLE 1-year-ago baseline? =====
  // Must have enough non-zero prior year days (>20 out of 28) and similar magnitude range
  let yoyAvailable = false;
  let yoyBaselinePriorYear = 0;
  let yoyGrowthPct: number | undefined;
  let scaleRatio = 1;
  const oneYearAgoIdx = dates.length - 365;

  if (oneYearAgoIdx >= 28) {
    const priorYearWindow = values.slice(oneYearAgoIdx - 28, oneYearAgoIdx);
    const priorNonZero = priorYearWindow.filter((v) => v > 0);
    if (priorNonZero.length >= 20) {
      yoyBaselinePriorYear = trimmedMean(priorNonZero, 0.1);
      if (yoyBaselinePriorYear > 0) {
        yoyAvailable = true;
        yoyGrowthPct = ((baseline - yoyBaselinePriorYear) / yoyBaselinePriorYear) * 100;
        // CRITICAL: clamp scale ratio — extreme ratios indicate data gaps, not real growth
        scaleRatio = clamp(baseline / yoyBaselinePriorYear, 0.5, 2.0);
      }
    }
  }

  // Prior year rolling mean around a date (7-day window)
  const valueByDate = dailyMap;
  function priorYearMean(forecastDate: Date, radiusDays = 3): number | null {
    if (!yoyAvailable) return null;
    const priorDate = new Date(forecastDate);
    priorDate.setFullYear(priorDate.getFullYear() - 1);
    let sum = 0;
    let count = 0;
    let nonZero = 0;
    for (let d = -radiusDays; d <= radiusDays; d++) {
      const probe = new Date(priorDate);
      probe.setDate(probe.getDate() + d);
      const key = probe.toISOString().slice(0, 10);
      if (valueByDate.has(key)) {
        const v = valueByDate.get(key) || 0;
        sum += v;
        count++;
        if (v > 0) nonZero++;
      }
    }
    // Need at least half non-zero in window to trust it
    if (count === 0 || nonZero < Math.max(2, Math.floor(count / 2))) return null;
    return sum / count;
  }

  // ===== Residual stdev from baseline-DoW expectation =====
  const residuals = last28.map((v, i) => {
    const dow = new Date(dates[dates.length - last28.length + i] + 'T12:00:00Z').getUTCDay();
    const expected = baseline * dowFactors[dow];
    return v - expected;
  });
  const stdev = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / Math.max(1, residuals.length));

  // ===== ENSEMBLE FORECAST =====
  // For each forecast day, compute 4 candidate predictions and take the MEDIAN (robust).
  // Models:
  //   1. Baseline × DoW factor (flat)
  //   2. Baseline × DoW × calendar RO (structural seasonality)
  //   3. YoY same-week value × scaleRatio (if available)
  //   4. Median of last 4 occurrences of same DoW (recent trend captured)

  // Pre-compute "median of last 4 occurrences of each DoW"
  const recentByDow: number[][] = Array.from({ length: 7 }, () => []);
  for (let i = Math.max(0, dates.length - 28); i < dates.length; i++) {
    const dow = new Date(dates[i] + 'T12:00:00Z').getUTCDay();
    if (values[i] > 0) recentByDow[dow].push(values[i]);
  }
  const dowRecentMedian = recentByDow.map((arr) => arr.length > 0 ? median(arr) : baseline);

  const modelsUsed: string[] = ['baseline-dow', 'calendar-ro', 'dow-recent-median'];
  if (yoyAvailable) modelsUsed.push('yoy-scaled');

  const conservativeRate = Math.pow(0.95, 1 / 30) - 1;
  const optimisticRate = Math.pow(1.05, 1 / 30) - 1;

  const forecast: ForecastPoint[] = [];
  let sum30 = 0, sum60 = 0, sum90 = 0;
  let consSum30 = 0, consSum60 = 0, consSum90 = 0;
  let optSum30 = 0, optSum60 = 0, optSum90 = 0;
  let yoySeasonalityApplied = false;

  // Hard bounds — forecast cannot be <40% or >300% of baseline except for known high-season weeks
  const softMin = baseline * 0.4;
  const softMax = baseline * 3.0;

  for (let h = 1; h <= daysToForecast; h++) {
    const fd = new Date(now); fd.setDate(fd.getDate() + h); fd.setHours(12, 0, 0, 0);
    const dow = fd.getUTCDay();

    const dowFactor = seasonalityDetected ? dowFactors[dow] : 1;
    const calendarFactor = clamp(ecomSeasonalMultiplier(fd) / ecomSeasonalMultiplier(now), 0.5, 2.5);

    // Model 1: Flat baseline × DoW
    const m1 = baseline * dowFactor;
    // Model 2: Baseline × DoW × Calendar RO
    const m2 = baseline * dowFactor * calendarFactor;
    // Model 3: Recent-DoW median × calendar factor
    const m3 = dowRecentMedian[dow] * calendarFactor;
    // Model 4: YoY scaled (if available)
    let m4: number | null = null;
    const priorY = priorYearMean(fd, 3);
    if (priorY !== null && priorY > 0) {
      m4 = priorY * scaleRatio;
      yoySeasonalityApplied = true;
    }

    // Ensemble: median of available models (excluding extreme outliers)
    const candidates = [m1, m2, m3];
    if (m4 !== null) candidates.push(m4);
    const ensemble = median(candidates);

    // Apply soft bounds
    const base = clamp(ensemble, softMin, softMax);

    const cons = base * Math.pow(1 + conservativeRate, h);
    const opt = base * Math.pow(1 + optimisticRate, h);

    const uncertainty = stdev * 1.96 * Math.sqrt(1 + h / 60);
    const lower = Math.max(0, base - uncertainty);
    const upper = base + uncertainty;

    forecast.push({
      date: fd.toISOString().slice(0, 10),
      predicted: Math.round(base * 100) / 100,
      lower: Math.round(lower * 100) / 100,
      upper: Math.round(upper * 100) / 100,
      conservative: Math.round(cons * 100) / 100,
      optimistic: Math.round(opt * 100) / 100,
    });

    if (h <= 30) { sum30 += base; consSum30 += cons; optSum30 += opt; }
    if (h <= 60) { sum60 += base; consSum60 += cons; optSum60 += opt; }
    sum90 += base; consSum90 += cons; optSum90 += opt;
  }

  const prev30 = values.slice(-30).reduce((s, v) => s + v, 0);
  const growthPct30 = prev30 > 0 ? ((sum30 - prev30) / prev30) * 100 : 0;
  const trendLabel: 'up' | 'down' | 'flat' =
    growthPct30 > 2 ? "up" : growthPct30 < -2 ? "down" : "flat";

  const ci30Delta = stdev * 1.96 * Math.sqrt(30);
  const confidenceLow30 = Math.max(0, Math.round(sum30 - ci30Delta));
  const confidenceHigh30 = Math.round(sum30 + ci30Delta);

  const history = dates.slice(-60).map((d, i) => ({
    date: d,
    actual: Math.round(values[values.length - 60 + i] || 0),
  }));

  return {
    daily: forecast,
    history,
    scenarios: {
      conservative: { next30: Math.round(consSum30), next60: Math.round(consSum60), next90: Math.round(consSum90), label: '-5% / luna' },
      base: { next30: Math.round(sum30), next60: Math.round(sum60), next90: Math.round(sum90), label: `Ensemble (${modelsUsed.length} modele)` },
      optimistic: { next30: Math.round(optSum30), next60: Math.round(optSum60), next90: Math.round(optSum90), label: '+5% / luna' },
    },
    summary: {
      next30: Math.round(sum30 * 100) / 100,
      next60: Math.round(sum60 * 100) / 100,
      next90: Math.round(sum90 * 100) / 100,
      prev30: Math.round(prev30),
      growthPct30: Math.round(growthPct30 * 10) / 10,
      trend: trendLabel,
      trendPercent: Math.round(momentumPct * 10) / 10,
      seasonalityDetected,
      confidenceLow30,
      confidenceHigh30,
      method: `ensemble-median: ${modelsUsed.join(' + ')}`,
      baseline: Math.round(baseline),
      medianDaily: Math.round(medianDaily),
      trendPerDay: Math.round(trendPerDay * 100) / 100,
      yoyAvailable,
      yoyGrowthPct: yoyGrowthPct !== undefined ? Math.round(yoyGrowthPct * 10) / 10 : undefined,
      yoySeasonalityApplied,
      modelsUsed,
    },
  };
}

function emptyResult(): ForecastResult {
  return {
    daily: [], history: [],
    scenarios: {
      conservative: { next30: 0, next60: 0, next90: 0, label: '-5% / luna' },
      base: { next30: 0, next60: 0, next90: 0, label: 'Flat' },
      optimistic: { next30: 0, next60: 0, next90: 0, label: '+5% / luna' },
    },
    summary: {
      next30: 0, next60: 0, next90: 0, prev30: 0, growthPct30: 0,
      trend: 'flat', trendPercent: 0, seasonalityDetected: false,
      confidenceLow30: 0, confidenceHigh30: 0, method: 'no-data',
      baseline: 0, medianDaily: 0, trendPerDay: 0,
      yoyAvailable: false, yoySeasonalityApplied: false, modelsUsed: [],
    },
  };
}
