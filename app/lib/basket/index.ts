import { db } from '~/lib/db.server';

export interface ProductPair {
  productA: string;
  productB: string;
  titleA: string;
  titleB: string;
  count: number;
  lift: number;
}

export async function calculateBasketAnalysis(storeConnectionId: string): Promise<ProductPair[]> {
  const orders = await db.order.findMany({
    where: { storeConnectionId },
    select: { lineItems: true },
  });

  const totalOrders = orders.length;
  if (totalOrders === 0) return [];

  // Count how many orders each product appears in
  const productFreq: Record<string, number> = {};
  const productTitles: Record<string, string> = {};
  // Count co-occurrences
  const pairFreq: Record<string, number> = {};

  for (const order of orders) {
    if (!order.lineItems) continue;
    let items: any[];
    try { items = JSON.parse(order.lineItems); } catch { continue; }

    const productIds: string[] = [];
    for (const item of items) {
      const pid = String(item.product_id || item.productId || item.externalId || '');
      const title = String(item.title || item.name || pid);
      if (!pid) continue;
      productIds.push(pid);
      productFreq[pid] = (productFreq[pid] || 0) + 1;
      if (!productTitles[pid]) productTitles[pid] = title;
    }

    // unique product ids in this order
    const unique = [...new Set(productIds)];
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const key = [unique[i], unique[j]].sort().join('||');
        pairFreq[key] = (pairFreq[key] || 0) + 1;
      }
    }
  }

  const pairs: ProductPair[] = [];
  for (const [key, count] of Object.entries(pairFreq)) {
    if (count < 2) continue;
    const [a, b] = key.split('||');
    const freqA = productFreq[a] || 1;
    const freqB = productFreq[b] || 1;
    // Lift = P(A and B) / (P(A) * P(B))
    const pAB = count / totalOrders;
    const pA = freqA / totalOrders;
    const pB = freqB / totalOrders;
    const lift = pAB / (pA * pB);

    pairs.push({
      productA: a,
      productB: b,
      titleA: productTitles[a] || a,
      titleB: productTitles[b] || b,
      count,
      lift: Math.round(lift * 100) / 100,
    });
  }

  pairs.sort((a, b) => b.count - a.count);
  return pairs.slice(0, 250);
}
