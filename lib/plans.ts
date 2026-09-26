import { db } from '~/lib/db.server';
import { redirect } from '@remix-run/node';

export const PLAN_LIMITS: Record<string, {
  maxStores: number;
  aiMessages: number;
  audit: boolean;
  seo: boolean;
  smartAlerts: boolean;
}> = {
  FREE:    { maxStores: 1,  aiMessages: 3,   audit: false, seo: false, smartAlerts: false },
  STARTER: { maxStores: 1,  aiMessages: 30,  audit: false, seo: false, smartAlerts: true },
  GROWTH:  { maxStores: 3,  aiMessages: 100, audit: true,  seo: true,  smartAlerts: true },
  SCALE:   { maxStores: 10, aiMessages: -1,  audit: true,  seo: true,  smartAlerts: true },
};

export function getPlanLimits(plan: string) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.FREE;
}

export async function requireFeature(userId: string, feature: string) {
  const sub = await db.subscription.findUnique({ where: { userId } });
  const limits = getPlanLimits(sub?.plan || 'FREE');
  const allowed = (limits as any)[feature];
  if (allowed === false || allowed === 0) {
    throw redirect('/pricing?upgrade=' + feature);
  }
}

export async function checkAiMessageLimit(userId: string): Promise<{ allowed: boolean; remaining: number }> {
  const sub = await db.subscription.findUnique({ where: { userId } });
  const limits = getPlanLimits(sub?.plan || 'FREE');

  if (limits.aiMessages === -1) return { allowed: true, remaining: 999 };

  // Count messages this month
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const count = await db.aiReport.count({
    where: {
      storeConnection: { userId },
      type: 'ADVISOR',
      createdAt: { gte: startOfMonth },
    },
  });

  const remaining = Math.max(0, limits.aiMessages - count);
  return { allowed: remaining > 0, remaining };
}
