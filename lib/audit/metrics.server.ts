import { db } from '~/lib/db.server';

export interface DomainScore {
  score: number; // 0-100
  status: 'excellent' | 'good' | 'warning' | 'critical' | 'unavailable';
  metrics: Array<{ label: string; value: string | number; hint?: string }>;
}

export interface AuditMetrics {
  store: { id: string; name: string; platform: string; domain: string };
  generatedAt: Date;
  overall: { score: number; grade: 'A' | 'B' | 'C' | 'D' | 'F'; verdict: string };
  domains: {
    revenue: DomainScore;
    catalog: DomainScore;
    customers: DomainScore;
    inventory: DomainScore;
    traffic: DomainScore;
    profitability: DomainScore;
    operations: DomainScore;
    automation: DomainScore;
  };
}

function gradeFromScore(n: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (n >= 85) return 'A';
  if (n >= 70) return 'B';
  if (n >= 55) return 'C';
  if (n >= 40) return 'D';
  return 'F';
}

function statusFromScore(n: number): DomainScore['status'] {
  if (n >= 80) return 'excellent';
  if (n >= 60) return 'good';
  if (n >= 40) return 'warning';
  return 'critical';
}

function fmt(n: number): string {
  return n.toLocaleString('ro-RO');
}

function fmtMoney(n: number): string {
  return `${Math.round(n).toLocaleString('ro-RO')} RON`;
}

