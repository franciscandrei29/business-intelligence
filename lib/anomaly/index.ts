import { db } from '~/lib/db.server';

export interface Anomaly {
  type: 'revenue_drop' | 'revenue_spike' | 'orders_drop' | 'orders_spike' | 'zero_day' | 'aov_shift';
  severity: 'info' | 'warning' | 'critical';
  metric: string;
  currentValue: number;
  expectedValue: number;
  deviationPercent: number;
  zScore: number;
  date: string;
  dayOfWeek: string;
  message: string;
  context?: string;
}

const DOW_NAMES = ['Duminica', 'Luni', 'Marti', 'Miercuri', 'Joi', 'Vineri', 'Sambata'];

/**
 * DoW-aware anomaly detection: compares each day to same-day-of-week baseline
 * over the previous 8 weeks. Avoids false positives on weekends.
 */
export async function detectAnomalies(storeConnectionId: string): Promise<Anomaly[]> {
  const anomalies: Anomaly[] = [];

  // Pull 70 days to have ~8 weeks of baseline + 14 days detection window
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

  // Daily aggregates
  const dailyRev = new Map<string, number>();
  const dailyOrd = new Map<string, number>();
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

  // DoW-aware detection
  function analyze(values: Map<string, number>, metricName: string, drop: Anomaly['type'], spike: Anomaly['type']) {
    for (const date of detectDates) {
      const d = new Date(date + 'T12:00:00Z');
      const dow = d.getUTCDay();

      // Build baseline: same DoW in the 56 days before this date (8 prior weeks)
      const baselineValues: number[] = [];
      for (let k = 1; k <= 8; k++) {
        const priorDate = new Date(d);
        priorDate.setUTCDate(priorDate.getUTCDate() - 7 * k);
        const priorStr = priorDate.toISOString().slice(0, 10);
        if (values.has(priorStr)) baselineValues.push(values.get(priorStr) || 0);
      }
      if (baselineValues.length < 3) continue; // not enough history

      const mean = baselineValues.reduce((a, b) => a + b, 0) / baselineValues.length;
      const variance = baselineValues.reduce((a, v) => a + (v - mean) ** 2, 0) / baselineValues.length;
      const stdDev = Math.sqrt(variance);
      const current = values.get(date) || 0;

      // Thresholds: need stddev > 0, current value either very different from mean
      if (mean < 1 && current < 1) continue; // quiet metric, skip
      const z = stdDev > 0.5 ? (current - mean) / stdDev : 0;
      const deviation = mean > 0 ? ((current - mean) / mean) * 100 : 0;

      // Zero day when mean > 5
      if (current === 0 && mean > 5) {
        anomalies.push({
          type: 'zero_day',
          severity: 'critical',
          metric: metricName,
          currentValue: 0,
          expectedValue: Math.round(mean * 100) / 100,
          deviationPercent: -100,
          zScore: -99,
          date,
          dayOfWeek: DOW_NAMES[dow],
          message: `Zero ${metricName.toLowerCase()} intr-o zi de ${DOW_NAMES[dow]}`,
          context: `Media pentru ${DOW_NAMES[dow]} in ultimele 8 saptamani: ${Math.round(mean)}`,
        });
        continue;
      }

      // Drop: z < -2 AND deviation < -30%
      if (z <= -2 && deviation <= -30) {
        const severity: Anomaly['severity'] = deviation < -60 ? 'critical' : 'warning';
        anomalies.push({
          type: drop,
          severity,
          metric: metricName,
          currentValue: Math.round(current * 100) / 100,
          expectedValue: Math.round(mean * 100) / 100,
          deviationPercent: Math.round(deviation * 10) / 10,
          zScore: Math.round(z * 100) / 100,
          date,
          dayOfWeek: DOW_NAMES[dow],
          message: `${metricName} in scadere cu ${Math.abs(Math.round(deviation))}% vs ${DOW_NAMES[dow]} obisnuit`,
          context: `Asteptat ${Math.round(mean)}, primit ${Math.round(current)} (z-score ${z.toFixed(1)})`,
        });
      }
      // Spike: z > 2 AND deviation > 50%
      else if (z >= 2 && deviation >= 50) {
        anomalies.push({
          type: spike,
          severity: 'info',
          metric: metricName,
          currentValue: Math.round(current * 100) / 100,
          expectedValue: Math.round(mean * 100) / 100,
          deviationPercent: Math.round(deviation * 10) / 10,
          zScore: Math.round(z * 100) / 100,
          date,
          dayOfWeek: DOW_NAMES[dow],
          message: `${metricName} in crestere cu ${Math.round(deviation)}% vs ${DOW_NAMES[dow]} obisnuit`,
          context: `Asteptat ${Math.round(mean)}, primit ${Math.round(current)} (z-score ${z.toFixed(1)})`,
        });
      }
    }
  }

  analyze(dailyRev, 'Venit', 'revenue_drop', 'revenue_spike');
  analyze(dailyOrd, 'Comenzi', 'orders_drop', 'orders_spike');

  // AOV shift detection (last 7 vs previous 7-week baseline)
  const recent7Start = new Date(); recent7Start.setDate(recent7Start.getDate() - 7);
  const recentOrders = orders.filter((o) => o.placedAt >= recent7Start);
  const priorOrders = orders.filter((o) => o.placedAt < recent7Start);
  if (recentOrders.length >= 10 && priorOrders.length >= 30) {
    const recentAov = recentOrders.reduce((s, o) => s + Number(o.total), 0) / recentOrders.length;
    const priorAov = priorOrders.reduce((s, o) => s + Number(o.total), 0) / priorOrders.length;
    const aovDev = priorAov > 0 ? ((recentAov - priorAov) / priorAov) * 100 : 0;
    if (Math.abs(aovDev) > 15) {
      anomalies.push({
        type: 'aov_shift',
        severity: Math.abs(aovDev) > 30 ? 'warning' : 'info',
        metric: 'AOV',
        currentValue: Math.round(recentAov * 100) / 100,
        expectedValue: Math.round(priorAov * 100) / 100,
        deviationPercent: Math.round(aovDev * 10) / 10,
        zScore: 0,
        date: new Date().toISOString().slice(0, 10),
        dayOfWeek: 'Ultima saptamana',
        message: `AOV s-a modificat cu ${aovDev > 0 ? '+' : ''}${Math.round(aovDev)}% in ultimele 7 zile`,
        context: `Actual ${Math.round(recentAov)} RON vs media istorica ${Math.round(priorAov)} RON`,
      });
    }
  }

  // Sort: critical first, then by date desc
  const sev: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  anomalies.sort((a, b) => {
    const s = sev[a.severity] - sev[b.severity];
    if (s !== 0) return s;
    return b.date.localeCompare(a.date);
  });

  return anomalies;
}
