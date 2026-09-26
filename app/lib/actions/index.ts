import { db } from '~/lib/db.server';

export interface ActionRule {
  id: string;
  type: 'churn_email' | 'reorder_alert' | 'discount_suggestion';
  name: string;
  description: string;
  condition: string;
  action: string;
  enabled: boolean;
}

export interface ActionResult {
  rule: string;
  affectedCount: number;
  details: string[];
}

// Built-in action rules
export const BUILT_IN_RULES: ActionRule[] = [
  {
    id: 'churn-winback',
    type: 'churn_email',
    name: 'Winback clienti la risc',
    description: 'Identifica clientii cu scor churn > 60 si sugereaza o campanie de reactivare',
    condition: 'Churn score > 60, ultimele 90 zile inactiv',
    action: 'Genereaza lista clienti + sugestie discount personalizat',
    enabled: true,
  },
  {
    id: 'reorder-alert',
    type: 'reorder_alert',
    name: 'Alerta reaprovizionare',
    description: 'Produse cu stoc sub 7 zile la viteza actuala de vanzare',
    condition: 'Zile ramase stoc < 7, velocitate > 0',
    action: 'Genereaza lista produse cu cantitate recomandata de reaprovizionare',
    enabled: true,
  },
  {
    id: 'discount-optimizer',
    type: 'discount_suggestion',
    name: 'Optimizator discount',
    description: 'Calculeaza discount-ul maxim profitabil pentru produsele slow-moving',
    condition: 'Produse cu < 5 vanzari in 30 zile si stoc > 20',
    action: 'Sugereaza discount maxim pastrand marja pozitiva',
    enabled: true,
  },
];

export async function executeChurnWinback(storeConnectionId: string): Promise<ActionResult> {
  const customers = await db.customer.findMany({
    where: {
      storeConnectionId,
      ordersCount: { gte: 2 },
      lastOrderAt: { lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
    },
    select: { externalId: true, email: true, firstName: true, lastName: true, totalSpent: true, ordersCount: true, lastOrderAt: true },
    orderBy: { totalSpent: 'desc' },
    take: 50,
  });

  const details = customers.map((c) => {
    const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Unknown';
    const daysSince = Math.floor((Date.now() - new Date(c.lastOrderAt!).getTime()) / (1000 * 60 * 60 * 24));
    const avgOrder = Number(c.totalSpent) / c.ordersCount;
    // Suggest discount based on inactivity
    const discount = daysSince > 180 ? 20 : daysSince > 120 ? 15 : 10;
    return `${name} (${c.email}) — ${daysSince} zile inactiv, ${c.ordersCount} comenzi, LTV ${Number(c.totalSpent).toFixed(0)} RON → Sugestie: ${discount}% discount`;
  });

  return {
    rule: 'Winback clienti la risc',
    affectedCount: customers.length,
    details,
  };
}

export async function executeReorderAlert(storeConnectionId: string): Promise<ActionResult> {
  const alerts = await db.stockAlert.findMany({
    where: { storeConnectionId },
    orderBy: { daysRemaining: 'asc' },
  });

  const details = alerts.map((a) => {
    // Recommend ordering enough for 30 days at current velocity
    const recommendedOrder = Math.ceil(a.velocityPerDay * 30);
    return `${a.productTitle} — Stoc: ${a.currentStock}, Vanzari/zi: ${a.velocityPerDay}, Zile ramase: ${a.daysRemaining} → Comanda recomandata: ${recommendedOrder} unitati`;
  });

  return {
    rule: 'Alerta reaprovizionare',
    affectedCount: alerts.length,
    details,
  };
}

export async function executeDiscountOptimizer(storeConnectionId: string): Promise<ActionResult> {
  // Find slow-moving products with high stock
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const products = await db.product.findMany({
    where: { storeConnectionId, status: 'active', inventory: { gte: 20 } },
    select: { externalId: true, title: true, price: true, costPerUnit: true, inventory: true },
  });

  const orders = await db.order.findMany({
    where: { storeConnectionId, placedAt: { gte: thirtyDaysAgo } },
    select: { lineItems: true },
  });

  // Count sales per product
  const salesCount: Record<string, number> = {};
  for (const order of orders) {
    if (!order.lineItems) continue;
    try {
      const items = JSON.parse(order.lineItems);
      for (const item of items) {
        const pid = item.productId || '';
        salesCount[pid] = (salesCount[pid] || 0) + (item.quantity || 0);
      }
    } catch {}
  }

  const slowMovers = products.filter((p) => (salesCount[p.externalId] || 0) < 5);

  const details = slowMovers.slice(0, 20).map((p) => {
    const cost = p.costPerUnit ? Number(p.costPerUnit) : 0;
    const price = Number(p.price);
    const sales = salesCount[p.externalId] || 0;
    // Max discount keeping margin > 10%
    const minPrice = cost > 0 ? cost * 1.1 : price * 0.5;
    const maxDiscount = price > 0 ? Math.floor(((price - minPrice) / price) * 100) : 0;
    return `${p.title} — Pret: ${price} RON, Stoc: ${p.inventory}, Vandute/30z: ${sales} → Discount maxim profitabil: ${maxDiscount}%`;
  });

  return {
    rule: 'Optimizator discount',
    affectedCount: slowMovers.length,
    details,
  };
}
