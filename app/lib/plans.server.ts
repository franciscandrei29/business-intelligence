import { db } from "~/lib/db.server";
import { redirect } from "@remix-run/node";
import { getPlanModules, isModuleAllowed, getPlanLimits, ALWAYS_ALLOWED } from "~/lib/plans";

export { getPlanModules, isModuleAllowed, getPlanLimits, ALWAYS_ALLOWED };

export async function getUserPlan(userId: string): Promise<string> {
  const sub = await db.subscription.findUnique({ where: { userId } });
  return sub?.plan || "FREE";
}

export async function requireModule(request: Request, userId: string, moduleRoute: string) {
  const plan = await getUserPlan(userId);
  if (!isModuleAllowed(plan, moduleRoute)) {
    throw redirect("/pricing-analysis?upgrade=" + moduleRoute);
  }
  return plan;
}

export async function checkAiMessageLimit(userId: string): Promise<{ allowed: boolean; remaining: number }> {
  const sub = await db.subscription.findUnique({ where: { userId } });
  const limits = getPlanLimits(sub?.plan || "FREE");
  if (limits.aiMessages === -1) return { allowed: true, remaining: 999 };
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const count = await db.aiReport.count({
    where: { storeConnection: { userId }, type: "ADVISOR", createdAt: { gte: startOfMonth } },
  });
  const remaining = Math.max(0, limits.aiMessages - count);
  return { allowed: remaining > 0, remaining };
}