export async function computeAuditMetrics(storeId: string): Promise<AuditMetrics> {
  const store = await db.storeConnection.findUniqueOrThrow({
    where: { id: storeId },
    select: { id: true, name: true, platform: true, domain: true },
  });

  const now = new Date();
  const d30 = new Date(now); d30.setDate(d30.getDate() - 30);
  const d60 = new Date(now); d60.setDate(d60.getDate() - 60);
  const d90 = new Date(now); d90.setDate(d90.getDate() - 90);
  const d365 = new Date(now); d365.setDate(d365.getDate() - 365);

  // ===== 1. REVENUE & GROWTH =====
  const [rev30Agg, rev60_30Agg, rev365Agg, orderCount30, orderCount365] = await Promise.all([
    db.order.aggregate({ where: { storeConnectionId: storeId, placedAt: { gte: d30 } }, _sum: { total: true } }),
    db.order.aggregate({ where: { storeConnectionId: storeId, placedAt: { gte: d60, lt: d30 } }, _sum: { total: true } }),
    db.order.aggregate({ where: { storeConnectionId: storeId, placedAt: { gte: d365 } }, _sum: { total: true } }),
    db.order.count({ where: { storeConnectionId: storeId, placedAt: { gte: d30 } } }),
    db.order.count({ where: { storeConnectionId: storeId, placedAt: { gte: d365 } } }),
  ]);

  const rev30 = Number(rev30Agg._sum.total || 0);
  const rev60_30 = Number(rev60_30Agg._sum.total || 0);
  const rev365 = Number(rev365Agg._sum.total || 0);
  const momGrowth = rev60_30 > 0 ? ((rev30 - rev60_30) / rev60_30) * 100 : 0;
  const aov365 = orderCount365 > 0 ? rev365 / orderCount365 : 0;

  let revenueScore = 50;
  if (orderCount30 === 0) revenueScore = 10;
  else if (momGrowth >= 20) revenueScore = 95;
  else if (momGrowth >= 10) revenueScore = 85;
  else if (momGrowth >= 0) revenueScore = 70;
  else if (momGrowth >= -10) revenueScore = 55;
  else if (momGrowth >= -25) revenueScore = 35;
  else revenueScore = 20;

  const revenue: DomainScore = {
    score: revenueScore,
    status: statusFromScore(revenueScore),
    metrics: [
      { label: 'Venit ultimele 30 zile', value: fmtMoney(rev30) },
      { label: 'Venit 30 zile precedente', value: fmtMoney(rev60_30) },
      { label: 'Crestere MoM', value: `${momGrowth >= 0 ? '+' : ''}${momGrowth.toFixed(1)}%` },
      { label: 'Venit ultimele 365 zile', value: fmtMoney(rev365) },
      { label: 'Comenzi ultimele 30 zile', value: fmt(orderCount30) },
      { label: 'AOV mediu anual', value: fmtMoney(aov365) },
    ],
  };

  // ===== 2. PRODUSE & CATALOG =====
  const [prodTotal, prodActive, prodWithCost, prodWithImage, prodOutOfStock] = await Promise.all([
    db.product.count({ where: { storeConnectionId: storeId } }),
    db.product.count({ where: { storeConnectionId: storeId, status: 'active' } }),
    db.product.count({ where: { storeConnectionId: storeId, costPerUnit: { gt: 0 } } }),
    db.product.count({ where: { storeConnectionId: storeId, imageUrl: { not: null } } }),
    db.product.count({ where: { storeConnectionId: storeId, inventory: { lte: 0 } } }),
  ]);

  const costCoverage = prodTotal > 0 ? (prodWithCost / prodTotal) * 100 : 0;
  const imageCoverage = prodTotal > 0 ? (prodWithImage / prodTotal) * 100 : 0;
  const outOfStockPct = prodTotal > 0 ? (prodOutOfStock / prodTotal) * 100 : 0;

  let catalogScore = 20;
  if (prodActive >= 50) catalogScore += 30;
  else if (prodActive >= 20) catalogScore += 20;
  else if (prodActive >= 5) catalogScore += 10;
  if (costCoverage >= 70) catalogScore += 25;
  else if (costCoverage >= 40) catalogScore += 15;
  else if (costCoverage >= 10) catalogScore += 5;
  if (imageCoverage >= 90) catalogScore += 15;
  else if (imageCoverage >= 70) catalogScore += 10;
  if (outOfStockPct < 10) catalogScore += 10;
  else if (outOfStockPct < 25) catalogScore += 5;
  catalogScore = Math.min(100, catalogScore);

  const catalog: DomainScore = {
    score: catalogScore,
    status: statusFromScore(catalogScore),
    metrics: [
      { label: 'Produse active', value: fmt(prodActive), hint: `din ${fmt(prodTotal)} total` },
      { label: 'Acoperire costuri (COGS)', value: `${costCoverage.toFixed(1)}%`, hint: `${fmt(prodWithCost)} produse cu cost setat` },
      { label: 'Acoperire imagini', value: `${imageCoverage.toFixed(1)}%` },
      { label: 'Produse fara stoc', value: fmt(prodOutOfStock), hint: `${outOfStockPct.toFixed(1)}% din catalog` },
    ],
  };

  // ===== 3. CLIENTI & RETENTIE =====
  const [custTotal, custWithOrder, custRepeat, custNew30] = await Promise.all([
    db.customer.count({ where: { storeConnectionId: storeId } }),
    db.customer.count({ where: { storeConnectionId: storeId, ordersCount: { gte: 1 } } }),
    db.customer.count({ where: { storeConnectionId: storeId, ordersCount: { gte: 2 } } }),
    db.customer.count({ where: { storeConnectionId: storeId, firstOrderAt: { gte: d30 } } }),
  ]);

  const repeatRate = custWithOrder > 0 ? (custRepeat / custWithOrder) * 100 : 0;

  const rfmGroups = await db.rfmSegment.groupBy({
    by: ['segment'],
    where: { storeConnectionId: storeId },
    _count: { segment: true },
  });
  const rfmChampions = rfmGroups.find((g) => g.segment === 'Champions')?._count.segment || 0;
  const rfmAtRisk = rfmGroups.find((g) => g.segment === 'At Risk')?._count.segment || 0;
  const rfmLost = rfmGroups.find((g) => g.segment === 'Lost')?._count.segment || 0;

  let customersScore = 20;
  if (custWithOrder >= 500) customersScore += 25;
  else if (custWithOrder >= 100) customersScore += 15;
  else if (custWithOrder >= 30) customersScore += 8;
  if (repeatRate >= 25) customersScore += 30;
  else if (repeatRate >= 15) customersScore += 20;
  else if (repeatRate >= 8) customersScore += 10;
  if (custNew30 >= 30) customersScore += 15;
  else if (custNew30 >= 10) customersScore += 10;
  else if (custNew30 >= 1) customersScore += 5;
  if (rfmChampions > 0) customersScore += 10;
  customersScore = Math.min(100, customersScore);

  const customers: DomainScore = {
    score: customersScore,
    status: statusFromScore(customersScore),
    metrics: [
      { label: 'Clienti cu macar o comanda', value: fmt(custWithOrder), hint: `${fmt(custTotal)} total in DB` },
      { label: 'Rata repeat purchase', value: `${repeatRate.toFixed(1)}%`, hint: `${fmt(custRepeat)} clienti fideli` },
      { label: 'Clienti noi ultimele 30 zile', value: fmt(custNew30) },
      { label: 'Champions (RFM)', value: fmt(rfmChampions) },
      { label: 'At Risk + Lost', value: fmt(rfmAtRisk + rfmLost), hint: 'clienti care necesita reactivare' },
    ],
  };

  // ===== 4. STOCURI & SUPPLY CHAIN =====
  const inventoryValueRow = await db.$queryRaw<{ total: string }[]>`
    SELECT COALESCE(SUM(inventory * price), 0)::text AS total
    FROM "Product"
    WHERE "storeConnectionId" = ${storeId} AND inventory > 0
  `;
  const inventoryValue = Number(inventoryValueRow[0]?.total || 0);

  const orders90Items = await db.order.findMany({
    where: { storeConnectionId: storeId, placedAt: { gte: d90 } },
    select: { lineItems: true },
  });
  const skuToExternalId = new Map<string, string>();
  const productsForMatch = await db.product.findMany({
    where: { storeConnectionId: storeId, inventory: { gt: 0 } },
    select: { externalId: true, sku: true, price: true, inventory: true, title: true },
  });
  for (const p of productsForMatch) if (p.sku) skuToExternalId.set(p.sku, p.externalId);

  const soldPerProduct = new Map<string, number>();
  for (const o of orders90Items) {
    if (!o.lineItems) continue;
    try {
      const items = JSON.parse(o.lineItems);
      for (const it of items) {
        let pid = String(it.product_id || it.productId || '');
        if (!pid && it.sku) pid = skuToExternalId.get(String(it.sku)) || '';
        if (!pid) continue;
        soldPerProduct.set(pid, (soldPerProduct.get(pid) || 0) + Number(it.quantity || 1));
      }
    } catch {}
  }
  let deadStockValue = 0;
  let deadStockCount = 0;
  for (const p of productsForMatch) {
    if (!soldPerProduct.has(p.externalId)) {
      deadStockValue += Number(p.price) * p.inventory;
      deadStockCount++;
    }
  }
  const deadStockPct = inventoryValue > 0 ? (deadStockValue / inventoryValue) * 100 : 0;

  let inventoryScore = 30;
  if (deadStockPct < 10) inventoryScore += 35;
  else if (deadStockPct < 25) inventoryScore += 20;
  else if (deadStockPct < 50) inventoryScore += 10;
  if (outOfStockPct < 5) inventoryScore += 20;
  else if (outOfStockPct < 15) inventoryScore += 10;
  if (prodActive > 0) inventoryScore += 15;
  inventoryScore = Math.min(100, inventoryScore);

  const inventory: DomainScore = {
    score: inventoryScore,
    status: statusFromScore(inventoryScore),
    metrics: [
      { label: 'Valoare totala stoc', value: fmtMoney(inventoryValue) },
      { label: 'Dead stock (90 zile 0 vanzari)', value: fmtMoney(deadStockValue), hint: `${fmt(deadStockCount)} produse, ${deadStockPct.toFixed(1)}% din valoare` },
      { label: 'Produse out-of-stock', value: fmt(prodOutOfStock), hint: `${outOfStockPct.toFixed(1)}% din catalog` },
    ],
  };

  // ===== 5. TRAFIC & CONVERSIE (proxy fara GA) =====
  // Fara integrare GA activa, folosim proxy: frecventa comenzilor + conversie clienti / vizitatori (daca disponibila)
  const ordersPerDay30 = orderCount30 / 30;
  let trafficScore = 40;
  if (ordersPerDay30 >= 10) trafficScore = 85;
  else if (ordersPerDay30 >= 3) trafficScore = 70;
  else if (ordersPerDay30 >= 1) trafficScore = 55;
  else if (ordersPerDay30 > 0) trafficScore = 40;
  else trafficScore = 20;

  const traffic: DomainScore = {
    score: trafficScore,
    status: statusFromScore(trafficScore),
    metrics: [
      { label: 'Comenzi per zi (media 30z)', value: ordersPerDay30.toFixed(1) },
      { label: 'Clienti noi (30z)', value: fmt(custNew30) },
      { label: 'Rata de conversie clienti', value: custTotal > 0 ? `${((custWithOrder / custTotal) * 100).toFixed(1)}%` : '—', hint: 'clienti cu comenzi / clienti in DB' },
    ],
  };

  // ===== 6. PROFITABILITATE =====
  const recentOrders = await db.order.findMany({
    where: { storeConnectionId: storeId, placedAt: { gte: d30 } },
    select: { total: true, discountTotal: true, totalRefunded: true, lineItems: true },
  });
  const allProductCosts = await db.product.findMany({
    where: { storeConnectionId: storeId },
    select: { externalId: true, costPerUnit: true, sku: true },
  });
  const costMap = new Map<string, number>();
  const skuCostMap = new Map<string, string>();
  for (const p of allProductCosts) {
    if (p.costPerUnit) costMap.set(p.externalId, Number(p.costPerUnit));
    if (p.sku) skuCostMap.set(p.sku, p.externalId);
  }
  let totalRev = 0, totalCOGS = 0, totalDiscounts = 0, totalRefunds = 0;
  for (const o of recentOrders) {
    totalRev += Number(o.total);
    totalDiscounts += Number(o.discountTotal || 0);
    totalRefunds += Number(o.totalRefunded || 0);
    if (!o.lineItems) continue;
    try {
      const items = JSON.parse(o.lineItems);
      for (const it of items) {
        let pid = String(it.product_id || it.productId || '');
        if (!pid && it.sku) pid = skuCostMap.get(String(it.sku)) || '';
        const c = pid ? costMap.get(pid) || 0 : 0;
        totalCOGS += c * Number(it.quantity || 0);
      }
    } catch {}
  }
  const grossMargin = totalRev > 0 ? ((totalRev - totalCOGS) / totalRev) * 100 : 0;
  const hasCostData = costMap.size > 0;

  let profitScore = 40;
  if (!hasCostData) profitScore = 35;
  else if (grossMargin >= 60) profitScore = 95;
  else if (grossMargin >= 45) profitScore = 80;
  else if (grossMargin >= 30) profitScore = 60;
  else if (grossMargin >= 15) profitScore = 40;
  else profitScore = 25;

  const profitability: DomainScore = {
    score: profitScore,
    status: statusFromScore(profitScore),
    metrics: hasCostData ? [
      { label: 'Marja bruta (30z)', value: `${grossMargin.toFixed(1)}%` },
      { label: 'Venit (30z)', value: fmtMoney(totalRev) },
      { label: 'COGS estimat (30z)', value: fmtMoney(totalCOGS) },
      { label: 'Discount acordat (30z)', value: fmtMoney(totalDiscounts) },
      { label: 'Refund-uri (30z)', value: fmtMoney(totalRefunds) },
    ] : [
      { label: 'Date cost indisponibile', value: 'Setati costPerUnit la produse' },
      { label: 'Venit (30z)', value: fmtMoney(totalRev) },
      { label: 'Discount acordat (30z)', value: fmtMoney(totalDiscounts) },
    ],
  };

  // ===== 7. OPERATIUNI =====
  const refundedOrders30 = recentOrders.filter((o) => Number(o.totalRefunded || 0) > 0).length;
  const refundRate = recentOrders.length > 0 ? (refundedOrders30 / recentOrders.length) * 100 : 0;
  const aov30 = recentOrders.length > 0 ? totalRev / recentOrders.length : 0;
  const discountedOrders = recentOrders.filter((o) => Number(o.discountTotal || 0) > 0).length;
  const discountRate = recentOrders.length > 0 ? (discountedOrders / recentOrders.length) * 100 : 0;

  let opsScore = 40;
  if (refundRate < 2) opsScore += 25;
  else if (refundRate < 5) opsScore += 15;
  else if (refundRate < 10) opsScore += 5;
  if (orderCount30 >= 50) opsScore += 25;
  else if (orderCount30 >= 10) opsScore += 15;
  else if (orderCount30 >= 1) opsScore += 8;
  if (aov30 >= 200) opsScore += 10;
  else if (aov30 >= 100) opsScore += 5;
  opsScore = Math.min(100, opsScore);

  const operations: DomainScore = {
    score: opsScore,
    status: statusFromScore(opsScore),
    metrics: [
      { label: 'Comenzi (30z)', value: fmt(orderCount30) },
      { label: 'AOV (30z)', value: fmtMoney(aov30) },
      { label: 'Rata refund (30z)', value: `${refundRate.toFixed(1)}%` },
      { label: 'Comenzi cu discount (30z)', value: `${discountRate.toFixed(1)}%` },
    ],
  };

  // ===== 8. AI & AUTOMATIZARE =====
  const [aiReports, aiReportsByType, storeSettingsData] = await Promise.all([
    db.aiReport.count({ where: { storeConnectionId: storeId } }),
    db.aiReport.groupBy({ by: ['type'], where: { storeConnectionId: storeId }, _count: { type: true } }),
    db.storeSettings.findUnique({ where: { storeConnectionId: storeId } }),
  ]);
  const reportTypes = aiReportsByType.length;

  let automationScore = 30;
  if (aiReports >= 10) automationScore += 30;
  else if (aiReports >= 3) automationScore += 20;
  else if (aiReports > 0) automationScore += 10;
  if (reportTypes >= 3) automationScore += 15;
  else if (reportTypes >= 2) automationScore += 10;
  if (storeSettingsData?.stockEmailTo) automationScore += 15;
  if (storeSettingsData) automationScore += 10;
  automationScore = Math.min(100, automationScore);

  const automation: DomainScore = {
    score: automationScore,
    status: statusFromScore(automationScore),
    metrics: [
      { label: 'Rapoarte AI generate', value: fmt(aiReports) },
      { label: 'Tipuri de rapoarte utilizate', value: fmt(reportTypes), hint: `din ADVISOR, AUDIT, NARRATIVE, ANOMALY etc.` },
      { label: 'Alerte stoc configurate', value: storeSettingsData?.stockEmailTo ? 'Da' : 'Nu' },
      { label: 'Setari magazin personalizate', value: storeSettingsData ? 'Da' : 'Nu' },
    ],
  };

  // ===== OVERALL =====
  const weights = { revenue: 20, catalog: 10, customers: 20, inventory: 10, traffic: 10, profitability: 15, operations: 10, automation: 5 };
  const domains = { revenue, catalog, customers, inventory, traffic, profitability, operations, automation };
  const overallScore = Math.round(
    (Object.keys(weights) as Array<keyof typeof weights>).reduce((s, k) => s + (domains[k].score * weights[k]) / 100, 0)
  );
  const grade = gradeFromScore(overallScore);
  const verdictMap: Record<string, string> = {
    A: 'Excelent — magazinul ruleaza solid pe toate dimensiunile. Concentreaza-te pe scalare.',
    B: 'Bine — fundamente solide, exista cateva zone cu potential de optimizare.',
    C: 'Mediu — performanta acceptabila, dar cel putin 2-3 domenii necesita atentie.',
    D: 'Sub-optim — probleme sistemice care afecteaza sanatatea business-ului.',
    F: 'Critic — necesita interventie urgenta inainte de investitii in crestere.',
  };

  return {
    store,
    generatedAt: now,
    overall: { score: overallScore, grade, verdict: verdictMap[grade] },
    domains,
  };
}
