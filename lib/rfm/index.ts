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
  // thresholds = [p20, p40, p60, p80] — ascending
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
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - recencyDays);

  const customers = await db.customer.findMany({
    where: { storeConnectionId },
    select: { externalId: true, lastOrderAt: true, ordersCount: true, totalSpent: true },
  });

  if (customers.length === 0) return { total: 0, segments: {} };

  const now = Date.now();
  const recencyValues: number[] = [];
  const frequencyValues: number[] = [];
  const monetaryValues: number[] = [];

  const customerData = customers.map((c) => {
    const daysSinceLastOrder = c.lastOrderAt
      ? Math.floor((now - new Date(c.lastOrderAt).getTime()) / (1000 * 60 * 60 * 24))
      : recencyDays;
    const recency = Math.max(0, recencyDays - daysSinceLastOrder); // higher = more recent
    const frequency = c.ordersCount;
    const monetary = Number(c.totalSpent);

    recencyValues.push(recency);
    frequencyValues.push(frequency);
    monetaryValues.push(monetary);

    return { externalId: c.externalId, recency, frequency, monetary };
  });

  const rThresholds = percentiles(recencyValues, [20, 40, 60, 80]);
  const fThresholds = percentiles(frequencyValues, [20, 40, 60, 80]);
  const mThresholds = percentiles(monetaryValues, [20, 40, 60, 80]);

  const segments: Record<string, number> = {};
  const upserts = customerData.map((c) => {
    const rScore = score(c.recency, rThresholds);
    const fScore = score(c.frequency, fThresholds);
    const mScore = score(c.monetary, mThresholds);
    const segment = getSegment(rScore, fScore, mScore);

    segments[segment] = (segments[segment] || 0) + 1;

    return db.rfmSegment.upsert({
      where: {
        storeConnectionId_customerExternalId: {
          storeConnectionId,
          customerExternalId: c.externalId,
        },
      },
      create: {
        storeConnectionId,
        customerExternalId: c.externalId,
        rScore,
        fScore,
        mScore,
        segment,
      },
      update: { rScore, fScore, mScore, segment, calculatedAt: new Date() },
    });
  });

  // Batch upserts in chunks of 50
  for (let i = 0; i < upserts.length; i += 50) {
    await Promise.all(upserts.slice(i, i + 50));
  }

  return { total: customers.length, segments };
}

export const SEGMENT_COLORS: Record<string, string> = {
  Champions: '#2ecc71',
  'Loyal Customers': '#27ae60',
  'Potential Loyalist': '#3498db',
  'Recent Customers': '#9b59b6',
  Promising: '#f39c12',
  'Need Attention': '#e67e22',
  'At Risk': '#e74c3c',
  Lost: '#95a5a6',
};
