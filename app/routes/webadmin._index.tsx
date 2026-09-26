import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { Form, Link, useLoaderData, useSearchParams, useSubmit } from '@remix-run/react';
import { useState } from 'react';
import { requireSuperAdmin } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import { createUserSession } from '~/lib/auth/session.server';
import { formatNumber, formatCurrency, formatDate } from '~/lib/utils';
import {
  TrendingUp, TrendingDown, Users, Store, CreditCard, Activity,
  Search, Crown, AlertCircle, CheckCircle2, LogIn, RotateCcw,
} from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Admin · Kimono BI' }];

const PLAN_PRICE_EUR: Record<string, number> = { FREE: 0, STARTER: 49, GROWTH: 129, SCALE: 0 };

export async function loader({ request }: LoaderFunctionArgs) {
  await requireSuperAdmin(request);

  const url = new URL(request.url);
  const tab = url.searchParams.get('tab') || 'kpis';
  const search = url.searchParams.get('q') || '';

  const now = new Date();
  const start30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const start60 = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
let revenueData: any = null;  let funnelData: any = null;  let alertsData: any = null;  let actionsStores: any = null;  let flagUsers: any = null;

  // ---------- KPIs (always loaded — they're cheap) ----------
  const [
    totalUsers,
    newUsers30,
    newUsersPrev30,
    activeUsers30,
    subs,
    storesCount,
    storesPerPlatform,
  ] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { createdAt: { gte: start30 } } }),
    db.user.count({ where: { createdAt: { gte: start60, lt: start30 } } }),
    db.user.count({ where: { lastLoginAt: { gte: start30 } } }),
    db.subscription.findMany({ select: { plan: true, status: true, currentPeriodEnd: true, trialEndsAt: true, createdAt: true } }),
    db.storeConnection.count(),
    db.storeConnection.groupBy({ by: ['platform'], _count: { _all: true } }),
  ]);

  // MRR computation: sum monthly equivalents for ACTIVE plans (yearly / 12)
  let mrr = 0;
  let activePaid = 0;
  let trialing = 0;
  const planCounts: Record<string, number> = { FREE: 0, STARTER: 0, GROWTH: 0, SCALE: 0 };
  let pastDue = 0;
  for (const s of subs) {
    planCounts[s.plan] = (planCounts[s.plan] || 0) + 1;
    if (s.status === 'ACTIVE' && s.plan !== 'FREE') {
      activePaid++;
      mrr += PLAN_PRICE_EUR[s.plan] || 0;
      if (s.trialEndsAt && s.trialEndsAt > now) trialing++;
    }
    if (s.status === 'PAST_DUE') pastDue++;
  }

  // Churn proxy: subscriptions canceled in last 30d (status CANCELED with updatedAt in window)
  const canceled30 = await db.subscription.count({
    where: { status: 'CANCELED', updatedAt: { gte: start30 } },
  });

  const trialToPaidPct = subs.length > 0
    ? Math.round((activePaid / Math.max(1, subs.length)) * 100)
    : 0;

  function pct(curr: number, prev: number): number {
    if (prev === 0) return curr > 0 ? 100 : 0;
    return Math.round(((curr - prev) / prev) * 100);
  }

  const kpis = {
    mrr,
    arr: mrr * 12,
    totalUsers,
    newUsers30,
    newUsersDelta: pct(newUsers30, newUsersPrev30),
    activeUsers30,
    activeUsersPct: totalUsers > 0 ? Math.round((activeUsers30 / totalUsers) * 100) : 0,
    activePaid,
    trialing,
    pastDue,
    canceled30,
    trialToPaidPct,
    storesCount,
    storesPerPlatform,
    planCounts,
  };

  // ---------- Tab data (load only what's visible) ----------
  let usersList: any[] = [];
  let storesList: any[] = [];
  let stripeData: any = null;
  let aiUsage: any[] = [];
  let activityList: any[] = [];
  let auditList: any[] = [];
  let healthData: any = null;
  let cronData: any = null;
  let emailData: any = null;
  let pm2Data: any = null;
  let askaiData: any = null;

  if (tab === 'users') {
    const where: any = search
      ? {
          OR: [
            { email: { contains: search, mode: 'insensitive' as const } },
            { fullName: { contains: search, mode: 'insensitive' as const } },
            { company: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};
    const users = await db.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true, email: true, fullName: true, company: true,
        emailVerified: true, isSuperAdmin: true,
        lastLoginAt: true, createdAt: true,
        subscription: { select: { plan: true, status: true, trialEndsAt: true, currentPeriodEnd: true } },
        _count: { select: { stores: true } },
      },
    });
    usersList = users.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      company: u.company,
      emailVerified: u.emailVerified,
      isSuperAdmin: u.isSuperAdmin,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
      plan: u.subscription?.plan || 'FREE',
      status: u.subscription?.status || 'ACTIVE',
      trialEndsAt: u.subscription?.trialEndsAt,
      currentPeriodEnd: u.subscription?.currentPeriodEnd,
      storesCount: u._count.stores,
    }));
  }

  if (tab === 'stores') {
    const stores = await db.storeConnection.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true, name: true, domain: true, platform: true,
        isActive: true, syncStatus: true, lastSyncAt: true, createdAt: true,
        user: { select: { email: true, fullName: true, subscription: { select: { plan: true } } } },
        _count: { select: { orders: true, customers: true, products: true } },
      },
    });
    storesList = stores;
  }

  if (tab === 'stripe') {
    const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const [pastDueList, trialsExpiringSoon, recentCanceled, periodEndingSoon] = await Promise.all([
      db.subscription.findMany({
        where: { status: 'PAST_DUE' },
        include: { user: { select: { email: true, fullName: true } } },
        orderBy: { updatedAt: 'desc' },
        take: 30,
      }),
      db.subscription.findMany({
        where: { trialEndsAt: { gte: now, lte: in3Days }, status: 'ACTIVE' },
        include: { user: { select: { email: true, fullName: true } } },
        orderBy: { trialEndsAt: 'asc' },
        take: 30,
      }),
      db.subscription.findMany({
        where: { status: 'CANCELED', updatedAt: { gte: start30 } },
        include: { user: { select: { email: true, fullName: true } } },
        orderBy: { updatedAt: 'desc' },
        take: 30,
      }),
      db.subscription.findMany({
        where: { currentPeriodEnd: { gte: now, lte: in3Days }, status: 'ACTIVE' },
        include: { user: { select: { email: true, fullName: true } } },
        orderBy: { currentPeriodEnd: 'asc' },
        take: 30,
      }),
    ]);
    stripeData = { pastDueList, trialsExpiringSoon, recentCanceled, periodEndingSoon };
  }

  if (tab === 'ai') {
    // Aggregate AI usage per team owner. Reports are linked via storeConnection → user.
    const aggregates = await db.aiReport.groupBy({
      by: ['storeConnectionId'],
      _sum: { tokensUsed: true, costUsd: true },
      _count: { _all: true },
    });
    // Map storeConnectionId → user
    const storeIds = aggregates.map((a) => a.storeConnectionId);
    const storesForAI = storeIds.length ? await db.storeConnection.findMany({
      where: { id: { in: storeIds } },
      select: { id: true, name: true, userId: true, user: { select: { email: true, fullName: true, subscription: { select: { plan: true } } } } },
    }) : [];
    const storeMap: Record<string, typeof storesForAI[number]> = {};
    storesForAI.forEach((s) => { storeMap[s.id] = s; });
    // Group by user
    const perUser: Record<string, { userId: string; userEmail: string; userName: string; plan: string; reports: number; tokens: number; cost: number }> = {};
    for (const a of aggregates) {
      const s = storeMap[a.storeConnectionId];
      if (!s) continue;
      const key = s.userId;
      if (!perUser[key]) {
        perUser[key] = {
          userId: s.userId,
          userEmail: s.user.email,
          userName: s.user.fullName || '',
          plan: s.user.subscription?.plan || 'FREE',
          reports: 0, tokens: 0, cost: 0,
        };
      }
      perUser[key].reports += a._count._all;
      perUser[key].tokens += a._sum.tokensUsed || 0;
      perUser[key].cost += Number(a._sum.costUsd || 0);
    }
    aiUsage = Object.values(perUser).sort((a, b) => b.cost - a.cost).slice(0, 50);
  }

  if (tab === 'activity') {
    activityList = await db.activityEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        // We can't include user via FK directly (no relation), so we'll resolve names client-side
      },
    });
    // Manually attach actor + target user info
    const userIds = new Set<string>();
    for (const a of activityList) {
      if (a.actorUserId) userIds.add(a.actorUserId);
      if (a.targetUserId) userIds.add(a.targetUserId);
    }
    const users = userIds.size ? await db.user.findMany({
      where: { id: { in: Array.from(userIds) } },
      select: { id: true, email: true, fullName: true },
    }) : [];
    const userMap: Record<string, { email: string; fullName: string | null }> = {};
    users.forEach((u) => { userMap[u.id] = { email: u.email, fullName: u.fullName }; });
    activityList = activityList.map((a) => ({
      ...a,
      actor: a.actorUserId ? userMap[a.actorUserId] : null,
      target: a.targetUserId ? userMap[a.targetUserId] : null,
    }));
  }

  if (tab === 'audit') {
    const ADMIN_TYPES = ['admin_impersonate', 'admin_change_plan', 'admin_extend_trial', 'admin_verify_email'];
    auditList = await db.activityEvent.findMany({
      where: { type: { in: ADMIN_TYPES } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const userIds = new Set<string>();
    for (const a of auditList) {
      if (a.actorUserId) userIds.add(a.actorUserId);
      if (a.targetUserId) userIds.add(a.targetUserId);
    }
    const users = userIds.size ? await db.user.findMany({
      where: { id: { in: Array.from(userIds) } },
      select: { id: true, email: true, fullName: true },
    }) : [];
    const userMap: Record<string, { email: string; fullName: string | null }> = {};
    users.forEach((u) => { userMap[u.id] = { email: u.email, fullName: u.fullName }; });
    auditList = auditList.map((a) => ({
      ...a,
      actor: a.actorUserId ? userMap[a.actorUserId] : null,
      target: a.targetUserId ? userMap[a.targetUserId] : null,
    }));
  }

  if (tab === 'health') {
    // DB size + table sizes via raw SQL
    const [dbSize, tableSizes, overdueStores, recentErrors] = await Promise.all([
      db.$queryRaw<Array<{ size: string }>>`SELECT pg_size_pretty(pg_database_size(current_database())) as size`,
      db.$queryRaw<Array<{ table: string; size: string; rows: bigint }>>`
        SELECT
          c.relname as "table",
          pg_size_pretty(pg_total_relation_size(c.oid)) as size,
          COALESCE(s.n_live_tup, 0) as rows
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY pg_total_relation_size(c.oid) DESC
        LIMIT 20
      `,
      db.storeConnection.count({
        where: {
          OR: [
            { lastSyncAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
            { lastSyncAt: null },
          ],
          isActive: true,
        },
      }),
      db.activityEvent.count({
        where: {
          type: 'payment_failed',
          createdAt: { gte: start30 },
        },
      }),
    ]);
    healthData = {
      dbSize: dbSize[0]?.size || '?',
      tableSizes: tableSizes.map((t) => ({ ...t, rows: Number(t.rows) })),
      overdueStores,
      recentPaymentFails: recentErrors,
    };
  }

  if (tab === 'cron') {
    const recent = await db.cronRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 100,
    });
    // Per-cron stats: last run, last success, success rate (30d)
    const allRuns = await db.cronRun.findMany({
      where: { startedAt: { gte: start30 } },
      select: { name: true, success: true, durationMs: true },
    });
    const perCron: Record<string, { name: string; total: number; success: number; failed: number; avgMs: number }> = {};
    for (const r of allRuns) {
      const k = r.name;
      if (!perCron[k]) perCron[k] = { name: k, total: 0, success: 0, failed: 0, avgMs: 0 };
      perCron[k].total++;
      if (r.success) perCron[k].success++;
      else perCron[k].failed++;
      if (r.durationMs) perCron[k].avgMs += r.durationMs;
    }
    Object.values(perCron).forEach((c) => { c.avgMs = c.total > 0 ? Math.round(c.avgMs / c.total) : 0; });
    cronData = { recent, perCron: Object.values(perCron) };
  }

  if (tab === 'email') {
    const [logs, byCategory, byDate] = await Promise.all([
      db.emailLog.findMany({
        orderBy: { sentAt: 'desc' },
        take: 100,
      }),
      db.emailLog.groupBy({
        by: ['category', 'success'],
        _count: { _all: true },
        where: { sentAt: { gte: start30 } },
      }),
      db.emailLog.findMany({
        where: { sentAt: { gte: start30 }, success: false },
        select: { sentAt: true, error: true, category: true, to: true, subject: true },
        orderBy: { sentAt: 'desc' },
        take: 30,
      }),
    ]);
    const totals30 = byCategory.reduce((acc: any, b) => {
      const k = b.category;
      if (!acc[k]) acc[k] = { category: k, success: 0, failed: 0 };
      if (b.success) acc[k].success += b._count._all;
      else acc[k].failed += b._count._all;
      return acc;
    }, {});
    emailData = {
      recent: logs,
      byCategory: Object.values(totals30),
      failed: byDate,
      totalSent: logs.length > 0 ? await db.emailLog.count({ where: { sentAt: { gte: start30 } } }) : 0,
      totalFailed: await db.emailLog.count({ where: { sentAt: { gte: start30 }, success: false } }),
    };
  }

  if (tab === 'pm2') {
    try {
      const { promisify } = await import('util');
      const { exec } = await import('child_process');
      const execAsync = promisify(exec);
      const { stdout } = await execAsync('pm2 jlist', { timeout: 4000 });
      const list = JSON.parse(stdout);
      pm2Data = {
        processes: list.map((p: any) => ({
          name: p.name,
          id: p.pm_id,
          pid: p.pid,
          status: p.pm2_env?.status || 'unknown',
          cpu: p.monit?.cpu || 0,
          memMB: Math.round((p.monit?.memory || 0) / 1024 / 1024),
          restarts: p.pm2_env?.restart_time || 0,
          uptime: p.pm2_env?.pm_uptime ? Date.now() - p.pm2_env.pm_uptime : 0,
          execMode: p.pm2_env?.exec_mode,
        })),
      };
    } catch (err: any) {
      pm2Data = { processes: [], error: err.message };
    }
  }

  if (tab === 'askai') {
    // Top Ask AI questions: AiReport with type='ADVISOR' has the user message in `title`.
    const reports = await db.aiReport.findMany({
      where: { type: 'ADVISOR' },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, title: true, tokensUsed: true, costUsd: true, createdAt: true, storeConnectionId: true },
    });
    // Frequency map by lowercased trimmed title (rough intent grouping)
    const freq: Record<string, { title: string; count: number; tokens: number; cost: number; lastAt: Date }> = {};
    for (const r of reports) {
      const key = (r.title || '').toLowerCase().trim().slice(0, 100);
      if (!key) continue;
      if (!freq[key]) freq[key] = { title: r.title, count: 0, tokens: 0, cost: 0, lastAt: r.createdAt };
      freq[key].count++;
      freq[key].tokens += r.tokensUsed || 0;
      freq[key].cost += Number(r.costUsd || 0);
      if (r.createdAt > freq[key].lastAt) freq[key].lastAt = r.createdAt;
    }
    const top = Object.values(freq).sort((a, b) => b.count - a.count).slice(0, 50);
    askaiData = { top, totalReports: reports.length };
  }


  // ── Revenue & MRR ──
  if (tab === 'revenue') {
    const subs = await db.subscription.findMany({ where: { status: 'ACTIVE', plan: { not: 'FREE' } }, select: { plan: true, createdAt: true } });
    const mrr = subs.reduce((s: number, sub: any) => s + ({ FREE: 0, STARTER: 49, GROWTH: 129, SCALE: 299 }[sub.plan as string] || 0), 0);
    const months: any[] = [];
    for (let i = 5; i >= 0; i--) {
      const ms = new Date(); ms.setMonth(ms.getMonth() - i); ms.setDate(1); ms.setHours(0,0,0,0);
      const me = new Date(ms); me.setMonth(me.getMonth() + 1);
      const newPaid = await db.subscription.count({ where: { status: 'ACTIVE', plan: { not: 'FREE' }, createdAt: { gte: ms, lt: me } } });
      const churned = await db.subscription.count({ where: { status: 'CANCELED', updatedAt: { gte: ms, lt: me } } });
      months.push({ month: ms.toISOString().slice(0, 7), newPaid, churned });
    }
    const totalPaid = await db.subscription.count({ where: { status: 'ACTIVE', plan: { not: 'FREE' } } });
    const totalFree = await db.subscription.count({ where: { plan: 'FREE' } });
    const churnRate30 = await db.subscription.count({ where: { status: 'CANCELED', updatedAt: { gte: start30 } } });
    revenueData = { mrr, arr: mrr * 12, totalPaid, totalFree, churnRate30, months };
  }

  // ── User Funnel ──
  if (tab === 'funnel') {
    const totalRegistered = await db.user.count();
    const totalVerified = await db.user.count({ where: { emailVerified: true } });
    const usersWithStores = await db.storeConnection.groupBy({ by: ['userId'], _count: true });
    const totalWithStore = usersWithStores.length;
    const usersWithOrders = await db.storeConnection.findMany({ where: { orders: { some: {} } }, select: { userId: true }, distinct: ['userId'] });
    const totalWithOrders = usersWithOrders.length;
    const totalPaidPlan = await db.subscription.count({ where: { status: 'ACTIVE', plan: { not: 'FREE' } } });
    funnelData = { totalRegistered, totalVerified, totalWithStore, totalWithOrders, totalPaidPlan };
  }

  // ── Alerts ──
  if (tab === 'alerts') {
    const syncFailed = await db.storeConnection.findMany({ where: { syncStatus: 'FAILED' }, select: { id: true, name: true, domain: true, lastSyncAt: true, user: { select: { email: true } } } });
    const syncOverdue = await db.storeConnection.findMany({ where: { lastSyncAt: { lt: new Date(Date.now() - 24*60*60*1000) }, syncStatus: { not: 'FAILED' } }, select: { id: true, name: true, domain: true, lastSyncAt: true, user: { select: { email: true } } } });
    const paymentFailed = await db.subscription.findMany({ where: { status: 'PAST_DUE' }, include: { user: { select: { email: true, fullName: true } } } });
    const trialExpiring = await db.subscription.findMany({ where: { trialEndsAt: { gte: new Date(), lte: new Date(Date.now() + 3*24*60*60*1000) } }, include: { user: { select: { email: true, fullName: true } } } });
    alertsData = { syncFailed, syncOverdue, paymentFailed, trialExpiring };
  }

  // ── Quick Actions ──
  if (tab === 'actions') {
    actionsStores = await db.storeConnection.findMany({ select: { id: true, name: true, domain: true, user: { select: { email: true } } }, orderBy: { name: 'asc' } });
  }

  // ── Feature Flags ──
  if (tab === 'flags') {
    flagUsers = await db.user.findMany({ take: 50, orderBy: { createdAt: 'desc' }, select: { id: true, email: true, fullName: true, subscription: { select: { plan: true, status: true } } } });
  }

  return json({
    tab, search, kpis,
    usersList, storesList,
    stripeData, aiUsage, activityList, auditList, healthData,
    cronData, emailData, pm2Data, askaiData,
    revenueData, funnelData, alertsData, actionsStores, flagUsers,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const admin = await requireSuperAdmin(request);
  const form = await request.formData();
  const intent = String(form.get('intent'));

  // Helper for admin audit logging
  const { logActivity } = await import('~/lib/activity.server');

  if (intent === 'impersonate') {
    const userId = String(form.get('userId'));
    const target = await db.user.findUnique({ where: { id: userId } });
    if (!target) return json({ error: 'User not found' }, { status: 404 });
    await logActivity({
      type: 'admin_impersonate',
      description: `${admin.fullName || admin.email} a făcut login ca ${target.email}`,
      actorUserId: admin.id,
      targetUserId: target.id,
    });
    const cookie = await createUserSession(target.id, request);
    return redirect('/dashboard', { headers: { 'Set-Cookie': cookie } });
  }

  if (intent === 'change_plan') {
    const userId = String(form.get('userId'));
    const plan = String(form.get('plan')) as 'FREE' | 'STARTER' | 'GROWTH' | 'SCALE';
    if (!['FREE', 'STARTER', 'GROWTH', 'SCALE'].includes(plan)) {
    
  // ── Revenue & MRR ──
  if (tab === 'revenue') {
    const subs = await db.subscription.findMany({ where: { status: 'ACTIVE', plan: { not: 'FREE' } }, select: { plan: true, createdAt: true } });
    const mrr = subs.reduce((s: number, sub: any) => s + ({ FREE: 0, STARTER: 49, GROWTH: 129, SCALE: 299 }[sub.plan as string] || 0), 0);
    const months: any[] = [];
    for (let i = 5; i >= 0; i--) {
      const ms = new Date(); ms.setMonth(ms.getMonth() - i); ms.setDate(1); ms.setHours(0,0,0,0);
      const me = new Date(ms); me.setMonth(me.getMonth() + 1);
      const newPaid = await db.subscription.count({ where: { status: 'ACTIVE', plan: { not: 'FREE' }, createdAt: { gte: ms, lt: me } } });
      const churned = await db.subscription.count({ where: { status: 'CANCELED', updatedAt: { gte: ms, lt: me } } });
      months.push({ month: ms.toISOString().slice(0, 7), newPaid, churned });
    }
    const totalPaid = await db.subscription.count({ where: { status: 'ACTIVE', plan: { not: 'FREE' } } });
    const totalFree = await db.subscription.count({ where: { plan: 'FREE' } });
    const churnRate30 = await db.subscription.count({ where: { status: 'CANCELED', updatedAt: { gte: start30 } } });
    revenueData = { mrr, arr: mrr * 12, totalPaid, totalFree, churnRate30, months };
  }

  // ── User Funnel ──
  if (tab === 'funnel') {
    const totalRegistered = await db.user.count();
    const totalVerified = await db.user.count({ where: { emailVerified: true } });
    const usersWithStores = await db.storeConnection.groupBy({ by: ['userId'], _count: true });
    const totalWithStore = usersWithStores.length;
    const usersWithOrders = await db.storeConnection.findMany({ where: { orders: { some: {} } }, select: { userId: true }, distinct: ['userId'] });
    const totalWithOrders = usersWithOrders.length;
    const totalPaidPlan = await db.subscription.count({ where: { status: 'ACTIVE', plan: { not: 'FREE' } } });
    funnelData = { totalRegistered, totalVerified, totalWithStore, totalWithOrders, totalPaidPlan };
  }

  // ── Alerts ──
  if (tab === 'alerts') {
    const syncFailed = await db.storeConnection.findMany({ where: { syncStatus: 'FAILED' }, select: { id: true, name: true, domain: true, lastSyncAt: true, user: { select: { email: true } } } });
    const syncOverdue = await db.storeConnection.findMany({ where: { lastSyncAt: { lt: new Date(Date.now() - 24*60*60*1000) }, syncStatus: { not: 'FAILED' } }, select: { id: true, name: true, domain: true, lastSyncAt: true, user: { select: { email: true } } } });
    const paymentFailed = await db.subscription.findMany({ where: { status: 'PAST_DUE' }, include: { user: { select: { email: true, fullName: true } } } });
    const trialExpiring = await db.subscription.findMany({ where: { trialEndsAt: { gte: new Date(), lte: new Date(Date.now() + 3*24*60*60*1000) } }, include: { user: { select: { email: true, fullName: true } } } });
    alertsData = { syncFailed, syncOverdue, paymentFailed, trialExpiring };
  }

  // ── Quick Actions ──
  if (tab === 'actions') {
    actionsStores = await db.storeConnection.findMany({ select: { id: true, name: true, domain: true, user: { select: { email: true } } }, orderBy: { name: 'asc' } });
  }

  // ── Feature Flags ──
  if (tab === 'flags') {
    flagUsers = await db.user.findMany({ take: 50, orderBy: { createdAt: 'desc' }, select: { id: true, email: true, fullName: true, subscription: { select: { plan: true, status: true } } } });
  }

  return json({ error: 'Plan invalid' }, { status: 400 });
    }
    const before = await db.subscription.findUnique({ where: { userId }, select: { plan: true } });
    await db.subscription.upsert({
      where: { userId },
      create: { userId, plan, status: 'ACTIVE' },
      update: { plan, status: 'ACTIVE' },
    });
    await logActivity({
      type: 'admin_change_plan',
      description: `${admin.fullName || admin.email} a schimbat planul user-ului ${userId} la ${plan} (din ${before?.plan || 'FREE'})`,
      actorUserId: admin.id,
      targetUserId: userId,
      metadata: { from: before?.plan || 'FREE', to: plan },
    });
  
  // ── Revenue & MRR ──
  if (tab === 'revenue') {
    const subs = await db.subscription.findMany({ where: { status: 'ACTIVE', plan: { not: 'FREE' } }, select: { plan: true, createdAt: true } });
    const mrr = subs.reduce((s: number, sub: any) => s + ({ FREE: 0, STARTER: 49, GROWTH: 129, SCALE: 299 }[sub.plan as string] || 0), 0);
    const months: any[] = [];
    for (let i = 5; i >= 0; i--) {
      const ms = new Date(); ms.setMonth(ms.getMonth() - i); ms.setDate(1); ms.setHours(0,0,0,0);
      const me = new Date(ms); me.setMonth(me.getMonth() + 1);
      const newPaid = await db.subscription.count({ where: { status: 'ACTIVE', plan: { not: 'FREE' }, createdAt: { gte: ms, lt: me } } });
      const churned = await db.subscription.count({ where: { status: 'CANCELED', updatedAt: { gte: ms, lt: me } } });
      months.push({ month: ms.toISOString().slice(0, 7), newPaid, churned });
    }
    const totalPaid = await db.subscription.count({ where: { status: 'ACTIVE', plan: { not: 'FREE' } } });
    const totalFree = await db.subscription.count({ where: { plan: 'FREE' } });
    const churnRate30 = await db.subscription.count({ where: { status: 'CANCELED', updatedAt: { gte: start30 } } });
    revenueData = { mrr, arr: mrr * 12, totalPaid, totalFree, churnRate30, months };
  }

  // ── User Funnel ──
  if (tab === 'funnel') {
    const totalRegistered = await db.user.count();
    const totalVerified = await db.user.count({ where: { emailVerified: true } });
    const usersWithStores = await db.storeConnection.groupBy({ by: ['userId'], _count: true });
    const totalWithStore = usersWithStores.length;
    const usersWithOrders = await db.storeConnection.findMany({ where: { orders: { some: {} } }, select: { userId: true }, distinct: ['userId'] });
    const totalWithOrders = usersWithOrders.length;
    const totalPaidPlan = await db.subscription.count({ where: { status: 'ACTIVE', plan: { not: 'FREE' } } });
    funnelData = { totalRegistered, totalVerified, totalWithStore, totalWithOrders, totalPaidPlan };
  }

  // ── Alerts ──
  if (tab === 'alerts') {
    const syncFailed = await db.storeConnection.findMany({ where: { syncStatus: 'FAILED' }, select: { id: true, name: true, domain: true, lastSyncAt: true, user: { select: { email: true } } } });
    const syncOverdue = await db.storeConnection.findMany({ where: { lastSyncAt: { lt: new Date(Date.now() - 24*60*60*1000) }, syncStatus: { not: 'FAILED' } }, select: { id: true, name: true, domain: true, lastSyncAt: true, user: { select: { email: true } } } });
    const paymentFailed = await db.subscription.findMany({ where: { status: 'PAST_DUE' }, include: { user: { select: { email: true, fullName: true } } } });
    const trialExpiring = await db.subscription.findMany({ where: { trialEndsAt: { gte: new Date(), lte: new Date(Date.now() + 3*24*60*60*1000) } }, include: { user: { select: { email: true, fullName: true } } } });
    alertsData = { syncFailed, syncOverdue, paymentFailed, trialExpiring };
  }

  // ── Quick Actions ──
  if (tab === 'actions') {
    actionsStores = await db.storeConnection.findMany({ select: { id: true, name: true, domain: true, user: { select: { email: true } } }, orderBy: { name: 'asc' } });
  }

  // ── Feature Flags ──
  if (tab === 'flags') {
    flagUsers = await db.user.findMany({ take: 50, orderBy: { createdAt: 'desc' }, select: { id: true, email: true, fullName: true, subscription: { select: { plan: true, status: true } } } });
  }

  return json({ success: `Plan schimbat la ${plan}.` });
  }

  if (intent === 'extend_trial') {
    const userId = String(form.get('userId'));
    const days = parseInt(String(form.get('days') || '14'), 10);
    const trialEndsAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    await db.subscription.upsert({
      where: { userId },
      create: { userId, plan: 'GROWTH', status: 'ACTIVE', trialEndsAt },
      update: { trialEndsAt },
    });
    await logActivity({
      type: 'admin_extend_trial',
      description: `${admin.fullName || admin.email} a extins trialul user-ului ${userId} cu ${days} zile`,
      actorUserId: admin.id,
      targetUserId: userId,
      metadata: { days, newTrialEndsAt: trialEndsAt.toISOString() },
    });
  
  // ── Revenue & MRR ──
  if (tab === 'revenue') {
    const subs = await db.subscription.findMany({ where: { status: 'ACTIVE', plan: { not: 'FREE' } }, select: { plan: true, createdAt: true } });
    const mrr = subs.reduce((s: number, sub: any) => s + ({ FREE: 0, STARTER: 49, GROWTH: 129, SCALE: 299 }[sub.plan as string] || 0), 0);
    const months: any[] = [];
    for (let i = 5; i >= 0; i--) {
      const ms = new Date(); ms.setMonth(ms.getMonth() - i); ms.setDate(1); ms.setHours(0,0,0,0);
      const me = new Date(ms); me.setMonth(me.getMonth() + 1);
      const newPaid = await db.subscription.count({ where: { status: 'ACTIVE', plan: { not: 'FREE' }, createdAt: { gte: ms, lt: me } } });
      const churned = await db.subscription.count({ where: { status: 'CANCELED', updatedAt: { gte: ms, lt: me } } });
      months.push({ month: ms.toISOString().slice(0, 7), newPaid, churned });
    }
    const totalPaid = await db.subscription.count({ where: { status: 'ACTIVE', plan: { not: 'FREE' } } });
    const totalFree = await db.subscription.count({ where: { plan: 'FREE' } });
    const churnRate30 = await db.subscription.count({ where: { status: 'CANCELED', updatedAt: { gte: start30 } } });
    revenueData = { mrr, arr: mrr * 12, totalPaid, totalFree, churnRate30, months };
  }

  // ── User Funnel ──
  if (tab === 'funnel') {
    const totalRegistered = await db.user.count();
    const totalVerified = await db.user.count({ where: { emailVerified: true } });
    const usersWithStores = await db.storeConnection.groupBy({ by: ['userId'], _count: true });
    const totalWithStore = usersWithStores.length;
    const usersWithOrders = await db.storeConnection.findMany({ where: { orders: { some: {} } }, select: { userId: true }, distinct: ['userId'] });
    const totalWithOrders = usersWithOrders.length;
    const totalPaidPlan = await db.subscription.count({ where: { status: 'ACTIVE', plan: { not: 'FREE' } } });
    funnelData = { totalRegistered, totalVerified, totalWithStore, totalWithOrders, totalPaidPlan };
  }

  // ── Alerts ──
  if (tab === 'alerts') {
    const syncFailed = await db.storeConnection.findMany({ where: { syncStatus: 'FAILED' }, select: { id: true, name: true, domain: true, lastSyncAt: true, user: { select: { email: true } } } });
    const syncOverdue = await db.storeConnection.findMany({ where: { lastSyncAt: { lt: new Date(Date.now() - 24*60*60*1000) }, syncStatus: { not: 'FAILED' } }, select: { id: true, name: true, domain: true, lastSyncAt: true, user: { select: { email: true } } } });
    const paymentFailed = await db.subscription.findMany({ where: { status: 'PAST_DUE' }, include: { user: { select: { email: true, fullName: true } } } });
    const trialExpiring = await db.subscription.findMany({ where: { trialEndsAt: { gte: new Date(), lte: new Date(Date.now() + 3*24*60*60*1000) } }, include: { user: { select: { email: true, fullName: true } } } });
    alertsData = { syncFailed, syncOverdue, paymentFailed, trialExpiring };
  }

  // ── Quick Actions ──
  if (tab === 'actions') {
    actionsStores = await db.storeConnection.findMany({ select: { id: true, name: true, domain: true, user: { select: { email: true } } }, orderBy: { name: 'asc' } });
  }

  // ── Feature Flags ──
  if (tab === 'flags') {
    flagUsers = await db.user.findMany({ take: 50, orderBy: { createdAt: 'desc' }, select: { id: true, email: true, fullName: true, subscription: { select: { plan: true, status: true } } } });
  }

  return json({ success: `Trial extins cu ${days} zile.` });
  }

  if (intent === 'verify_email') {
    const userId = String(form.get('userId'));
    await db.user.update({ where: { id: userId }, data: { emailVerified: true, verifyToken: null } });
    await logActivity({
      type: 'admin_verify_email',
      description: `${admin.fullName || admin.email} a marcat manual emailul user-ului ${userId} ca verificat`,
      actorUserId: admin.id,
      targetUserId: userId,
    });
  
  // ── Revenue & MRR ──
  if (tab === 'revenue') {
    const subs = await db.subscription.findMany({ where: { status: 'ACTIVE', plan: { not: 'FREE' } }, select: { plan: true, createdAt: true } });
    const mrr = subs.reduce((s: number, sub: any) => s + ({ FREE: 0, STARTER: 49, GROWTH: 129, SCALE: 299 }[sub.plan as string] || 0), 0);
    const months: any[] = [];
    for (let i = 5; i >= 0; i--) {
      const ms = new Date(); ms.setMonth(ms.getMonth() - i); ms.setDate(1); ms.setHours(0,0,0,0);
      const me = new Date(ms); me.setMonth(me.getMonth() + 1);
      const newPaid = await db.subscription.count({ where: { status: 'ACTIVE', plan: { not: 'FREE' }, createdAt: { gte: ms, lt: me } } });
      const churned = await db.subscription.count({ where: { status: 'CANCELED', updatedAt: { gte: ms, lt: me } } });
      months.push({ month: ms.toISOString().slice(0, 7), newPaid, churned });
    }
    const totalPaid = await db.subscription.count({ where: { status: 'ACTIVE', plan: { not: 'FREE' } } });
    const totalFree = await db.subscription.count({ where: { plan: 'FREE' } });
    const churnRate30 = await db.subscription.count({ where: { status: 'CANCELED', updatedAt: { gte: start30 } } });
    revenueData = { mrr, arr: mrr * 12, totalPaid, totalFree, churnRate30, months };
  }

  // ── User Funnel ──
  if (tab === 'funnel') {
    const totalRegistered = await db.user.count();
    const totalVerified = await db.user.count({ where: { emailVerified: true } });
    const usersWithStores = await db.storeConnection.groupBy({ by: ['userId'], _count: true });
    const totalWithStore = usersWithStores.length;
    const usersWithOrders = await db.storeConnection.findMany({ where: { orders: { some: {} } }, select: { userId: true }, distinct: ['userId'] });
    const totalWithOrders = usersWithOrders.length;
    const totalPaidPlan = await db.subscription.count({ where: { status: 'ACTIVE', plan: { not: 'FREE' } } });
    funnelData = { totalRegistered, totalVerified, totalWithStore, totalWithOrders, totalPaidPlan };
  }

  // ── Alerts ──
  if (tab === 'alerts') {
    const syncFailed = await db.storeConnection.findMany({ where: { syncStatus: 'FAILED' }, select: { id: true, name: true, domain: true, lastSyncAt: true, user: { select: { email: true } } } });
    const syncOverdue = await db.storeConnection.findMany({ where: { lastSyncAt: { lt: new Date(Date.now() - 24*60*60*1000) }, syncStatus: { not: 'FAILED' } }, select: { id: true, name: true, domain: true, lastSyncAt: true, user: { select: { email: true } } } });
    const paymentFailed = await db.subscription.findMany({ where: { status: 'PAST_DUE' }, include: { user: { select: { email: true, fullName: true } } } });
    const trialExpiring = await db.subscription.findMany({ where: { trialEndsAt: { gte: new Date(), lte: new Date(Date.now() + 3*24*60*60*1000) } }, include: { user: { select: { email: true, fullName: true } } } });
    alertsData = { syncFailed, syncOverdue, paymentFailed, trialExpiring };
  }

  // ── Quick Actions ──
  if (tab === 'actions') {
    actionsStores = await db.storeConnection.findMany({ select: { id: true, name: true, domain: true, user: { select: { email: true } } }, orderBy: { name: 'asc' } });
  }

  // ── Feature Flags ──
  if (tab === 'flags') {
    flagUsers = await db.user.findMany({ take: 50, orderBy: { createdAt: 'desc' }, select: { id: true, email: true, fullName: true, subscription: { select: { plan: true, status: true } } } });
  }

  return json({ success: 'Email marcat ca verificat.' });
  }

  if (intent === 'force_sync') {
    const storeId = String(form.get('storeId') || '');
    if (storeId) {
      const { spawn } = await import('child_process');
      spawn('node', ['scripts/cron-sync.mjs', '--force', `--store=${storeId}`], { detached: true, stdio: 'ignore' }).unref();
    }
    return redirect('/webadmin?tab=actions');
  }

  if (intent === 'send_email') {
    const to = String(form.get('to') || '');
    const subject = String(form.get('subject') || '');
    const body = String(form.get('body') || '');
    if (to && subject) {
      try {
        const { sendEmail } = await import('~/lib/auth/email.server');
        await sendEmail({ to, subject, html: `<p>${body.replace(/\n/g, '<br/>')}</p>` });
      } catch (e) { console.error('[webadmin] send email failed:', e); }
    }
    return redirect('/webadmin?tab=actions');
  }

  if (intent === 'recalc_rfm') {
    const { spawn } = await import('child_process');
    spawn('node', ['scripts/cron-rfm.js'], { detached: true, stdio: 'ignore' }).unref();
    return redirect('/webadmin?tab=actions');
  }

  if (intent === 'pm2_reload') {
    const { exec } = await import('child_process');
    exec('pm2 reload kimono-bi-standalone');
    return redirect('/webadmin?tab=actions');
  }



  // ── Revenue & MRR ──
  if (tab === 'revenue') {
    const subs = await db.subscription.findMany({ where: { status: 'ACTIVE', plan: { not: 'FREE' } }, select: { plan: true, createdAt: true } });
    const mrr = subs.reduce((s: number, sub: any) => s + ({ FREE: 0, STARTER: 49, GROWTH: 129, SCALE: 299 }[sub.plan as string] || 0), 0);
    const months: any[] = [];
    for (let i = 5; i >= 0; i--) {
      const ms = new Date(); ms.setMonth(ms.getMonth() - i); ms.setDate(1); ms.setHours(0,0,0,0);
      const me = new Date(ms); me.setMonth(me.getMonth() + 1);
      const newPaid = await db.subscription.count({ where: { status: 'ACTIVE', plan: { not: 'FREE' }, createdAt: { gte: ms, lt: me } } });
      const churned = await db.subscription.count({ where: { status: 'CANCELED', updatedAt: { gte: ms, lt: me } } });
      months.push({ month: ms.toISOString().slice(0, 7), newPaid, churned });
    }
    const totalPaid = await db.subscription.count({ where: { status: 'ACTIVE', plan: { not: 'FREE' } } });
    const totalFree = await db.subscription.count({ where: { plan: 'FREE' } });
    const churnRate30 = await db.subscription.count({ where: { status: 'CANCELED', updatedAt: { gte: start30 } } });
    revenueData = { mrr, arr: mrr * 12, totalPaid, totalFree, churnRate30, months };
  }

  // ── User Funnel ──
  if (tab === 'funnel') {
    const totalRegistered = await db.user.count();
    const totalVerified = await db.user.count({ where: { emailVerified: true } });
    const usersWithStores = await db.storeConnection.groupBy({ by: ['userId'], _count: true });
    const totalWithStore = usersWithStores.length;
    const usersWithOrders = await db.storeConnection.findMany({ where: { orders: { some: {} } }, select: { userId: true }, distinct: ['userId'] });
    const totalWithOrders = usersWithOrders.length;
    const totalPaidPlan = await db.subscription.count({ where: { status: 'ACTIVE', plan: { not: 'FREE' } } });
    funnelData = { totalRegistered, totalVerified, totalWithStore, totalWithOrders, totalPaidPlan };
  }

  // ── Alerts ──
  if (tab === 'alerts') {
    const syncFailed = await db.storeConnection.findMany({ where: { syncStatus: 'FAILED' }, select: { id: true, name: true, domain: true, lastSyncAt: true, user: { select: { email: true } } } });
    const syncOverdue = await db.storeConnection.findMany({ where: { lastSyncAt: { lt: new Date(Date.now() - 24*60*60*1000) }, syncStatus: { not: 'FAILED' } }, select: { id: true, name: true, domain: true, lastSyncAt: true, user: { select: { email: true } } } });
    const paymentFailed = await db.subscription.findMany({ where: { status: 'PAST_DUE' }, include: { user: { select: { email: true, fullName: true } } } });
    const trialExpiring = await db.subscription.findMany({ where: { trialEndsAt: { gte: new Date(), lte: new Date(Date.now() + 3*24*60*60*1000) } }, include: { user: { select: { email: true, fullName: true } } } });
    alertsData = { syncFailed, syncOverdue, paymentFailed, trialExpiring };
  }

  // ── Quick Actions ──
  if (tab === 'actions') {
    actionsStores = await db.storeConnection.findMany({ select: { id: true, name: true, domain: true, user: { select: { email: true } } }, orderBy: { name: 'asc' } });
  }

  // ── Feature Flags ──
  if (tab === 'flags') {
    flagUsers = await db.user.findMany({ take: 50, orderBy: { createdAt: 'desc' }, select: { id: true, email: true, fullName: true, subscription: { select: { plan: true, status: true } } } });
  }

  return json({ error: 'Unknown intent' }, { status: 400 });
}

// ============================================================================
// UI
// ============================================================================

export default function AdminPage() {
  const data = useLoaderData<typeof loader>();

  return (
    <div>
      {data.tab === 'kpis' && <KpisTab kpis={data.kpis} />}
      {data.tab === 'users' && <UsersTab users={data.usersList} search={data.search} />}
      {data.tab === 'stores' && <StoresTab stores={data.storesList} />}
      {data.tab === 'stripe' && data.stripeData && <StripeTab d={data.stripeData} />}
      {data.tab === 'ai' && <AiTab usage={data.aiUsage} />}
      {data.tab === 'askai' && data.askaiData && <AskAiTab d={data.askaiData} />}
      {data.tab === 'activity' && <ActivityTab events={data.activityList} />}
      {data.tab === 'audit' && <AuditTab events={data.auditList} />}
      {data.tab === 'cron' && data.cronData && <CronTab d={data.cronData} />}
      {data.tab === 'email' && data.emailData && <EmailTab d={data.emailData} />}
      {data.tab === 'pm2' && data.pm2Data && <Pm2Tab d={data.pm2Data} />}
      {data.tab === 'revenue' && data.revenueData && <RevenueTab d={data.revenueData} />}
      {data.tab === 'funnel' && data.funnelData && <FunnelTab d={data.funnelData} />}
      {data.tab === 'alerts' && data.alertsData && <AlertsTab d={data.alertsData} />}
      {data.tab === 'actions' && <ActionsTab stores={data.actionsStores || []} />}
      {data.tab === 'flags' && <FlagsTab users={data.flagUsers || []} />}
      {data.tab === 'health' && data.healthData && <HealthTab d={data.healthData} kpis={data.kpis} />}
    </div>
  );
}

// ─── Stripe Tab ────────────────────────────────────────────────────────────

function StripeTab({ d }: { d: any }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 18 }}>
      <StripeBucket
        title="Past due"
        sub="Plăți eșuate care necesită retry sau update card"
        items={d.pastDueList}
        accent="#dc2626"
        emptyMsg="Niciun cont în past_due."
      />
      <StripeBucket
        title="Trials care expiră în 3 zile"
        sub="Oportunitate outreach: contactează-i acum"
        items={d.trialsExpiringSoon}
        accent="#D85A30"
        emptyMsg="Niciun trial care expiră curând."
        showField="trialEndsAt"
      />
      <StripeBucket
        title="Abonamente expirate (currentPeriodEnd) în 3 zile"
        sub="Vor fi încasate automat de Stripe — atenție la past_due ulterior"
        items={d.periodEndingSoon}
        accent="#0369a1"
        emptyMsg="Niciun period ending soon."
        showField="currentPeriodEnd"
      />
      <StripeBucket
        title="Canceled în ultimele 30 zile"
        sub="Churn — contactează pentru feedback"
        items={d.recentCanceled}
        accent="#525252"
        emptyMsg="Nicio cancellation recentă."
      />
    </div>
  );
}

