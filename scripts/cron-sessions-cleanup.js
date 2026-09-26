#!/usr/bin/env node
// Session cleanup — runs daily at 05:00
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

async function main() {
  const result = await db.userSession.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  console.log(`[sessions-cleanup] Deleted ${result.count} expired sessions`);
}

main().catch(console.error).finally(() => db.$disconnect());
