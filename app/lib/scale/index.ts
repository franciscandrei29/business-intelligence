import { db } from '~/lib/db.server';

export interface ScaleFactor {
  name: string;
  score: number;
  weight: number;
  status: 'excellent' | 'good' | 'warning' | 'critical';
  insight: string;
  details?: string;
}

export interface ScaleReadiness {
  overallScore: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  verdict: string;
  factors: ScaleFactor[];
  recommendations: string[];
  meta: {
    period: string;
    generatedAt: Date;
  };
}

function statusOf(score: number): ScaleFactor['status'] {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'warning';
  return 'critical';
}

function fmtMoney(n: number): string { return `${Math.round(n).toLocaleString('ro-RO')} RON`; }

export async function calculateScaleReadiness(storeConnectionId: string): Promise<ScaleReadiness> {
  const now = new Date();
  const d30 = new Date(now); d30.setDate(d30.getDate() - 30);
  const d60 = new Date(now); d60.setDate(d60.getDate() - 60);
  const d90 = new Date(now); d90.setDate(d90.getDate() - 90);

  const [
    productCount, activeProducts, productsWithCost, productsWithImage, outOfStock,
    customerTotal, customerActive, customerRepeat, customerNew30,
    orders30, orders60_30, orders90Full,
    rfmSegments,
  ] = await Promise.all([
    db.product.count({ where: { storeConnectionId } }),
    db.product.count({ where: { storeConnectionId, status: 'active' } }),
    db.product.count({ where: { storeConnectionId, costPerUnit: { gt: 0 } } }),
    db.product.count({ where: { storeConnectionId, imageUrl: { not: null } } }),
    db.product.count({ where: { storeConnectionId, inventory: { lte: 0 } } }),
    db.customer.count({ where: { storeConnectionId } }),
    db.customer.count({ where: { storeConnectionId, ordersCount: { gte: 1 } } }),
    db.customer.count({ where: { storeConnectionId, ordersCount: { gte: 2 } } }),
    db.customer.count({ where: { storeConnectionId, firstOrderAt: { gte: d30 } } }),
    db.order.findMany({
      where: { storeConnectionId, placedAt: { gte: d30 } },
      select: { total: true, placedAt: true, lineItems: true, customerId: true, discountTotal: true },
    }),
    db.order.findMany({
      where: { storeConnectionId, placedAt: { gte: d60, lt: d30 } },
      select: { total: true },
    }),
    db.order.findMany({
      where: { storeConnectionId, placedAt: { gte: d90 } },
      select: { placedAt: true, total: true },
    }),
    db.rfmSegment.groupBy({
      by: ['segment'],
      where: { storeConnectionId },
      _count: { segment: true },
    }),
  ]);

  const factors: ScaleFactor[] = [];
  const recommendations: string[] = [];

  // 1. Revenue growth (weight 20)
  const rev30 = orders30.reduce((s, o) => s + Number(o.total), 0);
  const rev60_30 = orders60_30.reduce((s, o) => s + Number(o.total), 0);
  const growthPct = rev60_30 > 0 ? ((rev30 - rev60_30) / rev60_30) * 100 : 0;
  let growthScore = 30;
  if (orders30.length === 0) growthScore = 10;
  else if (growthPct >= 25) growthScore = 95;
  else if (growthPct >= 10) growthScore = 80;
  else if (growthPct >= 0) growthScore = 65;
  else if (growthPct >= -15) growthScore = 45;
  else growthScore = 25;
  factors.push({
    name: 'Crestere venit (MoM)',
    score: growthScore, weight: 20, status: statusOf(growthScore),
    insight: `${growthPct >= 0 ? '+' : ''}${growthPct.toFixed(1)}%`,
    details: `${fmtMoney(rev30)} luna aceasta vs ${fmtMoney(rev60_30)} luna trecuta`,
  });
  if (growthPct < 0) recommendations.push('Venitul scade luna peste luna. Analizeaza canale de achizitie si ruleaza campanii de reactivare pentru Lost & At Risk.');

  // 2. Repeat rate (weight 15)
  const repeatRate = customerActive > 0 ? (customerRepeat / customerActive) * 100 : 0;
  let repeatScore = 20;
  if (repeatRate >= 30) repeatScore = 95;
  else if (repeatRate >= 20) repeatScore = 80;
  else if (repeatRate >= 12) repeatScore = 65;
  else if (repeatRate >= 6) repeatScore = 45;
  else repeatScore = 25;
  factors.push({
    name: 'Rata repeat purchase',
    score: repeatScore, weight: 15, status: statusOf(repeatScore),
    insight: `${repeatRate.toFixed(1)}%`,
    details: `${customerRepeat.toLocaleString('ro-RO')} din ${customerActive.toLocaleString('ro-RO')} clienti revin`,
  });
  if (repeatRate < 15) recommendations.push('Rata de repeat purchase sub 15%. Implementeaza email flows post-cumparare, loyalty program si cross-sell automat.');

  // 3. Gross margin (weight 15)
  const costMap = new Map<string, number>();
  const skuToId = new Map<string, string>();
  const productsWithCostData = await db.product.findMany({
    where: { storeConnectionId },
    select: { externalId: true, costPerUnit: true, sku: true },
  });
  for (const p of productsWithCostData) {
    if (p.costPerUnit && Number(p.costPerUnit) > 0) costMap.set(p.externalId, Number(p.costPerUnit));
    if (p.sku) skuToId.set(p.sku, p.externalId);
  }
  let totalCOGS = 0;
  for (const o of orders30) {
    if (!o.lineItems) continue;
    try {
      const items = JSON.parse(o.lineItems);
      for (const it of items) {
        let pid = String(it.product_id || it.productId || '');
        if (!pid && it.sku) pid = skuToId.get(String(it.sku)) || '';
        const cost = pid ? costMap.get(pid) || 0 : 0;
        totalCOGS += cost * Number(it.quantity || 0);
      }
    } catch {}
  }
  const grossMargin = rev30 > 0 ? ((rev30 - totalCOGS) / rev30) * 100 : 0;
  const hasCostData = costMap.size > 0;
  let marginScore = 40;
  if (!hasCostData) marginScore = 35;
  else if (grossMargin >= 60) marginScore = 95;
  else if (grossMargin >= 45) marginScore = 80;
  else if (grossMargin >= 30) marginScore = 60;
  else if (grossMargin >= 15) marginScore = 40;
  else marginScore = 25;
  factors.push({
    name: 'Marja bruta',
    score: marginScore, weight: 15, status: statusOf(marginScore),
    insight: hasCostData ? `${grossMargin.toFixed(1)}%` : 'Lipsa date cost',
    details: hasCostData ? `COGS estimat ${fmtMoney(totalCOGS)} pe ${fmtMoney(rev30)} venit` : `${productsWithCost}/${productCount} produse cu cost setat`,
  });
  if (!hasCostData) recommendations.push('Seteaza costPerUnit pe produse (in /profitability) pentru calcul marja reala. Fara asta nu poti planifica ad spend corect.');
  else if (grossMargin < 40) recommendations.push('Marja bruta sub 40%. Renegociaza cu furnizorii sau creste pretul la produsele inelastice (top-20 dupa unitati).');

  // 4. Stock health (weight 10)
  const outOfStockPct = productCount > 0 ? (outOfStock / productCount) * 100 : 0;
  // dead stock check (products with stock but no sales in 90d)
  const soldIds = new Set<string>();
  for (const o of orders90Full) {
    // too expensive to parse lineItems here for all; approximate via the loop above is enough for SCALE
  }
  const ordersWithItems90 = await db.order.findMany({
    where: { storeConnectionId, placedAt: { gte: d90 } },
    select: { lineItems: true },
  });
  for (const o of ordersWithItems90) {
    if (!o.lineItems) continue;
    try {
      const items = JSON.parse(o.lineItems);
      for (const it of items) {
        let pid = String(it.product_id || it.productId || '');
        if (!pid && it.sku) pid = skuToId.get(String(it.sku)) || '';
        if (pid) soldIds.add(pid);
      }
    } catch {}
  }
  const stockedProducts = await db.product.count({ where: { storeConnectionId, inventory: { gt: 0 } } });
  const deadStockProducts = await db.product.findMany({
    where: { storeConnectionId, inventory: { gt: 0 } },
    select: { externalId: true },
  });
  const deadCount = deadStockProducts.filter((p) => !soldIds.has(p.externalId)).length;
  const deadPct = stockedProducts > 0 ? (deadCount / stockedProducts) * 100 : 0;

  let stockScore = 30;
  if (outOfStockPct < 5) stockScore += 35;
  else if (outOfStockPct < 15) stockScore += 20;
  else if (outOfStockPct < 30) stockScore += 10;
  if (deadPct < 20) stockScore += 35;
  else if (deadPct < 40) stockScore += 20;
  else if (deadPct < 60) stockScore += 10;
  stockScore = Math.min(100, stockScore);
  factors.push({
    name: 'Sanatate stoc',
    score: stockScore, weight: 10, status: statusOf(stockScore),
    insight: `${outOfStockPct.toFixed(0)}% OOS, ${deadPct.toFixed(0)}% dead`,
    details: `${outOfStock} produse out-of-stock, ${deadCount} produse fara vanzari in 90 zile`,
  });
  if (outOfStockPct > 15) recommendations.push(`Ai ${outOfStock} produse fara stoc (${outOfStockPct.toFixed(0)}%). Reaprovizionează — pierzi vanzari acum.`);
  if (deadPct > 40) recommendations.push(`${deadCount} produse (${deadPct.toFixed(0)}% din cele cu stoc) nu s-au vandut in 90 zile. Ruleaza campanie de clearance sau delisteaza.`);

  // 5. Catalog quality (weight 10)
  const costCoverage = productCount > 0 ? (productsWithCost / productCount) * 100 : 0;
  const imageCoverage = productCount > 0 ? (productsWithImage / productCount) * 100 : 0;
  let catalogScore = 20;
  if (activeProducts >= 50) catalogScore += 25;
  else if (activeProducts >= 20) catalogScore += 15;
  else if (activeProducts >= 5) catalogScore += 8;
  if (costCoverage >= 70) catalogScore += 30;
  else if (costCoverage >= 40) catalogScore += 18;
  else if (costCoverage >= 10) catalogScore += 8;
  if (imageCoverage >= 95) catalogScore += 25;
  else if (imageCoverage >= 80) catalogScore += 15;
  else if (imageCoverage >= 60) catalogScore += 8;
  catalogScore = Math.min(100, catalogScore);
  factors.push({
    name: 'Calitate catalog',
    score: catalogScore, weight: 10, status: statusOf(catalogScore),
    insight: `${activeProducts} active`,
    details: `${costCoverage.toFixed(0)}% cu cost, ${imageCoverage.toFixed(0)}% cu imagine`,
  });

  // 6. Customer base & acquisition (weight 10)
  const baselineNew30 = customerActive > 100 ? customerActive * 0.05 : 5; // expect 5% new/month as baseline
  const newRatio = baselineNew30 > 0 ? customerNew30 / baselineNew30 : 0;
  let customerScore = 20;
  if (customerActive >= 500) customerScore += 20;
  else if (customerActive >= 100) customerScore += 12;
  else if (customerActive >= 30) customerScore += 6;
  if (newRatio >= 1) customerScore += 35;
  else if (newRatio >= 0.5) customerScore += 20;
  else if (newRatio >= 0.2) customerScore += 10;
  if (customerNew30 >= 30) customerScore += 25;
  else if (customerNew30 >= 10) customerScore += 15;
  else if (customerNew30 > 0) customerScore += 5;
  customerScore = Math.min(100, customerScore);
  factors.push({
    name: 'Baza de clienti',
    score: customerScore, weight: 10, status: statusOf(customerScore),
    insight: `${customerActive.toLocaleString('ro-RO')} activi`,
    details: `${customerNew30} clienti noi luna aceasta`,
  });
  if (customerNew30 < 10 && customerActive < 500) recommendations.push('Baza de clienti creste lent. Aloca buget predictibil pentru Meta Ads si Google Shopping.');

  // 7. Order volume consistency (weight 10) — CV of daily revenue
  const byDay = new Map<string, number>();
  for (let i = 0; i < 30; i++) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    byDay.set(d.toISOString().slice(0, 10), 0);
  }
  for (const o of orders30) {
    const k = o.placedAt.toISOString().slice(0, 10);
    byDay.set(k, (byDay.get(k) || 0) + Number(o.total));
  }
  const values = [...byDay.values()];
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = mean > 0 ? values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length : 0;
  const stdDev = Math.sqrt(variance);
  const cv = mean > 0 ? stdDev / mean : 0; // coefficient of variation
  let consistencyScore = 30;
  if (mean === 0) consistencyScore = 10;
  else if (cv < 0.3) consistencyScore = 95;
  else if (cv < 0.5) consistencyScore = 80;
  else if (cv < 0.8) consistencyScore = 60;
  else if (cv < 1.2) consistencyScore = 40;
  else consistencyScore = 25;
  factors.push({
    name: 'Consistenta venit zilnic',
    score: consistencyScore, weight: 10, status: statusOf(consistencyScore),
    insight: `CV ${cv.toFixed(2)}`,
    details: `Medie ${fmtMoney(mean)}/zi, deviere ±${fmtMoney(stdDev)}`,
  });

  // 8. RFM segment diversity (weight 5)
  const segMap: Record<string, number> = {};
  for (const s of rfmSegments) segMap[s.segment] = s._count.segment;
  const champions = segMap['Champions'] || 0;
  const loyal = segMap['Loyal Customers'] || 0;
  const lost = segMap['Lost'] || 0;
  const totalSegmented = Object.values(segMap).reduce((s, v) => s + v, 0);
  const healthyPct = totalSegmented > 0 ? ((champions + loyal) / totalSegmented) * 100 : 0;
  const lostPct = totalSegmented > 0 ? (lost / totalSegmented) * 100 : 100;
  let diversityScore = 30;
  if (healthyPct >= 25) diversityScore += 35;
  else if (healthyPct >= 15) diversityScore += 20;
  else if (healthyPct >= 5) diversityScore += 10;
  if (lostPct < 30) diversityScore += 35;
  else if (lostPct < 50) diversityScore += 20;
  else if (lostPct < 70) diversityScore += 10;
  diversityScore = Math.min(100, diversityScore);
  factors.push({
    name: 'Mix segmente RFM',
    score: diversityScore, weight: 5, status: statusOf(diversityScore),
    insight: `${healthyPct.toFixed(0)}% Champions/Loyal`,
    details: `${champions} Champions, ${loyal} Loyal, ${lost} Lost`,
  });
  if (healthyPct < 15 && totalSegmented > 0) recommendations.push('Prea putini Champions & Loyal. Concentreaza-te pe up-sell catre clienti existenti cu 1-2 comenzi (Potential Loyalist).');

  // 9. Data quality (weight 5) — customer linkage + cost coverage
  const totalOrders30 = orders30.length;
  const ordersWithCust = orders30.filter((o) => o.customerId).length;
  const custLinkPct = totalOrders30 > 0 ? (ordersWithCust / totalOrders30) * 100 : 100;
  let dataScore = 30;
  if (custLinkPct >= 95) dataScore += 35;
  else if (custLinkPct >= 80) dataScore += 20;
  else if (custLinkPct >= 50) dataScore += 10;
  if (costCoverage >= 70) dataScore += 35;
  else if (costCoverage >= 40) dataScore += 20;
  else if (costCoverage >= 10) dataScore += 10;
  dataScore = Math.min(100, dataScore);
  factors.push({
    name: 'Calitate date',
    score: dataScore, weight: 5, status: statusOf(dataScore),
    insight: `${custLinkPct.toFixed(0)}% orders legate`,
    details: `${costCoverage.toFixed(0)}% produse cu cost, ${custLinkPct.toFixed(0)}% comenzi cu client`,
  });
  if (custLinkPct < 90) recommendations.push(`Doar ${custLinkPct.toFixed(0)}% din comenzi sunt legate de clienti. Re-sincronizeaza magazinul.`);

  // Overall
  const overallScore = Math.round(factors.reduce((s, f) => s + (f.score * f.weight) / 100, 0) / 5) * 5;
  const grade: ScaleReadiness['grade'] =
    overallScore >= 85 ? 'A' :
    overallScore >= 70 ? 'B' :
    overallScore >= 55 ? 'C' :
    overallScore >= 40 ? 'D' : 'F';

  const verdictMap: Record<string, string> = {
    A: 'Excelent — ai fundamentele solide pentru scalare agresiva. Creste ad spend-ul cu incredere si extinde canalele.',
    B: 'Bine — infrastructura e solida, mai sunt cateva optimizari de facut pana la scalare majora.',
    C: 'Mediu — poti incerca scalare moderata, dar rezolva intai punctele critice din lista de mai jos.',
    D: 'Atentie — scalarea acum ar amplifica problemele. Stabilizeaza marja, stocul si clientii inainte.',
    F: 'Critic — nu scala inca. Concentreaza-te pe fundamentale: date, cost, marja, repeat.',
  };

  if (recommendations.length === 0) recommendations.push('Totul arata bine. Continua monitorizarea saptamanala si creste treptat investitia in achizitie.');

  return {
    overallScore, grade, verdict: verdictMap[grade],
    factors, recommendations,
    meta: { period: 'Ultimele 30 zile', generatedAt: now },
  };
}