function StripeBucket({ title, sub, items, accent, emptyMsg, showField }: any) {
  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ padding: '12px 18px', borderBottom: '0.5px solid var(--border-default)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: accent }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</span>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>{items.length}</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{sub}</div>
      </div>
      {items.length === 0 ? (
        <div style={{ padding: '20px', textAlign: 'center', fontSize: 12, color: 'var(--text-tertiary)' }}>{emptyMsg}</div>
      ) : (
        items.map((it: any) => (
          <div key={it.id} style={{ padding: '10px 18px', borderBottom: '0.5px solid var(--border-default)', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, color: 'var(--text-primary)' }}>{it.user.fullName || it.user.email}</div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{it.user.email}</div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 99, background: PLAN_BADGE[it.plan]?.bg, color: PLAN_BADGE[it.plan]?.color }}>{it.plan}</span>
            {showField && it[showField] && (
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{formatDate(it[showField], 'relative')}</span>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ─── AI Tab ────────────────────────────────────────────────────────────────

function AiTab({ usage }: { usage: any[] }) {
  const totalCost = usage.reduce((s, u) => s + u.cost, 0);
  const totalTokens = usage.reduce((s, u) => s + u.tokens, 0);
  const totalReports = usage.reduce((s, u) => s + u.reports, 0);
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 }}>
        <BigKpi icon={CreditCard} label="Cost total OpenAI" value={`$${totalCost.toFixed(2)}`} sub="all-time" accent="#dc2626" />
        <BigKpi icon={Activity} label="Total requests" value={formatNumber(totalReports)} sub={`${formatNumber(totalTokens)} tokens`} accent="#7c3aed" />
        <BigKpi icon={Users} label="Useri activi AI" value={formatNumber(usage.length)} sub="în top 50" accent="#16a34a" />
      </div>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
          <thead>
            <tr style={{ borderBottom: '0.5px solid var(--border-default)', background: 'var(--bg-tertiary)' }}>
              <Th>User</Th>
              <Th>Plan</Th>
              <Th>Requests</Th>
              <Th>Tokens</Th>
              <Th>Cost USD</Th>
            </tr>
          </thead>
          <tbody>
            {usage.length === 0 && (
              <tr><td colSpan={5} style={{ padding: 30, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12 }}>Niciun consum AI înregistrat încă.</td></tr>
            )}
            {usage.map((u, i) => (
              <tr key={u.userId} style={{ borderBottom: '0.5px solid var(--border-default)' }}>
                <td style={{ padding: '10px 14px' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginRight: 8 }}>#{i + 1}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>{u.userName || u.userEmail}</span>
                  <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)', marginLeft: 22 }}>{u.userEmail}</div>
                </td>
                <td style={{ padding: '10px 14px' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: PLAN_BADGE[u.plan]?.bg, color: PLAN_BADGE[u.plan]?.color }}>{u.plan}</span>
                </td>
                <td style={{ padding: '10px 14px', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{formatNumber(u.reports)}</td>
                <td style={{ padding: '10px 14px', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{formatNumber(u.tokens)}</td>
                <td style={{ padding: '10px 14px', fontSize: 12, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>${u.cost.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Activity / Audit Tabs ────────────────────────────────────────────────

const TYPE_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  signup:                  { bg: 'rgba(22,163,74,0.12)', color: '#15803d', label: 'Signup' },
  member_joined:           { bg: 'rgba(22,163,74,0.12)', color: '#15803d', label: 'Member' },
  store_connected:         { bg: 'rgba(150,191,72,0.12)', color: '#5a8a00', label: 'Store +' },
  store_deleted:           { bg: 'rgba(220,38,38,0.12)', color: '#991b1b', label: 'Store -' },
  plan_upgraded:           { bg: 'rgba(216,90,48,0.12)', color: '#A33D14', label: 'Upgrade' },
  plan_downgraded:         { bg: 'rgba(115,115,115,0.12)', color: '#525252', label: 'Downgrade' },
  subscription_canceled:   { bg: 'rgba(115,115,115,0.12)', color: '#525252', label: 'Canceled' },
  payment_succeeded:       { bg: 'rgba(22,163,74,0.12)', color: '#15803d', label: 'Paid' },
  payment_failed:          { bg: 'rgba(220,38,38,0.12)', color: '#991b1b', label: 'Failed' },
  first_sync_completed:    { bg: 'rgba(3,105,161,0.12)', color: '#0369a1', label: 'Sync done' },
  admin_impersonate:       { bg: 'rgba(124,58,237,0.12)', color: '#7c3aed', label: 'Impersonate' },
  admin_change_plan:       { bg: 'rgba(124,58,237,0.12)', color: '#7c3aed', label: 'Plan' },
  admin_extend_trial:      { bg: 'rgba(124,58,237,0.12)', color: '#7c3aed', label: 'Trial' },
  admin_verify_email:      { bg: 'rgba(124,58,237,0.12)', color: '#7c3aed', label: 'Verify' },
};

function ActivityTab({ events }: { events: any[] }) {
  return <EventList events={events} title="Activity feed" sub="Toate evenimentele ordered cronologic — top 100 cele mai recente." />;
}

function AuditTab({ events }: { events: any[] }) {
  return <EventList events={events} title="Audit log — acțiuni super-admin" sub="Cine a făcut ce și când. Util pentru transparență și forensics." showActorAlways />;
}

function EventList({ events, title, sub, showActorAlways }: { events: any[]; title: string; sub: string; showActorAlways?: boolean }) {
  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ padding: '12px 18px', borderBottom: '0.5px solid var(--border-default)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{sub}</div>
      </div>
      {events.length === 0 ? (
        <div style={{ padding: '30px 18px', textAlign: 'center', fontSize: 12, color: 'var(--text-tertiary)' }}>Niciun eveniment înregistrat încă.</div>
      ) : (
        events.map((e: any) => {
          const badge = TYPE_BADGE[e.type] || { bg: 'rgba(115,115,115,0.12)', color: '#525252', label: e.type };
          return (
            <div key={e.id} style={{ padding: '10px 18px', borderBottom: '0.5px solid var(--border-default)', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 99,
                background: badge.bg, color: badge.color,
                flexShrink: 0, minWidth: 80, textAlign: 'center' as const,
              }}>{badge.label}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: 'var(--text-primary)', lineHeight: 1.5 }}>{e.description}</div>
                {(showActorAlways || e.target) && (
                  <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)', marginTop: 2 }}>
                    {e.actor && <>Actor: <code style={{ background: 'var(--bg-tertiary)', padding: '0 4px', borderRadius: 2 }}>{e.actor.email}</code></>}
                    {e.actor && e.target && <> · </>}
                    {e.target && <>Target: <code style={{ background: 'var(--bg-tertiary)', padding: '0 4px', borderRadius: 2 }}>{e.target.email}</code></>}
                  </div>
                )}
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                {formatDate(e.createdAt, 'relative')}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}

// ─── Health Tab ────────────────────────────────────────────────────────────

function HealthTab({ d, kpis }: { d: any; kpis: any }) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 }}>
        <BigKpi icon={Activity} label="DB size" value={d.dbSize} sub="PostgreSQL" accent="#0369a1" />
        <BigKpi icon={Store} label="Magazine OVERDUE" value={formatNumber(d.overdueStores)} sub="lastSyncAt > 24h" accent={d.overdueStores > 0 ? '#dc2626' : '#16a34a'} inverse />
        <BigKpi icon={AlertCircle} label="Plăți eșuate 30d" value={formatNumber(d.recentPaymentFails)} sub="webhook payment_failed" accent={d.recentPaymentFails > 0 ? '#dc2626' : '#16a34a'} inverse />
        <BigKpi icon={CreditCard} label="Past due acum" value={formatNumber(kpis.pastDue)} sub="conturi blocate" accent={kpis.pastDue > 0 ? '#dc2626' : '#16a34a'} inverse />
      </div>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <div style={{ padding: '12px 18px', borderBottom: '0.5px solid var(--border-default)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Top 20 tabele după dimensiune</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>Util pentru identificare hot spots și planificare retention</div>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 500 }}>
          <thead>
            <tr style={{ borderBottom: '0.5px solid var(--border-default)', background: 'var(--bg-tertiary)' }}>
              <Th>Tabel</Th>
              <Th>Dimensiune</Th>
              <Th>Rânduri</Th>
            </tr>
          </thead>
          <tbody>
            {d.tableSizes.map((t: any) => (
              <tr key={t.table} style={{ borderBottom: '0.5px solid var(--border-default)' }}>
                <td style={{ padding: '8px 14px', fontSize: 12, fontFamily: 'ui-monospace, monospace', color: 'var(--text-primary)' }}>{t.table}</td>
                <td style={{ padding: '8px 14px', fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)' }}>{t.size}</td>
                <td style={{ padding: '8px 14px', fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)' }}>{formatNumber(t.rows)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── KPIs Tab ──────────────────────────────────────────────────────────────

function KpisTab({ kpis }: { kpis: any }) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 22 }}>
        <BigKpi icon={CreditCard} label="MRR" value={`€${formatNumber(kpis.mrr)}`} sub={`ARR €${formatNumber(kpis.arr)}`} accent="#D85A30" />
        <BigKpi icon={Users} label="Total useri" value={formatNumber(kpis.totalUsers)} sub={`+${kpis.newUsers30} ultimii 30 zile`} delta={kpis.newUsersDelta} accent="#0369a1" />
        <BigKpi icon={Activity} label="Activi 30d" value={formatNumber(kpis.activeUsers30)} sub={`${kpis.activeUsersPct}% din total`} accent="#16a34a" />
        <BigKpi icon={CreditCard} label="Abonați paid" value={formatNumber(kpis.activePaid)} sub={`${kpis.trialing} în trial`} accent="#7c3aed" />
        <BigKpi icon={AlertCircle} label="Past due" value={formatNumber(kpis.pastDue)} sub="plăți eșuate" accent="#dc2626" inverse />
        <BigKpi icon={TrendingDown} label="Cancellations 30d" value={formatNumber(kpis.canceled30)} sub="churn proxy" accent="#dc2626" inverse />
        <BigKpi icon={Store} label="Magazine" value={formatNumber(kpis.storesCount)} sub={kpis.storesPerPlatform.map((p: any) => `${p.platform}: ${p._count._all}`).join(' · ')} accent="#0891b2" />
        <BigKpi icon={CheckCircle2} label="Conversie paid" value={`${kpis.trialToPaidPct}%`} sub={`${kpis.activePaid} / ${kpis.totalUsers} useri`} accent="#16a34a" />
      </div>

      {/* Plan distribution */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>Distribuție planuri</div>
        <div style={{ display: 'flex', gap: 4, height: 28, borderRadius: 6, overflow: 'hidden', background: 'var(--bg-tertiary)' }}>
          {(['FREE', 'STARTER', 'GROWTH', 'SCALE'] as const).map((plan) => {
            const count = kpis.planCounts[plan] || 0;
            const total = Object.values(kpis.planCounts).reduce((a: any, b: any) => a + b, 0) as number;
            const pct = total > 0 ? (count / total) * 100 : 0;
            const colors: Record<string, string> = { FREE: '#5F5E5A', STARTER: '#0369a1', GROWTH: '#D85A30', SCALE: '#7c3aed' };
            if (pct === 0) return null;
            return (
              <div key={plan} title={`${plan}: ${count} (${pct.toFixed(1)}%)`} style={{
                width: `${pct}%`, background: colors[plan],
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 700, color: 'white', minWidth: 30,
              }}>
                {pct >= 8 ? `${plan} ${count}` : ''}
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' as const, marginTop: 14 }}>
          {(['FREE', 'STARTER', 'GROWTH', 'SCALE'] as const).map((plan) => {
            const colors: Record<string, string> = { FREE: '#5F5E5A', STARTER: '#0369a1', GROWTH: '#D85A30', SCALE: '#7c3aed' };
            return (
              <div key={plan} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--text-secondary)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: colors[plan] }} />
                <span><strong style={{ color: 'var(--text-primary)' }}>{plan}</strong> {kpis.planCounts[plan] || 0}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function BigKpi({ icon: Icon, label, value, sub, delta, accent, inverse }: any) {
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{ width: 24, height: 24, borderRadius: 6, background: accent + '15', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon size={12} color={accent} />
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '-0.5px', lineHeight: 1.05, marginBottom: 4 }}>{value}</div>
      <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>{sub}</span>
        {typeof delta === 'number' && delta !== 0 && (
          <span style={{
            fontSize: 10, fontWeight: 600,
            color: (inverse ? delta < 0 : delta > 0) ? '#16a34a' : '#dc2626',
          }}>
            {delta > 0 ? '+' : ''}{delta}%
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Users Tab ─────────────────────────────────────────────────────────────

const PLAN_BADGE: Record<string, { bg: string; color: string }> = {
  FREE:    { bg: 'rgba(95,94,90,0.12)',  color: '#525252' },
  STARTER: { bg: 'rgba(3,105,161,0.12)', color: '#0369a1' },
  GROWTH:  { bg: 'rgba(216,90,48,0.12)', color: '#A33D14' },
  SCALE:   { bg: 'rgba(124,58,237,0.12)', color: '#7c3aed' },
};

const STATUS_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  ACTIVE:   { bg: 'rgba(22,163,74,0.12)', color: '#15803d', label: 'Active' },
  PAST_DUE: { bg: 'rgba(220,38,38,0.12)', color: '#991b1b', label: 'Past due' },
  CANCELED: { bg: 'rgba(115,115,115,0.12)', color: '#525252', label: 'Canceled' },
  TRIAL:    { bg: 'rgba(216,90,48,0.12)', color: '#A33D14', label: 'Trial' },
};

function UsersTab({ users, search }: { users: any[]; search: string }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div>
      <Form method="get" style={{ marginBottom: 16, position: 'relative', maxWidth: 360 }}>
        <input type="hidden" name="tab" value="users" />
        <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
        <input
          name="q"
          type="text"
          className="form-input"
          placeholder="Caută email, nume, companie..."
          defaultValue={search}
          style={{ width: '100%', paddingLeft: 36 }}
        />
      </Form>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
          <thead>
            <tr style={{ borderBottom: '0.5px solid var(--border-default)', background: 'var(--bg-tertiary)' }}>
              <Th>User</Th>
              <Th>Plan / Status</Th>
              <Th>Stores</Th>
              <Th>Last login</Th>
              <Th>Signup</Th>
              <Th>Acțiuni</Th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 30, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12 }}>Nu am găsit useri.</td></tr>
            )}
            {users.map((u: any) => {
              const plan = PLAN_BADGE[u.plan] || PLAN_BADGE.FREE;
              const status = STATUS_BADGE[u.status] || STATUS_BADGE.ACTIVE;
              const inTrial = u.trialEndsAt && new Date(u.trialEndsAt) > new Date();
              return (
                <>
                  <tr key={u.id} style={{ borderBottom: '0.5px solid var(--border-default)' }}>
                    <td style={{ padding: '10px 14px', verticalAlign: 'top' }}>
                      <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        {u.fullName || u.email}
                        {u.isSuperAdmin && <Crown size={10} color="var(--kimono-orange)" />}
                        {!u.emailVerified && <span title="Email neverificat" style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: 'rgba(220,38,38,0.1)', color: '#991b1b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Unverified</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{u.email}</div>
                      {u.company && <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)' }}>{u.company}</div>}
                    </td>
                    <td style={{ padding: '10px 14px', verticalAlign: 'top' }}>
                      <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 4 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: plan.bg, color: plan.color, alignSelf: 'flex-start' }}>{u.plan}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: status.bg, color: status.color, alignSelf: 'flex-start' }}>{status.label}</span>
                        {inTrial && (
                          <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                            Trial până {formatDate(u.trialEndsAt, 'date')}
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '10px 14px', verticalAlign: 'top', fontSize: 12, color: 'var(--text-primary)' }}>
                      {u.storesCount}
                    </td>
                    <td style={{ padding: '10px 14px', verticalAlign: 'top', fontSize: 11, color: 'var(--text-secondary)' }}>
                      {u.lastLoginAt ? formatDate(u.lastLoginAt, 'relative') : '—'}
                    </td>
                    <td style={{ padding: '10px 14px', verticalAlign: 'top', fontSize: 11, color: 'var(--text-secondary)' }}>
                      {formatDate(u.createdAt, 'date')}
                    </td>
                    <td style={{ padding: '10px 14px', verticalAlign: 'top' }}>
                      <button
                        type="button"
                        onClick={() => setOpenId(openId === u.id ? null : u.id)}
                        className="btn btn-secondary"
                        style={{ fontSize: 11, padding: '4px 10px' }}
                      >
                        {openId === u.id ? 'Închide' : 'Acțiuni'}
                      </button>
                    </td>
                  </tr>
                  {openId === u.id && (
                    <tr>
                      <td colSpan={6} style={{ padding: '12px 14px', background: 'var(--bg-tertiary)', borderBottom: '0.5px solid var(--border-default)' }}>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
                          {/* Impersonate */}
                          <Form method="post" onSubmit={(e) => { if (!confirm(`Login ca ${u.email}? Sesiunea ta curentă va fi înlocuită.`)) e.preventDefault(); }}>
                            <input type="hidden" name="intent" value="impersonate" />
                            <input type="hidden" name="userId" value={u.id} />
                            <button type="submit" className="btn btn-primary" style={{ fontSize: 11, padding: '5px 10px' }}>
                              <LogIn size={11} /> Login as
                            </button>
                          </Form>
                          {/* Change plan */}
                          <Form method="post" style={{ display: 'flex', gap: 4 }}>
                            <input type="hidden" name="intent" value="change_plan" />
                            <input type="hidden" name="userId" value={u.id} />
                            <select name="plan" defaultValue={u.plan} className="form-input" style={{ fontSize: 11, padding: '4px 8px', height: 28 }}>
                              <option value="FREE">FREE</option>
                              <option value="STARTER">STARTER</option>
                              <option value="GROWTH">GROWTH</option>
                              <option value="SCALE">SCALE</option>
                            </select>
                            <button type="submit" className="btn btn-secondary" style={{ fontSize: 11, padding: '5px 10px' }}>Schimbă plan</button>
                          </Form>
                          {/* Extend trial */}
                          <Form method="post" style={{ display: 'flex', gap: 4 }}>
                            <input type="hidden" name="intent" value="extend_trial" />
                            <input type="hidden" name="userId" value={u.id} />
                            <input type="number" name="days" defaultValue={14} min={1} max={365} className="form-input" style={{ fontSize: 11, padding: '4px 8px', height: 28, width: 60 }} />
                            <button type="submit" className="btn btn-secondary" style={{ fontSize: 11, padding: '5px 10px' }}>Trial +zile</button>
                          </Form>
                          {/* Verify email */}
                          {!u.emailVerified && (
                            <Form method="post">
                              <input type="hidden" name="intent" value="verify_email" />
                              <input type="hidden" name="userId" value={u.id} />
                              <button type="submit" className="btn btn-secondary" style={{ fontSize: 11, padding: '5px 10px' }}>
                                <CheckCircle2 size={11} /> Verifică email manual
                              </button>
                            </Form>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Stores Tab ────────────────────────────────────────────────────────────

function StoresTab({ stores }: { stores: any[] }) {
  return (
    <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
        <thead>
          <tr style={{ borderBottom: '0.5px solid var(--border-default)', background: 'var(--bg-tertiary)' }}>
            <Th>Magazin</Th>
            <Th>Owner</Th>
            <Th>Platformă</Th>
            <Th>Status</Th>
            <Th>Date</Th>
            <Th>Last sync</Th>
          </tr>
        </thead>
        <tbody>
          {stores.length === 0 && (
            <tr><td colSpan={6} style={{ padding: 30, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12 }}>Niciun magazin conectat încă.</td></tr>
          )}
          {stores.map((s: any) => {
            const overdue = s.lastSyncAt ? (Date.now() - new Date(s.lastSyncAt).getTime()) > 24 * 60 * 60 * 1000 : false;
            return (
              <tr key={s.id} style={{ borderBottom: '0.5px solid var(--border-default)' }}>
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text-primary)' }}>{s.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{s.domain}</div>
                </td>
                <td style={{ padding: '10px 14px', fontSize: 11 }}>
                  <div style={{ color: 'var(--text-primary)' }}>{s.user.fullName || s.user.email}</div>
                  <div style={{ color: 'var(--text-tertiary)' }}>{s.user.email}</div>
                  <div style={{ color: 'var(--text-tertiary)' }}>{s.user.subscription?.plan || 'FREE'}</div>
                </td>
                <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-primary)' }}>{s.platform}</td>
                <td style={{ padding: '10px 14px' }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99,
                    background: s.syncStatus === 'COMPLETED' ? 'rgba(22,163,74,0.12)' : s.syncStatus === 'FAILED' ? 'rgba(220,38,38,0.12)' : 'rgba(216,90,48,0.12)',
                    color: s.syncStatus === 'COMPLETED' ? '#15803d' : s.syncStatus === 'FAILED' ? '#991b1b' : '#A33D14',
                  }}>
                    {s.syncStatus}
                  </span>
                  {!s.isActive && <span style={{ fontSize: 10, marginLeft: 4, color: '#991b1b' }}>· inactiv</span>}
                </td>
                <td style={{ padding: '10px 14px', fontSize: 11, color: 'var(--text-secondary)' }}>
                  {formatNumber(s._count.orders)} ord · {formatNumber(s._count.customers)} cust · {formatNumber(s._count.products)} prod
                </td>
                <td style={{ padding: '10px 14px', fontSize: 11, color: overdue ? '#991b1b' : 'var(--text-secondary)' }}>
                  {s.lastSyncAt ? formatDate(s.lastSyncAt, 'relative') : 'niciodată'}
                  {overdue && <span style={{ fontSize: 9, marginLeft: 4, fontWeight: 700, color: '#991b1b' }}>· OVERDUE</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{
      padding: '8px 14px', textAlign: 'left' as const,
      fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)',
      textTransform: 'uppercase' as const, letterSpacing: '0.5px',
    }}>
      {children}
    </th>
  );
}

// ─── Cron Tab ──────────────────────────────────────────────────────────────

function CronTab({ d }: { d: any }) {
  return (
    <div>
      {d.perCron.length > 0 && (
        <div className="card" style={{ padding: 0, marginBottom: 18, overflowX: 'auto' }}>
          <div style={{ padding: '12px 18px', borderBottom: '0.5px solid var(--border-default)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Statistici 30 zile</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>Per cron: total run-uri, success rate, durată medie</div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 540 }}>
            <thead>
              <tr style={{ borderBottom: '0.5px solid var(--border-default)', background: 'var(--bg-tertiary)' }}>
                <Th>Cron</Th><Th>Total runs</Th><Th>Success rate</Th><Th>Failed</Th><Th>Durată medie</Th>
              </tr>
            </thead>
            <tbody>
              {d.perCron.map((c: any) => {
                const rate = c.total > 0 ? Math.round((c.success / c.total) * 100) : 0;
                return (
                  <tr key={c.name} style={{ borderBottom: '0.5px solid var(--border-default)' }}>
                    <td style={{ padding: '8px 14px', fontSize: 12, fontFamily: 'ui-monospace, monospace', color: 'var(--text-primary)' }}>{c.name}</td>
                    <td style={{ padding: '8px 14px', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{c.total}</td>
                    <td style={{ padding: '8px 14px', fontSize: 12, fontVariantNumeric: 'tabular-nums', color: rate >= 95 ? '#15803d' : rate >= 80 ? '#A33D14' : '#991b1b', fontWeight: 600 }}>{rate}%</td>
                    <td style={{ padding: '8px 14px', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{c.failed}</td>
                    <td style={{ padding: '8px 14px', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{c.avgMs}ms</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <div style={{ padding: '12px 18px', borderBottom: '0.5px solid var(--border-default)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Ultimele 100 run-uri</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>Cronologic, cele mai recente sus</div>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
          <thead>
            <tr style={{ borderBottom: '0.5px solid var(--border-default)', background: 'var(--bg-tertiary)' }}>
              <Th>Cron</Th><Th>Started</Th><Th>Duration</Th><Th>Status</Th><Th>Error</Th>
            </tr>
          </thead>
          <tbody>
            {d.recent.length === 0 && (
              <tr><td colSpan={5} style={{ padding: 30, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12 }}>Niciun run înregistrat încă (logging-ul e nou — datele vor apărea curând).</td></tr>
            )}
            {d.recent.map((r: any) => (
              <tr key={r.id} style={{ borderBottom: '0.5px solid var(--border-default)' }}>
                <td style={{ padding: '8px 14px', fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>{r.name}</td>
                <td style={{ padding: '8px 14px', fontSize: 11, color: 'var(--text-secondary)' }}>{formatDate(r.startedAt, 'relative')}</td>
                <td style={{ padding: '8px 14px', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
                  {r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : (r.finishedAt ? '—' : 'în desfășurare...')}
                </td>
                <td style={{ padding: '8px 14px' }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99,
                    background: r.success ? 'rgba(22,163,74,0.12)' : (r.finishedAt ? 'rgba(220,38,38,0.12)' : 'rgba(216,90,48,0.12)'),
                    color: r.success ? '#15803d' : (r.finishedAt ? '#991b1b' : '#A33D14'),
                  }}>
                    {r.success ? 'OK' : (r.finishedAt ? 'FAIL' : 'RUNNING')}
                  </span>
                </td>
                <td style={{ padding: '8px 14px', fontSize: 11, color: '#991b1b', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }} title={r.error || ''}>
                  {r.error || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Email Tab ─────────────────────────────────────────────────────────────

function EmailTab({ d }: { d: any }) {
  const successRate = d.totalSent > 0 ? Math.round(((d.totalSent - d.totalFailed) / d.totalSent) * 100) : 100;
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 }}>
        <BigKpi icon={CheckCircle2} label="Trimise 30d" value={formatNumber(d.totalSent)} sub={`${d.totalSent - d.totalFailed} OK · ${d.totalFailed} eșuate`} accent="#16a34a" />
        <BigKpi icon={Activity} label="Success rate" value={`${successRate}%`} sub="ultimele 30 zile" accent={successRate >= 95 ? '#16a34a' : '#dc2626'} inverse={successRate < 95} />
      </div>

      <div className="card" style={{ padding: 0, marginBottom: 18, overflowX: 'auto' }}>
        <div style={{ padding: '12px 18px', borderBottom: '0.5px solid var(--border-default)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Per categorie 30 zile</div>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
          <thead><tr style={{ borderBottom: '0.5px solid var(--border-default)', background: 'var(--bg-tertiary)' }}><Th>Categorie</Th><Th>OK</Th><Th>Eșuate</Th><Th>Rate</Th></tr></thead>
          <tbody>
            {d.byCategory.length === 0 && (
              <tr><td colSpan={4} style={{ padding: 30, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12 }}>Niciun email loggat încă.</td></tr>
            )}
            {d.byCategory.map((c: any) => {
              const total = c.success + c.failed;
              const rate = total > 0 ? Math.round((c.success / total) * 100) : 0;
              return (
                <tr key={c.category} style={{ borderBottom: '0.5px solid var(--border-default)' }}>
                  <td style={{ padding: '8px 14px', fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>{c.category}</td>
                  <td style={{ padding: '8px 14px', fontSize: 12, fontVariantNumeric: 'tabular-nums', color: '#15803d' }}>{c.success}</td>
                  <td style={{ padding: '8px 14px', fontSize: 12, fontVariantNumeric: 'tabular-nums', color: c.failed > 0 ? '#991b1b' : 'var(--text-secondary)' }}>{c.failed}</td>
                  <td style={{ padding: '8px 14px', fontSize: 12, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{rate}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {d.failed.length > 0 && (
        <div className="card" style={{ padding: 0, marginBottom: 18, overflowX: 'auto' }}>
          <div style={{ padding: '12px 18px', borderBottom: '0.5px solid var(--border-default)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#991b1b' }}>Email-uri eșuate recent (top 30)</div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
            <thead><tr style={{ borderBottom: '0.5px solid var(--border-default)', background: 'var(--bg-tertiary)' }}><Th>Sent at</Th><Th>To</Th><Th>Subject</Th><Th>Error</Th></tr></thead>
            <tbody>
              {d.failed.map((f: any, i: number) => (
                <tr key={i} style={{ borderBottom: '0.5px solid var(--border-default)' }}>
                  <td style={{ padding: '8px 14px', fontSize: 11, color: 'var(--text-secondary)' }}>{formatDate(f.sentAt, 'relative')}</td>
                  <td style={{ padding: '8px 14px', fontSize: 11, fontFamily: 'ui-monospace, monospace' }}>{f.to}</td>
                  <td style={{ padding: '8px 14px', fontSize: 11 }}>{f.subject}</td>
                  <td style={{ padding: '8px 14px', fontSize: 11, color: '#991b1b', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }} title={f.error || ''}>{f.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── PM2 Tab ───────────────────────────────────────────────────────────────

function Pm2Tab({ d }: { d: any }) {
  if (d.error) {
    return (
      <div className="card" style={{ padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: '#991b1b' }}>Eroare la citirea PM2: {d.error}</div>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6 }}>Verifică că <code>pm2</code> e instalat global pe VPS.</div>
      </div>
    );
  }
  return (
    <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
      <div style={{ padding: '12px 18px', borderBottom: '0.5px solid var(--border-default)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{d.processes.length} procese PM2</div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
        <thead><tr style={{ borderBottom: '0.5px solid var(--border-default)', background: 'var(--bg-tertiary)' }}><Th>Name</Th><Th>Status</Th><Th>CPU</Th><Th>Memory</Th><Th>Restarts</Th><Th>Uptime</Th><Th>Mode</Th></tr></thead>
        <tbody>
          {d.processes.map((p: any, i: number) => {
            const uptimeStr = p.uptime ? formatDuration(p.uptime) : '—';
            return (
              <tr key={i} style={{ borderBottom: '0.5px solid var(--border-default)' }}>
                <td style={{ padding: '8px 14px', fontSize: 12, fontFamily: 'ui-monospace, monospace', color: 'var(--text-primary)' }}>{p.name}</td>
                <td style={{ padding: '8px 14px' }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99,
                    background: p.status === 'online' ? 'rgba(22,163,74,0.12)' : 'rgba(220,38,38,0.12)',
                    color: p.status === 'online' ? '#15803d' : '#991b1b',
                  }}>{p.status}</span>
                </td>
                <td style={{ padding: '8px 14px', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{p.cpu}%</td>
                <td style={{ padding: '8px 14px', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{p.memMB} MB</td>
                <td style={{ padding: '8px 14px', fontSize: 12, fontVariantNumeric: 'tabular-nums', color: p.restarts > 50 ? '#A33D14' : 'var(--text-primary)' }}>{p.restarts}</td>
                <td style={{ padding: '8px 14px', fontSize: 11, color: 'var(--text-secondary)' }}>{uptimeStr}</td>
                <td style={{ padding: '8px 14px', fontSize: 11, color: 'var(--text-tertiary)' }}>{p.execMode}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatDuration(ms: number) {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86400_000) return `${Math.round(ms / 3600_000)}h`;
  return `${Math.round(ms / 86400_000)}d`;
}

// ─── Ask AI Tab ────────────────────────────────────────────────────────────

function AskAiTab({ d }: { d: any }) {
  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ padding: '12px 18px', borderBottom: '0.5px solid var(--border-default)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Top întrebări Ask AI · {formatNumber(d.totalReports)} rapoarte analizate</div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>Grupate după title (intent rough). Util pentru product insights — ce vor users.</div>
      </div>
      {d.top.length === 0 ? (
        <div style={{ padding: '30px 18px', textAlign: 'center', fontSize: 12, color: 'var(--text-tertiary)' }}>Niciun raport Ask AI încă.</div>
      ) : (
        d.top.map((q: any, i: number) => (
          <div key={i} style={{ padding: '10px 18px', borderBottom: '0.5px solid var(--border-default)', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', minWidth: 30 }}>#{i + 1}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }} title={q.title}>
                {q.title}
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)', marginTop: 2 }}>
                Ultima dată: {formatDate(q.lastAt, 'relative')}
              </div>
            </div>
            <div style={{ textAlign: 'right' as const, flexShrink: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--kimono-orange)' }}>{q.count}× întrebări</div>
              <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)' }}>${q.cost.toFixed(2)} · {formatNumber(q.tokens)} tokens</div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── Revenue & MRR ──
function RevenueTab({ d }: { d: any }) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        {[
          { label: 'MRR', value: `€${d.mrr}`, color: '#10B981' },
          { label: 'ARR', value: `€${d.arr.toLocaleString()}`, color: '#3B82F6' },
          { label: 'Paid Users', value: d.totalPaid, color: '#8B5CF6' },
          { label: 'Churn 30d', value: d.churnRate30, color: d.churnRate30 > 0 ? '#EF4444' : '#10B981' },
        ].map((k, i) => (
          <div key={i} style={{ background: '#111827', border: '1px solid #1F2937', borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{k.label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: k.color }}>{k.value}</div>
          </div>
        ))}
      </div>
      <div style={{ background: '#111827', border: '1px solid #1F2937', borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 16 }}>Evolutie lunara (ultimele 6 luni)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
          {d.months.map((m: any) => (
            <div key={m.month} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: '#666', marginBottom: 8 }}>{m.month}</div>
              <div style={{ height: 60, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 2 }}>
                <div style={{ background: '#10B981', borderRadius: 4, height: Math.max(4, m.newPaid * 15), transition: 'height 0.3s' }} title={`+${m.newPaid} paid`} />
                {m.churned > 0 && <div style={{ background: '#EF4444', borderRadius: 4, height: Math.max(4, m.churned * 15) }} title={`-${m.churned} churned`} />}
              </div>
              <div style={{ fontSize: 10, color: '#10B981', marginTop: 4 }}>+{m.newPaid}</div>
              {m.churned > 0 && <div style={{ fontSize: 10, color: '#EF4444' }}>-{m.churned}</div>}
            </div>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ background: '#111827', border: '1px solid #1F2937', borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>Distributie</div>
          <div style={{ fontSize: 13, color: '#fff' }}>Free: {d.totalFree} | Paid: {d.totalPaid}</div>
          <div style={{ marginTop: 8, height: 8, borderRadius: 4, background: '#1F2937', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${d.totalPaid / (d.totalFree + d.totalPaid) * 100}%`, background: 'linear-gradient(90deg, #FF5A1F, #10B981)', borderRadius: 4 }} />
          </div>
          <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>Conversie: {((d.totalPaid / (d.totalFree + d.totalPaid || 1)) * 100).toFixed(1)}%</div>
        </div>
        <div style={{ background: '#111827', border: '1px solid #1F2937', borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>Health</div>
          <div style={{ fontSize: 13, color: d.churnRate30 > 2 ? '#EF4444' : '#10B981' }}>
            {d.churnRate30 === 0 ? 'Zero churn in ultimele 30 zile' : `${d.churnRate30} cancelari in 30 zile`}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── User Funnel ──
function FunnelTab({ d }: { d: any }) {
  const steps = [
    { label: 'Registered', value: d.totalRegistered, color: '#6366F1' },
    { label: 'Email Verified', value: d.totalVerified, color: '#8B5CF6' },
    { label: 'Connected Store', value: d.totalWithStore, color: '#3B82F6' },
    { label: 'Has Orders', value: d.totalWithOrders, color: '#10B981' },
    { label: 'Paid Plan', value: d.totalPaidPlan, color: '#FF5A1F' },
  ];
  const maxVal = steps[0].value || 1;

  return (
    <div>
      <div style={{ background: '#111827', border: '1px solid #1F2937', borderRadius: 12, padding: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 20 }}>User Conversion Funnel</div>
        {steps.map((step, i) => {
          const pct = ((step.value / maxVal) * 100).toFixed(1);
          const dropoff = i > 0 ? ((1 - step.value / steps[i-1].value) * 100).toFixed(0) : '0';
          return (
            <div key={step.label} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: '#ddd' }}>{step.label}</span>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span style={{ fontSize: 20, fontWeight: 700, color: step.color }}>{step.value}</span>
                  <span style={{ fontSize: 11, color: '#666' }}>({pct}%)</span>
                  {i > 0 && Number(dropoff) > 0 && <span style={{ fontSize: 10, color: '#EF4444', background: 'rgba(239,68,68,0.1)', padding: '2px 6px', borderRadius: 4 }}>-{dropoff}% drop</span>}
                </div>
              </div>
              <div style={{ height: 10, borderRadius: 5, background: '#1F2937', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: step.color, borderRadius: 5, transition: 'width 0.5s' }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Alerts ──
function AlertsTab({ d }: { d: any }) {
  const total = (d.syncFailed?.length || 0) + (d.syncOverdue?.length || 0) + (d.paymentFailed?.length || 0) + (d.trialExpiring?.length || 0);
  return (
    <div>
      <div style={{ marginBottom: 16, padding: '12px 16px', background: total > 0 ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.08)', border: `1px solid ${total > 0 ? 'rgba(239,68,68,0.2)' : 'rgba(16,185,129,0.2)'}`, borderRadius: 10, fontSize: 13, color: total > 0 ? '#fca5a5' : '#6EE7B7' }}>
        {total > 0 ? `${total} alerte active` : 'Nicio alerta activa — totul merge bine'}
      </div>
      {d.syncFailed?.length > 0 && (
        <div style={{ background: '#111827', border: '1px solid #1F2937', borderRadius: 12, padding: 20, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#EF4444', marginBottom: 12 }}>Sync Failed ({d.syncFailed.length})</div>
          {d.syncFailed.map((s: any) => (
            <div key={s.id} style={{ padding: '8px 0', borderBottom: '1px solid #1F2937', fontSize: 12, color: '#ccc', display: 'flex', justifyContent: 'space-between' }}>
              <span>{s.name} ({s.domain})</span>
              <span style={{ color: '#888' }}>{s.user?.email}</span>
            </div>
          ))}
        </div>
      )}
      {d.syncOverdue?.length > 0 && (
        <div style={{ background: '#111827', border: '1px solid #1F2937', borderRadius: 12, padding: 20, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#F59E0B', marginBottom: 12 }}>Sync Overdue &gt;24h ({d.syncOverdue.length})</div>
          {d.syncOverdue.map((s: any) => (
            <div key={s.id} style={{ padding: '8px 0', borderBottom: '1px solid #1F2937', fontSize: 12, color: '#ccc', display: 'flex', justifyContent: 'space-between' }}>
              <span>{s.name}</span>
              <span style={{ color: '#888' }}>{s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleString('ro-RO') : 'never'}</span>
            </div>
          ))}
        </div>
      )}
      {d.paymentFailed?.length > 0 && (
        <div style={{ background: '#111827', border: '1px solid #1F2937', borderRadius: 12, padding: 20, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#EF4444', marginBottom: 12 }}>Payment Failed / Past Due ({d.paymentFailed.length})</div>
          {d.paymentFailed.map((s: any) => (
            <div key={s.id} style={{ padding: '8px 0', borderBottom: '1px solid #1F2937', fontSize: 12, color: '#ccc' }}>
              {s.user?.fullName || s.user?.email} — Plan: {s.plan}
            </div>
          ))}
        </div>
      )}
      {d.trialExpiring?.length > 0 && (
        <div style={{ background: '#111827', border: '1px solid #1F2937', borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#F59E0B', marginBottom: 12 }}>Trial Expiring in 3 zile ({d.trialExpiring.length})</div>
          {d.trialExpiring.map((s: any) => (
            <div key={s.id} style={{ padding: '8px 0', borderBottom: '1px solid #1F2937', fontSize: 12, color: '#ccc' }}>
              {s.user?.fullName || s.user?.email} — Expira: {new Date(s.trialEndsAt).toLocaleDateString('ro-RO')}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Quick Actions ──
function ActionsTab({ stores }: { stores: any[] }) {
  const [result, setResult] = useState('');
  const submit = useSubmit();

  return (
    <div>
      {result && (
        <div style={{ marginBottom: 16, padding: '10px 14px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 8, fontSize: 12, color: '#6EE7B7' }}>
          {result}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ background: '#111827', border: '1px solid #1F2937', borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 12 }}>Force Sync Store</div>
          <p style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>Forteaza sincronizarea unui magazin specific</p>
          <Form method="post" onSubmit={() => setResult('Sync declansat...')}>
            <input type="hidden" name="intent" value="force_sync" />
            <select name="storeId" style={{ width: '100%', padding: '8px 10px', background: '#0B0E14', border: '1px solid #1F2937', borderRadius: 6, color: '#fff', fontSize: 12, marginBottom: 8 }}>
              {stores.map(s => <option key={s.id} value={s.id}>{s.name} ({s.user?.email})</option>)}
            </select>
            <button type="submit" style={{ width: '100%', padding: '8px 0', background: '#FF5A1F', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              Sync Now
            </button>
          </Form>
        </div>
        <div style={{ background: '#111827', border: '1px solid #1F2937', borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 12 }}>Send Email</div>
          <p style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>Trimite un email catre un utilizator</p>
          <Form method="post" onSubmit={() => setResult('Email trimis...')}>
            <input type="hidden" name="intent" value="send_email" />
            <input name="to" placeholder="email@exemplu.com" style={{ width: '100%', padding: '8px 10px', background: '#0B0E14', border: '1px solid #1F2937', borderRadius: 6, color: '#fff', fontSize: 12, marginBottom: 6 }} />
            <input name="subject" placeholder="Subiect" style={{ width: '100%', padding: '8px 10px', background: '#0B0E14', border: '1px solid #1F2937', borderRadius: 6, color: '#fff', fontSize: 12, marginBottom: 6 }} />
            <textarea name="body" placeholder="Mesaj..." rows={3} style={{ width: '100%', padding: '8px 10px', background: '#0B0E14', border: '1px solid #1F2937', borderRadius: 6, color: '#fff', fontSize: 12, marginBottom: 8, resize: 'none' }} />
            <button type="submit" style={{ width: '100%', padding: '8px 0', background: '#3B82F6', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              Trimite Email
            </button>
          </Form>
        </div>
        <div style={{ background: '#111827', border: '1px solid #1F2937', borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 12 }}>Recalculate RFM</div>
          <p style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>Forteaza recalcularea segmentelor RFM</p>
          <Form method="post" onSubmit={() => setResult('RFM recalculation triggered...')}>
            <input type="hidden" name="intent" value="recalc_rfm" />
            <button type="submit" style={{ width: '100%', padding: '8px 0', background: '#8B5CF6', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              Recalculeaza RFM
            </button>
          </Form>
        </div>
        <div style={{ background: '#111827', border: '1px solid #1F2937', borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 12 }}>PM2 Restart</div>
          <p style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>Restart graceful al aplicatiei</p>
          <Form method="post" onSubmit={() => setResult('PM2 reload triggered...')}>
            <input type="hidden" name="intent" value="pm2_reload" />
            <button type="submit" style={{ width: '100%', padding: '8px 0', background: '#F59E0B', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              Reload PM2
            </button>
          </Form>
        </div>
      </div>
    </div>
  );
}

// ── Feature Flags ──
function FlagsTab({ users }: { users: any[] }) {
  return (
    <div>
      <div style={{ background: '#111827', border: '1px solid #1F2937', borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 8 }}>Feature Flags</div>
        <p style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>Schimba planul unui utilizator pentru a-i activa/dezactiva feature-uri</p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1F2937' }}>
                <th style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11, color: '#888', textTransform: 'uppercase' }}>User</th>
                <th style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11, color: '#888', textTransform: 'uppercase' }}>Plan</th>
                <th style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11, color: '#888', textTransform: 'uppercase' }}>Status</th>
                <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 11, color: '#888', textTransform: 'uppercase' }}>Actiune</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u: any) => {
                const plan = u.subscription?.plan || 'FREE';
                const status = u.subscription?.status || 'ACTIVE';
                const planColors: Record<string, string> = { FREE: '#888', STARTER: '#3B82F6', GROWTH: '#10B981', SCALE: '#8B5CF6' };
                return (
                  <tr key={u.id} style={{ borderBottom: '1px solid #1F2937' }}>
                    <td style={{ padding: '10px', fontSize: 12, color: '#ddd' }}>
                      <div>{u.fullName || 'N/A'}</div>
                      <div style={{ fontSize: 10, color: '#666' }}>{u.email}</div>
                    </td>
                    <td style={{ padding: '10px' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: planColors[plan] || '#888', background: 'rgba(255,255,255,0.05)', padding: '3px 8px', borderRadius: 4 }}>{plan}</span>
                    </td>
                    <td style={{ padding: '10px', fontSize: 11, color: status === 'ACTIVE' ? '#10B981' : '#EF4444' }}>{status}</td>
                    <td style={{ padding: '10px', textAlign: 'right' }}>
                      <Form method="post" style={{ display: 'inline' }}>
                        <input type="hidden" name="intent" value="change_plan" />
                        <input type="hidden" name="userId" value={u.id} />
                        <select name="plan" defaultValue={plan} style={{ padding: '4px 6px', background: '#0B0E14', border: '1px solid #1F2937', borderRadius: 4, color: '#fff', fontSize: 11, marginRight: 6 }}>
                          <option value="FREE">FREE</option>
                          <option value="STARTER">STARTER</option>
                          <option value="GROWTH">GROWTH</option>
                          <option value="SCALE">SCALE</option>
                        </select>
                        <button type="submit" style={{ padding: '4px 10px', background: '#FF5A1F', border: 'none', borderRadius: 4, color: '#fff', fontSize: 11, cursor: 'pointer' }}>Save</button>
                      </Form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
