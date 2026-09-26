import { db } from '~/lib/db.server';

export async function calculateCohorts(storeConnectionId: string) {
  // Get all orders for this store
  const orders = await db.order.findMany({
    where: { storeConnectionId },
    select: { customerId: true, placedAt: true, total: true },
    orderBy: { placedAt: 'asc' },
  });

  if (orders.length === 0) return [];

  // Group orders by customer -> find first order month (cohort month)
  // Skip orphan orders (customerId=null) — they would all bucket into a fake cohort
  const customerFirstMonth: Record<string, string> = {};
  const customerMonths: Record<string, Set<string>> = {};

  for (const order of orders) {
    if (!order.customerId) continue;
    const custId = order.customerId;
    const month = order.placedAt.toISOString().slice(0, 7);

    if (!customerFirstMonth[custId]) {
      customerFirstMonth[custId] = month;
    }
    if (!customerMonths[custId]) {
      customerMonths[custId] = new Set();
    }
    customerMonths[custId].add(month);
  }

  // Build cohort data: for each cohort month, count customers active in each subsequent month
  const cohortCustomers: Record<string, string[]> = {};
  for (const [custId, firstMonth] of Object.entries(customerFirstMonth)) {
    if (!cohortCustomers[firstMonth]) cohortCustomers[firstMonth] = [];
    cohortCustomers[firstMonth].push(custId);
  }

  // Sort cohort months
  const cohortMonths = Object.keys(cohortCustomers).sort();
  // Only keep last 12 cohorts
  const recentCohorts = cohortMonths.slice(-12);

  // Generate all months from first cohort to now
  const allMonths: string[] = [];
  if (recentCohorts.length > 0) {
    const start = new Date(recentCohorts[0] + '-01');
    const end = new Date();
    const current = new Date(start);
    while (current <= end) {
      allMonths.push(current.toISOString().slice(0, 7));
      current.setMonth(current.getMonth() + 1);
    }
  }

  const results: Array<{
    cohortMonth: string;
    monthNumber: number;
    activeCustomers: number;
    retentionRate: number;
    revenue: number;
  }> = [];

  for (const cohortMonth of recentCohorts) {
    const customers = cohortCustomers[cohortMonth];
    const cohortSize = customers.length;
    const cohortMonthIdx = allMonths.indexOf(cohortMonth);

    for (let monthNum = 0; monthNum <= 11 && cohortMonthIdx + monthNum < allMonths.length; monthNum++) {
      const targetMonth = allMonths[cohortMonthIdx + monthNum];
      let activeCount = 0;
      let revenue = 0;

      for (const custId of customers) {
        if (customerMonths[custId]?.has(targetMonth)) {
          activeCount++;
        }
      }

      // Calculate revenue for this cohort in this month
      for (const order of orders) {
        if (!order.customerId) continue;
        if (
          customerFirstMonth[order.customerId] === cohortMonth &&
          order.placedAt.toISOString().slice(0, 7) === targetMonth
        ) {
          revenue += Number(order.total);
        }
      }

      const retentionRate = cohortSize > 0 ? (activeCount / cohortSize) * 100 : 0;

      results.push({
        cohortMonth,
        monthNumber: monthNum,
        activeCustomers: activeCount,
        retentionRate: Math.round(retentionRate * 10) / 10,
        revenue: Math.round(revenue * 100) / 100,
      });
    }
  }

  // Upsert into DB
  for (const r of results) {
    await db.cohort.upsert({
      where: {
        storeConnectionId_cohortMonth_monthNumber: {
          storeConnectionId,
          cohortMonth: r.cohortMonth,
          monthNumber: r.monthNumber,
        },
      },
      create: {
        storeConnectionId,
        cohortMonth: r.cohortMonth,
        monthNumber: r.monthNumber,
        activeCustomers: r.activeCustomers,
        retentionRate: r.retentionRate,
        revenue: r.revenue,
      },
      update: {
        activeCustomers: r.activeCustomers,
        retentionRate: r.retentionRate,
        revenue: r.revenue,
        calculatedAt: new Date(),
      },
    });
  }

  return results;
}
