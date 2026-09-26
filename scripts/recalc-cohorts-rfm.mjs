/**
 * Recompute cohorts and RFM after the customerId backfill fix.
 * Runs the exact same logic as the app lib, but serial to avoid saturating PG.
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function recalcCohorts(storeId, storeName) {
  console.log(`[${storeName}] fetching orders for cohort calc...`);
  const orders = await prisma.order.findMany({
    where: { storeConnectionId: storeId },
    select: { customerId: true, placedAt: true, total: true },
    orderBy: { placedAt: 'asc' },
  });
  console.log(`[${storeName}] ${orders.length} orders loaded`);

  const customerFirstMonth = {};
  const customerMonths = {};
  for (const o of orders) {
    if (!o.customerId) continue;
    const month = o.placedAt.toISOString().slice(0, 7);
    if (!customerFirstMonth[o.customerId]) customerFirstMonth[o.customerId] = month;
    if (!customerMonths[o.customerId]) customerMonths[o.customerId] = new Set();
    customerMonths[o.customerId].add(month);
  }

  const cohortCustomers = {};
  for (const [cid, first] of Object.entries(customerFirstMonth)) {
    if (!cohortCustomers[first]) cohortCustomers[first] = [];
    cohortCustomers[first].push(cid);
  }

  const cohortMonths = Object.keys(cohortCustomers).sort();
  const recentCohorts = cohortMonths.slice(-12);

  const allMonths = [];
  if (recentCohorts.length > 0) {
    const start = new Date(recentCohorts[0] + '-01');
    const end = new Date();
    const cur = new Date(start);
    while (cur <= end) {
      allMonths.push(cur.toISOString().slice(0, 7));
      cur.setMonth(cur.getMonth() + 1);
    }
  }

  console.log(`[${storeName}] building ${recentCohorts.length} cohorts x up to 12 periods`);
  // Delete stale cohort rows for this store
  await prisma.cohort.deleteMany({ where: { storeConnectionId: storeId } });

  let written = 0;
  for (const cohortMonth of recentCohorts) {
    const customers = cohortCustomers[cohortMonth];
    const cohortSize = customers.length;
    const cohortIdx = allMonths.indexOf(cohortMonth);

    for (let n = 0; n <= 11 && cohortIdx + n < allMonths.length; n++) {
      const targetMonth = allMonths[cohortIdx + n];
      let active = 0;
      let revenue = 0;
      for (const cid of customers) if (customerMonths[cid]?.has(targetMonth)) active++;
      for (const o of orders) {
        if (!o.customerId) continue;
        if (customerFirstMonth[o.customerId] === cohortMonth && o.placedAt.toISOString().slice(0, 7) === targetMonth) {
          revenue += Number(o.total);
        }
      }
      const retention = cohortSize > 0 ? (active / cohortSize) * 100 : 0;
      await prisma.cohort.create({
        data: {
          storeConnectionId: storeId,
          cohortMonth,
          monthNumber: n,
          activeCustomers: active,
          retentionRate: Math.round(retention * 10) / 10,
          revenue: Math.round(revenue * 100) / 100,
        },
      });
      written++;
    }
  }
  console.log(`[${storeName}] cohorts: ${written} rows written`);
}

async function main() {
  const stores = await prisma.storeConnection.findMany();
  for (const s of stores) {
    try {
      await recalcCohorts(s.id, s.name);
    } catch (e) {
      console.error(`[${s.name}] FAILED:`, e.message);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
