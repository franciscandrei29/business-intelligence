#!/usr/bin/env node
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

async function calculateCohorts(storeConnectionId) {
  const orders = await db.order.findMany({
    where: { storeConnectionId },
    select: { customerId: true, placedAt: true, total: true },
    orderBy: { placedAt: 'asc' },
  });

  if (orders.length === 0) return [];

  const customerFirstMonth = {};
  const customerMonths = {};

  for (const order of orders) {
    const custId = order.customerId || 'unknown';
    const month = order.placedAt.toISOString().slice(0, 7);

    if (!customerFirstMonth[custId]) {
      customerFirstMonth[custId] = month;
    }
    if (!customerMonths[custId]) {
      customerMonths[custId] = new Set();
    }
    customerMonths[custId].add(month);
  }

  const cohortCustomers = {};
  for (const [custId, firstMonth] of Object.entries(customerFirstMonth)) {
    if (!cohortCustomers[firstMonth]) cohortCustomers[firstMonth] = [];
    cohortCustomers[firstMonth].push(custId);
  }

  const cohortMonths = Object.keys(cohortCustomers).sort();
  const recentCohorts = cohortMonths.slice(-12);

  const allMonths = [];
  if (recentCohorts.length > 0) {
    const start = new Date(recentCohorts[0] + '-01');
    const end = new Date();
    const current = new Date(start);
    while (current <= end) {
      allMonths.push(current.toISOString().slice(0, 7));
      current.setMonth(current.getMonth() + 1);
    }
  }

  const results = [];

  for (const cohortMonth of recentCohorts) {
    const customers = cohortCustomers[cohortMonth];
    const cohortSize = customers.length;
    const cohortMonthIdx = allMonths.indexOf(cohortMonth);

    for (let monthNum = 0; monthNum <= 11 && cohortMonthIdx + monthNum < allMonths.length; monthNum++) {
      const targetMonth = allMonths[cohortMonthIdx + monthNum];
      let activeCount = 0;
      let revenue = 0;

      for (const custId of customers) {
        if (customerMonths[custId] && customerMonths[custId].has(targetMonth)) {
          activeCount++;
        }
      }

      for (const order of orders) {
        const custId = order.customerId || 'unknown';
        if (
          customerFirstMonth[custId] === cohortMonth &&
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

async function main() {
  console.log(`[${new Date().toISOString()}] Cohorts cron started`);

  const stores = await db.storeConnection.findMany({
    where: { status: 'active' },
    select: { id: true, name: true },
  });

  console.log(`Found ${stores.length} active store(s)`);

  for (const store of stores) {
    try {
      const results = await calculateCohorts(store.id);
      console.log(`  Store "${store.name}": ${results.length} cohort buckets calculated`);
    } catch (err) {
      console.error(`  Error for store "${store.name}":`, err.message);
    }
  }

  console.log(`[${new Date().toISOString()}] Cohorts cron finished`);
}

main()
  .catch((e) => { console.error('Cohorts cron fatal error:', e); process.exit(1); })
  .finally(() => db.$disconnect());
