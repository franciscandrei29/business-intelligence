import { db } from '~/lib/db.server';

/**
 * Compute elapsed business hours between two dates.
 * Business hours: Mon-Fri, 09:00-17:00 (Europe/Bucharest).
 * Returns a number of hours (float).
 */
export function businessHoursBetween(start: Date, end: Date, opts: { startHour?: number; endHour?: number; workDays?: number[] } = {}): number {
  const startHour = opts.startHour ?? 9;
  const endHour = opts.endHour ?? 17;
  const workDays = opts.workDays ?? [1, 2, 3, 4, 5]; // Mon-Fri

  if (end <= start) return 0;

  let total = 0;
  const cursor = new Date(start);

  while (cursor < end) {
    const dow = cursor.getDay();
    const isWorkDay = workDays.includes(dow);
    const dayStart = new Date(cursor); dayStart.setHours(startHour, 0, 0, 0);
    const dayEnd = new Date(cursor); dayEnd.setHours(endHour, 0, 0, 0);

    if (isWorkDay) {
      const effStart = cursor > dayStart ? cursor : dayStart;
      const effEnd = end < dayEnd ? end : dayEnd;
      if (effEnd > effStart) {
        total += (effEnd.getTime() - effStart.getTime()) / 3600000;
      }
    }

    // Move to next day 00:00
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(0, 0, 0, 0);
  }

  return total;
}

export interface FulfilmentMetrics {
  ordersAnalyzed: number;
  fulfilled: number;
  unfulfilled: number;
  pendingOverdue: number; // unfulfilled > 8 business hours
  avgBusinessHours: number;
  medianBusinessHours: number;
  p90BusinessHours: number;
  pctUnderBusinessDay: number;
  pctUnderTwoBusinessDays: number;
  byDayOfWeek: Array<{ dow: string; avgHours: number; count: number }>;
  slowestOrders: Array<{ orderNumber: string | null; placedAt: string; fulfilledAt: string; businessHours: number }>;
  oldestUnfulfilled: Array<{ orderNumber: string | null; placedAt: string; businessHoursPending: number }>;
  period: { from: string; to: string };
}

const DOW_LABELS = ['Duminica', 'Luni', 'Marti', 'Miercuri', 'Joi', 'Vineri', 'Sambata'];

export async function computeFulfilmentMetrics(storeConnectionId: string, days = 30): Promise<FulfilmentMetrics> {
  const now = new Date();
  const start = new Date(now); start.setDate(start.getDate() - days);

  const orders = await db.order.findMany({
    where: { storeConnectionId, placedAt: { gte: start } },
    select: { orderNumber: true, placedAt: true, fulfilledAt: true, fulfillmentStatus: true },
  });

  const fulfilledOrders = orders.filter((o) => o.fulfilledAt);
  const unfulfilledOrders = orders.filter((o) => !o.fulfilledAt && o.fulfillmentStatus !== 'FULFILLED');

  // Business hours for fulfilled
  const hoursArr: number[] = [];
  const byDow: Record<number, { total: number; count: number }> = {};
  const perOrder: Array<{ orderNumber: string | null; placedAt: Date; fulfilledAt: Date; businessHours: number }> = [];

  for (const o of fulfilledOrders) {
    if (!o.fulfilledAt) continue;
    const h = businessHoursBetween(o.placedAt, o.fulfilledAt);
    hoursArr.push(h);
    const dow = o.placedAt.getDay();
    if (!byDow[dow]) byDow[dow] = { total: 0, count: 0 };
    byDow[dow].total += h;
    byDow[dow].count++;
    perOrder.push({ orderNumber: o.orderNumber, placedAt: o.placedAt, fulfilledAt: o.fulfilledAt, businessHours: h });
  }

  const sorted = [...hoursArr].sort((a, b) => a - b);
  const avg = hoursArr.length > 0 ? hoursArr.reduce((s, v) => s + v, 0) / hoursArr.length : 0;
  const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0;
  const p90 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.9)] : 0;
  const underBusinessDay = hoursArr.filter((h) => h <= 8).length;
  const underTwoBusinessDays = hoursArr.filter((h) => h <= 16).length;
  const pctUnderBD = hoursArr.length > 0 ? (underBusinessDay / hoursArr.length) * 100 : 0;
  const pctUnderTwoBD = hoursArr.length > 0 ? (underTwoBusinessDays / hoursArr.length) * 100 : 0;

  const byDayOfWeek = [1, 2, 3, 4, 5, 6, 0].map((d) => ({
    dow: DOW_LABELS[d],
    avgHours: byDow[d] && byDow[d].count > 0 ? Math.round((byDow[d].total / byDow[d].count) * 10) / 10 : 0,
    count: byDow[d]?.count || 0,
  }));

  const slowestOrders = perOrder
    .sort((a, b) => b.businessHours - a.businessHours)
    .slice(0, 10)
    .map((o) => ({
      orderNumber: o.orderNumber,
      placedAt: o.placedAt.toISOString(),
      fulfilledAt: o.fulfilledAt.toISOString(),
      businessHours: Math.round(o.businessHours * 10) / 10,
    }));

  // Oldest unfulfilled: how long have they been pending in business hours?
  const pendingWithHours = unfulfilledOrders
    .map((o) => ({
      orderNumber: o.orderNumber,
      placedAt: o.placedAt,
      businessHoursPending: businessHoursBetween(o.placedAt, now),
    }))
    .sort((a, b) => b.businessHoursPending - a.businessHoursPending);

  const pendingOverdue = pendingWithHours.filter((o) => o.businessHoursPending > 8).length;
  const oldestUnfulfilled = pendingWithHours.slice(0, 10).map((o) => ({
    orderNumber: o.orderNumber,
    placedAt: o.placedAt.toISOString(),
    businessHoursPending: Math.round(o.businessHoursPending * 10) / 10,
  }));

  return {
    ordersAnalyzed: orders.length,
    fulfilled: fulfilledOrders.length,
    unfulfilled: unfulfilledOrders.length,
    pendingOverdue,
    avgBusinessHours: Math.round(avg * 10) / 10,
    medianBusinessHours: Math.round(median * 10) / 10,
    p90BusinessHours: Math.round(p90 * 10) / 10,
    pctUnderBusinessDay: Math.round(pctUnderBD * 10) / 10,
    pctUnderTwoBusinessDays: Math.round(pctUnderTwoBD * 10) / 10,
    byDayOfWeek,
    slowestOrders,
    oldestUnfulfilled,
    period: { from: start.toISOString(), to: now.toISOString() },
  };
}
