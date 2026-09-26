import { db } from '~/lib/db.server';

interface ChurnPrediction {
  customerExternalId: string;
  email: string | null;
  name: string;
  churnScore: number; // 0-100 (100 = definitely churning)
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  daysSinceLastOrder: number;
  avgOrderGap: number;
  ordersCount: number;
  totalSpent: number;
  signals: string[];
}

export async function predictChurn(storeConnectionId: string): Promise<ChurnPrediction[]> {
  const customers = await db.customer.findMany({
    where: { storeConnectionId, ordersCount: { gte: 1 } },
    select: {
      externalId: true,
      email: true,
      firstName: true,
      lastName: true,
      ordersCount: true,
      totalSpent: true,
      firstOrderAt: true,
      lastOrderAt: true,
    },
  });

  if (customers.length === 0) return [];

  const now = Date.now();
  const predictions: ChurnPrediction[] = [];

  // Calculate store-wide averages for comparison
  const allGaps: number[] = [];
  const allRecencies: number[] = [];

  for (const c of customers) {
    if (!c.lastOrderAt) continue;
    const daysSinceLast = Math.floor((now - new Date(c.lastOrderAt).getTime()) / (1000 * 60 * 60 * 24));
    allRecencies.push(daysSinceLast);

    if (c.firstOrderAt && c.ordersCount > 1) {
      const totalDays = Math.max(1, Math.floor((new Date(c.lastOrderAt).getTime() - new Date(c.firstOrderAt).getTime()) / (1000 * 60 * 60 * 24)));
      const avgGap = totalDays / (c.ordersCount - 1);
      allGaps.push(avgGap);
    }
  }

  const medianRecency = allRecencies.sort((a, b) => a - b)[Math.floor(allRecencies.length / 2)] || 30;
  const medianGap = allGaps.length > 0 ? allGaps.sort((a, b) => a - b)[Math.floor(allGaps.length / 2)] : 30;

  for (const c of customers) {
    if (!c.lastOrderAt) continue;

    const daysSinceLast = Math.floor((now - new Date(c.lastOrderAt).getTime()) / (1000 * 60 * 60 * 24));
    const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Unknown';

    // Calculate average order gap for this customer
    let avgOrderGap = c.ordersCount === 1 ? 0 : medianGap;  // 0 = one-time buyer
    if (c.firstOrderAt && c.ordersCount > 1) {
      const totalDays = Math.max(1, Math.floor((new Date(c.lastOrderAt).getTime() - new Date(c.firstOrderAt).getTime()) / (1000 * 60 * 60 * 24)));
      avgOrderGap = totalDays / (c.ordersCount - 1);
    }

    // Churn scoring factors
    const signals: string[] = [];
    let score = 0;

    // Factor 1: Recency vs personal pattern (0-40 points)
    const recencyRatio = avgOrderGap > 0 ? daysSinceLast / avgOrderGap : daysSinceLast / medianGap;
    if (recencyRatio > 3) {
      score += 40;
      signals.push(`Nu a cumparat de ${daysSinceLast} zile (3x peste media sa de ${Math.round(avgOrderGap)} zile)`);
    } else if (recencyRatio > 2) {
      score += 30;
      signals.push(`Nu a cumparat de ${daysSinceLast} zile (2x peste media sa)`);
    } else if (recencyRatio > 1.5) {
      score += 15;
      signals.push(`Intarziere moderata: ${daysSinceLast} zile de la ultima comanda`);
    }

    // Factor 2: Frequency decay (0-25 points)
    if (c.ordersCount === 1 && daysSinceLast > 60) {
      score += 25;
      signals.push('Client one-time (o singura comanda, acum 60+ zile)');
    } else if (c.ordersCount === 1 && daysSinceLast > 30) {
      score += 15;
      signals.push('O singura comanda, 30+ zile de atunci');
    }

    // Factor 3: Recency vs store median (0-20 points)
    if (daysSinceLast > medianRecency * 2) {
      score += 20;
      signals.push(`Mult sub media magazinului (${medianRecency} zile recency mediana)`);
    } else if (daysSinceLast > medianRecency * 1.5) {
      score += 10;
    }

    // Factor 4: Monetary decline (0-15 points)
    const avgOrderValue = c.ordersCount > 0 ? Number(c.totalSpent) / c.ordersCount : 0;
    if (avgOrderValue < 50 && c.ordersCount <= 2) {
      score += 10;
      signals.push('Valoare medie mica a comenzilor');
    }

    // Cap at 100
    score = Math.min(100, score);

    const riskLevel: ChurnPrediction['riskLevel'] =
      score >= 75 ? 'critical' :
      score >= 50 ? 'high' :
      score >= 25 ? 'medium' : 'low';

    // Only include at-risk customers (score >= 20)
    if (score >= 20) {
      predictions.push({
        customerExternalId: c.externalId,
        email: c.email,
        name,
        churnScore: score,
        riskLevel,
        daysSinceLastOrder: daysSinceLast,
        avgOrderGap: Math.round(avgOrderGap),
        ordersCount: c.ordersCount,
        totalSpent: Number(c.totalSpent),
        signals,
      });
    }
  }

  // Sort by churn score descending
  predictions.sort((a, b) => b.churnScore - a.churnScore);
  return predictions;
}
