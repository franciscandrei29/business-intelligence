#!/usr/bin/env node
// Cleanup fake/spam accounts — runs daily via cron
// Rule 1: unverified email + older than 24h
// Rule 2: never logged in + older than 48h (catches verified spam like bot auto-verify)
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

async function main() {
  const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000);

  // Rule 1: unverified email + older than 24h
  const unverified = await db.user.findMany({
    where: {
      emailVerified: false,
      createdAt: { lt: cutoff24h },
      isSuperAdmin: false,
    },
    select: { id: true, email: true, createdAt: true },
  });

  // Rule 2: never logged in + older than 48h (even if email verified)
  const noLogin = await db.user.findMany({
    where: {
      lastLoginAt: null,
      createdAt: { lt: cutoff48h },
      isSuperAdmin: false,
      id: { notIn: unverified.map((u) => u.id) }, // avoid duplicates
    },
    select: { id: true, email: true, createdAt: true },
  });

  const staleUsers = [...unverified, ...noLogin];

  if (staleUsers.length === 0) {
    console.log(`[cleanup] No stale accounts found`);
    return;
  }

  const userIds = staleUsers.map((u) => u.id);
  console.log(`[cleanup] Found ${staleUsers.length} stale accounts (${unverified.length} unverified >24h, ${noLogin.length} no-login >48h):`);
  for (const u of staleUsers) {
    console.log(`  - ${u.email} (created ${u.createdAt.toISOString()})`);
  }

  // Delete related records first (no cascade on some relations)
  const [sessions, subs, memberships, activities] = await Promise.all([
    db.userSession.deleteMany({ where: { userId: { in: userIds } } }),
    db.subscription.deleteMany({ where: { userId: { in: userIds } } }),
    db.teamMembership.deleteMany({ where: { userId: { in: userIds } } }),
    db.activityEvent.deleteMany({ where: { actorUserId: { in: userIds } } }),
  ]);

  // Delete users
  const deleted = await db.user.deleteMany({
    where: { id: { in: userIds } },
  });

  console.log(`[cleanup] Deleted ${deleted.count} users, ${sessions.count} sessions, ${subs.count} subscriptions, ${memberships.count} memberships, ${activities.count} activity events`);
}

main()
  .catch((err) => {
    console.error('[cleanup] Error:', err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
