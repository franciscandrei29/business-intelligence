import { db } from '~/lib/db.server';

const RFM_SEGMENTS: Record<string, { minR: number; maxR: number; minF: number; maxF: number; minM: number; maxM: number }> = {
  Champions:       { minR: 4, maxR: 5, minF: 4, maxF: 5, minM: 4, maxM: 5 },
  'Loyal Customers': { minR: 3, maxR: 5, minF: 3, maxF: 5, minM: 3, maxM: 5 },
  'Potential Loyalist': { minR: 4, maxR: 5, minF: 1, maxF: 3, minM: 1, maxM: 3 },
  'Recent Customers': { minR: 4, maxR: 5, minF: 1, maxF: 1, minM: 1, maxM: 5 },
  Promising:       { minR: 3, maxR: 4, minF: 1, maxF: 2, minM: 1, maxM: 2 },
  'Need Attention': { minR: 2, maxR: 3, minF: 2, maxF: 3, minM: 2, maxM: 3 },
  'At Risk':       { minR: 1, maxR: 2, minF: 3, maxF: 5, minM: 3, maxM: 5 },
  Lost:            { minR: 1, maxR: 2, minF: 1, maxF: 2, minM: 1, maxM: 2 },
};

function getSegment(r: number, f: number, m: number): string {
  for (const [name, range] of Object.entries(RFM_SEGMENTS)) {
    if (
      r >= range.minR && r <= range.maxR &&
      f >= range.minF && f <= range.maxF &&
      m >= range.minM && m <= range.maxM
    ) {
      return name;
    }
  }
  return 'Need Attention';
}

function score(value: number, thresholds: number[]): number {
  if (value <= thresholds[0]) return 1;
  if (value <= thresholds[1]) return 2;
  if (value <= thresholds[2]) return 3;
  if (value <= thresholds[3]) return 4;
  return 5;
}

function percentiles(values: number[], pcts: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  return pcts.map((p) => {
    const idx = Math.floor((p / 100) * sorted.length);
    return sorted[Math.min(idx, sorted.length - 1)] || 0;
  });
}

export async function calculateRfm(storeConnectionId: string, recencyDays = 365) {
  // Pull actual aggregates from Order table (customer.ordersCount/totalSpent may be stale
  // and also include non-buyers — Shopify syncs contacts without orders).
  const aggregates = await db.$queryRaw<Array<{ customerId: string; ordersCount: bigint; totalSpent: string; lastOrderAt: Date }>>`
    SELECT "customerId", COUNT(*)::bigint AS "ordersCount", SUM(total)::text AS "totalSpent", MAX("placedAt") AS "lastOrderAt"
    FROM "Order"
    WHERE "storeConnectionId" = ${storeConnectionId} AND "customerId" IS NOT NULL
    GROUP BY "customerId"
  `;

  if (aggregates.length === 0) return { total: 0, segments: {} };

  // Map customer.id -> externalId for upsert
  const customers = await db.customer.findMany({
    where: { storeConnectionId, id: { in: aggregates.map((a) => a.customerId) } },
    select: { id: true, externalId: true },
  });
  const idToExternal = new Map(customers.map((c) => [c.id, c.externalId]));

  const now = Date.now();
  const recencyValues: number[] = [];
  const frequencyValues: number[] = [];
  const monetaryValues: number[] = [];

  const customerData = aggregates.map((a) => {
    const daysSinceLastOrder = a.lastOrderAt
      ? Math.floor((now - new Date(a.lastOrderAt).getTime()) / (1000 * 60 * 60 * 24))
      : recencyDays;
    const recency = Math.max(0, recencyDays - daysSinceLastOrder);
    const frequency = Number(a.ordersCount);
    const monetary = Number(a.totalSpent);

    recencyValues.push(recency);
    frequencyValues.push(frequency);
    monetaryValues.push(monetary);

    return { customerId: a.customerId, recency, frequency, monetary };
  });

  const rThresholds = percentiles(recencyValues, [20, 40, 60, 80]);
  const fThresholds = percentiles(frequencyValues, [20, 40, 60, 80]);
  const mThresholds = percentiles(monetaryValues, [20, 40, 60, 80]);

  const segments: Record<string, number> = {};

  // Clear old segments for this store (some customers may have moved out of the buyer list)
  await db.rfmSegment.deleteMany({ where: { storeConnectionId } });

  // Serial writes to avoid PG connection pool saturation
  let written = 0;
  for (const c of customerData) {
    const rScore = score(c.recency, rThresholds);
    const fScore = score(c.frequency, fThresholds);
    const mScore = score(c.monetary, mThresholds);
    const segment = getSegment(rScore, fScore, mScore);

    segments[segment] = (segments[segment] || 0) + 1;

    const externalId = idToExternal.get(c.customerId);
    if (!externalId) continue;

    await db.rfmSegment.create({
      data: {
        storeConnectionId,
        customerExternalId: externalId,
        rScore, fScore, mScore, segment,
      },
    });
    written++;
  }

  return { total: customerData.length, written, segments };
}

export const SEGMENT_COLORS: Record<string, string> = {
  Champions: '#16a34a',
  'Loyal Customers': '#22c55e',
  'Potential Loyalist': '#2563eb',
  'Recent Customers': '#0ea5e9',
  Promising: '#FF5A1F',
  'Need Attention': '#d97706',
  'At Risk': '#dc2626',
  Lost: '#525252',
};
