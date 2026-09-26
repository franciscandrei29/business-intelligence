import { useState } from 'react';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Form, useLoaderData, useSearchParams } from '@remix-run/react';
import { requireUser, requireUserContext } from '~/lib/auth/requireAuth.server';
import { requireModule } from '~/lib/plans.server';
import { db } from '~/lib/db.server';
import { Target, TrendingUp, Zap, Rocket, AlertCircle } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Goal Tracker — Kimono BI' }];

type GoalDirection = 'up' | 'down';

interface Goal {
  key: string; name: string; hint: string;
  current: number; currentDisplay: string;
  target: number; targetDisplay: string;
  prev: number; prevDisplay: string;
  unit: string; direction: GoalDirection;
  pct: number; status: 'ahead' | 'on-track' | 'at-risk' | 'behind'; color: string;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await requireUserContext(request);
  const user = ctx.user;
  await requireModule(request, ctx.effectiveOwnerId, 'goals');
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');

  const stores = await db.storeConnection.findMany({ where: { userId: ctx.effectiveOwnerId }, select: { id: true, name: true } });
  const selectedStoreId = storeId || stores[0]?.id;
  if (!selectedStoreId) return json({ stores, goals: [], monthProgress: 0, currentMonth: '', selectedStoreId: null });

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  const dayOfMonth = now.getDate();
  const daysInMonth = monthEnd.getDate();
  const monthProgress = dayOfMonth / daysInMonth;

  const [currentOrders, prevOrders, currentCustomers, prevCustomers] = await Promise.all([
    db.order.findMany({ where: { storeConnectionId: selectedStoreId, placedAt: { gte: monthStart } }, select: { total: true, customerId: true, totalRefunded: true, lineItems: true, placedAt: true } }),
    db.order.findMany({ where: { storeConnectionId: selectedStoreId, placedAt: { gte: prevMonthStart, lte: prevMonthEnd } }, select: { total: true, customerId: true, totalRefunded: true, lineItems: true } }),
    db.customer.count({ where: { storeConnectionId: selectedStoreId, firstOrderAt: { gte: monthStart } } }),
    db.customer.count({ where: { storeConnectionId: selectedStoreId, firstOrderAt: { gte: prevMonthStart, lte: prevMonthEnd } } }),
  ]);

  const curRevenue = currentOrders.reduce((s, o) => s + Number(o.total), 0);
  const prevRevenue = prevOrders.reduce((s, o) => s + Number(o.total), 0);
  const curOrderCount = currentOrders.length;
  const prevOrderCount = prevOrders.length;
  const curAov = curOrderCount > 0 ? curRevenue / curOrderCount : 0;
  const prevAov = prevOrderCount > 0 ? prevRevenue / prevOrderCount : 0;
  const curRefunds = currentOrders.reduce((s, o) => s + Number(o.totalRefunded || 0), 0);
  const prevRefunds = prevOrders.reduce((s, o) => s + Number(o.totalRefunded || 0), 0);

  const curCustMap: Record<string, number> = {};
  for (const o of currentOrders) if (o.customerId) curCustMap[o.customerId] = (curCustMap[o.customerId] || 0) + 1;
  const curUnique = Object.keys(curCustMap).length;
  const curRepeat = Object.values(curCustMap).filter((c) => c > 1).length;
  const curRepeatRate = curUnique > 0 ? (curRepeat / curUnique) * 100 : 0;

  const prevCustMap: Record<string, number> = {};
  for (const o of prevOrders) if (o.customerId) prevCustMap[o.customerId] = (prevCustMap[o.customerId] || 0) + 1;
  const prevUnique = Object.keys(prevCustMap).length;
  const prevRepeat = Object.values(prevCustMap).filter((c) => c > 1).length;
  const prevRepeatRate = prevUnique > 0 ? (prevRepeat / prevUnique) * 100 : 0;

  const curRefundRate = curOrderCount > 0 ? (curRefunds / curRevenue) * 100 : 0;
  const prevRefundRate = prevOrderCount > 0 ? (prevRefunds / prevRevenue) * 100 : 0;

  function fmt(n: number, unit: string): string {
    if (unit === '%') return n.toFixed(1);
    return Math.round(n).toLocaleString('ro-RO');
  }

  function buildGoal(key: string, name: string, hint: string, cur: number, prev: number, unit: string, direction: GoalDirection, growthPct: number = 10): Goal {
    const growthFactor = direction === 'up' ? 1 + growthPct / 100 : 1 - growthPct / 100;
    const target = Math.max(0, prev * growthFactor);
    const pct = target > 0 ? Math.min(999, Math.max(0, (cur / target) * 100)) : 0;
    const expectedProgress = direction === 'up' ? target * monthProgress : Math.max(target, prev * 0.5);
    const pace = direction === 'up'
      ? (expectedProgress > 0 ? cur / expectedProgress : 0)
      : (cur <= target ? 1 : target / Math.max(cur, 0.01));
    let status: Goal['status'] = 'behind'; let color = '#dc2626';
    if (pace >= 1.0) { status = 'ahead'; color = '#16a34a'; }
    else if (pace >= 0.85) { status = 'on-track'; color = '#16a34a'; }
    else if (pace >= 0.6) { status = 'at-risk'; color = '#d97706'; }
    return { key, name, hint, current: Math.round(cur * 100) / 100, currentDisplay: fmt(cur, unit), target: Math.round(target * 100) / 100, targetDisplay: fmt(target, unit), prev: Math.round(prev * 100) / 100, prevDisplay: fmt(prev, unit), unit, direction, pct: Math.round(pct * 10) / 10, status, color };
  }

  const growthParam = parseInt(url.searchParams.get('growth') || '10', 10);
  const growth = [5, 10, 15, 20, 25, 30, 40, 50].includes(growthParam) ? growthParam : 10;

  const goals: Goal[] = [
    buildGoal('revenue', 'Venit total', `+${growth}% vs luna trecută`, curRevenue, prevRevenue, 'RON', 'up', growth),
    buildGoal('orders', 'Comenzi', `+${growth}% vs luna trecută`, curOrderCount, prevOrderCount, '', 'up', growth),
    buildGoal('aov', 'AOV', `+${growth}% vs luna trecută`, curAov, prevAov, 'RON', 'up', growth),
    buildGoal('newCustomers', 'Clienți noi', `+${growth}% vs luna trecută`, currentCustomers, prevCustomers, '', 'up', growth),
    buildGoal('repeatRate', 'Rata repeat purchase', `+${growth}% vs luna trecută`, curRepeatRate, prevRepeatRate || 5, '%', 'up', growth),
    buildGoal('refundRate', 'Rata refund (↓)', `-${growth}% vs luna trecută`, curRefundRate, prevRefundRate || 2, '%', 'down', growth),
  ];

  // Daily tracking table
  const dailyTracking: Array<{ date: string; revenue: number; orders: number; aov: number; newCustomers: number; cumulativeRevenue: number; cumulativeOrders: number }> = [];
  let cumRevenue = 0;
  let cumOrders = 0;
  for (let day = 1; day <= dayOfMonth; day++) {
    const dayStart = new Date(now.getFullYear(), now.getMonth(), day, 0, 0, 0);
    const dayEnd = new Date(now.getFullYear(), now.getMonth(), day, 23, 59, 59, 999);
    const dayOrders = currentOrders.filter(o => {
      const d = new Date((o as any).placedAt);
      return d >= dayStart && d <= dayEnd;
    });
    const dayRevenue = dayOrders.reduce((s, o) => s + Number(o.total), 0);
    const dayOrderCount = dayOrders.length;
    const dayAov = dayOrderCount > 0 ? dayRevenue / dayOrderCount : 0;
    cumRevenue += dayRevenue;
    cumOrders += dayOrderCount;
    dailyTracking.push({
      date: `${day}`,
      revenue: Math.round(dayRevenue),
      orders: dayOrderCount,
      aov: Math.round(dayAov),
      newCustomers: 0, // would need per-day query
      cumulativeRevenue: Math.round(cumRevenue),
      cumulativeOrders: cumOrders,
    });
  }

  return json({ stores, goals, growth, dailyTracking, monthProgress: Math.round(monthProgress * 100), currentMonth: now.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' }), selectedStoreId });
}

const STATUS_CFG: Record<string, { label: string; Icon: any; color: string }> = {
  ahead:      { label: 'Înainte',  Icon: Rocket,      color: '#16a34a' },
  'on-track': { label: 'On Track', Icon: TrendingUp,   color: '#16a34a' },
  'at-risk':  { label: 'La risc',  Icon: AlertCircle,  color: '#d97706' },
  behind:     { label: 'În urmă',  Icon: Zap,          color: '#dc2626' },
};

export default function GoalsPage() {
  const { stores, goals, growth, dailyTracking, monthProgress, currentMonth, selectedStoreId } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Goal Tracker</h1>
          <p className="page-subtitle">{currentMonth} · {monthProgress}% din lună</p>
        </div>
        <div className="page-actions">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Target:</span>
            <select className="form-input" style={{ width: 90, fontSize: 12 }} value={growth}
              onChange={(e) => {
                const p = new URLSearchParams(searchParams);
                p.set('growth', e.target.value);
                setSearchParams(p);
              }}>
              {[5, 10, 15, 20, 25, 30, 40, 50].map(n => (
                <option key={n} value={n}>+{n}%</option>
              ))}
            </select>
          </div>
          {stores.length > 1 && (
            <select className="form-input" style={{ width: 180 }} value={selectedStoreId || ''}
              onChange={(e) => setSearchParams({ store: e.target.value })}>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
        </div>
      </div>

      {!goals || goals.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '56px 24px' }}>
          <Target size={40} color="var(--text-secondary)" style={{ marginBottom: 12 }} />
          <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Conectează un magazin pentru a vedea targetele.</p>
        </div>
      ) : (
        <>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {goals.map((g) => <GoalCard key={g.key} goal={g} monthProgress={monthProgress} />)}
        </div>

        {/* Daily Tracking Table */}
        {dailyTracking && dailyTracking.length > 0 && (
          <div className="card" style={{ marginTop: 16, overflowX: 'auto' }}>
            <div style={{ padding: '14px 20px', borderBottom: '0.5px solid var(--border-default)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Tracking zilnic — {currentMonth}</span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{dailyTracking.length} zile</span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 500 }}>
              <thead>
                <tr style={{ borderBottom: '0.5px solid var(--border-default)' }}>
                  {['Ziua', 'Venit', 'Comenzi', 'AOV', 'Venit cumulat', 'Comenzi cumulate'].map((h, i) => (
                    <th key={h} style={{ padding: '10px 14px', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textAlign: i === 0 ? 'left' : 'right', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dailyTracking.map((d: any, i: number) => {
                  const target = goals.find(g => g.key === 'revenue');
                  const dailyTarget = target ? target.target / (new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()) : 0;
                  const isGood = d.revenue >= dailyTarget * 0.85;
                  return (
                    <tr key={d.date} style={{ borderBottom: i < dailyTracking.length - 1 ? '0.5px solid var(--border-default)' : undefined, background: i === dailyTracking.length - 1 ? 'rgba(216,90,48,0.03)' : undefined }}>
                      <td style={{ padding: '8px 14px', fontSize: 12, fontWeight: i === dailyTracking.length - 1 ? 600 : 400, color: 'var(--text-primary)' }}>{d.date} {currentMonth.split(' ')[0]?.slice(0, 3)}</td>
                      <td style={{ padding: '8px 14px', fontSize: 12, textAlign: 'right', fontWeight: 600, color: isGood ? 'var(--success-text)' : d.revenue === 0 ? 'var(--text-tertiary)' : 'var(--text-primary)', whiteSpace: 'nowrap' }}>{d.revenue.toLocaleString('ro-RO')} RON</td>
                      <td style={{ padding: '8px 14px', fontSize: 12, textAlign: 'right', whiteSpace: 'nowrap' }}>{d.orders}</td>
                      <td style={{ padding: '8px 14px', fontSize: 12, textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{d.aov} RON</td>
                      <td style={{ padding: '8px 14px', fontSize: 12, textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap', color: 'var(--kimono-orange)' }}>{d.cumulativeRevenue.toLocaleString('ro-RO')} RON</td>
                      <td style={{ padding: '8px 14px', fontSize: 12, textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{d.cumulativeOrders}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Month Analysis */}
        {goals.length > 0 && monthProgress >= 90 && (
          <div className="card" style={{ marginTop: 16, padding: '20px', borderLeft: '3px solid var(--kimono-orange)' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>Analiză finală {currentMonth}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
              {goals.map(g => {
                const hit = g.pct >= 100;
                return (
                  <div key={g.key} style={{ padding: '10px 14px', borderRadius: 8, background: hit ? 'rgba(22,163,74,0.06)' : 'rgba(220,38,38,0.06)', border: '0.5px solid ' + (hit ? 'rgba(22,163,74,0.2)' : 'rgba(220,38,38,0.2)') }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: hit ? '#16a34a' : '#dc2626', marginBottom: 4 }}>{hit ? '✓' : '✗'} {g.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{g.currentDisplay}{g.unit === '%' ? '%' : ' ' + g.unit} / {g.targetDisplay}{g.unit === '%' ? '%' : ' ' + g.unit} ({g.pct}%)</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </>
      )}
    </div>
  );
}

function GoalCard({ goal, monthProgress }: { goal: any; monthProgress: number }) {
  const cfg = STATUS_CFG[goal.status] || STATUS_CFG.behind;
  const Icon = cfg.Icon;
  const displayPct = Math.min(100, goal.pct);

  return (
    <div className="card" style={{ padding: '18px 20px', borderLeft: `3px solid ${goal.color}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 2 }}>{goal.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{goal.hint}</div>
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 99, background: `${goal.color}18`, color: goal.color, fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
          <Icon size={10} /> {cfg.label}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.5px' }}>
          {goal.currentDisplay}{goal.unit === '%' ? '%' : ''}
        </span>
        {goal.unit && goal.unit !== '%' && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{goal.unit}</span>}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 14 }}>
        Target: <strong style={{ color: 'var(--text-primary)' }}>{goal.targetDisplay}{goal.unit === '%' ? '%' : ''}</strong>
        {' · '}Luna trecută: {goal.prevDisplay}{goal.unit === '%' ? '%' : ''}
      </div>

      {/* Progress bar */}
      <div style={{ height: 6, borderRadius: 3, background: 'var(--border-default)', marginBottom: 6, overflow: 'hidden', position: 'relative' }}>
        <div style={{ width: `${displayPct}%`, height: '100%', background: goal.color, borderRadius: 3 }} />
        <div style={{ position: 'absolute', left: `${monthProgress}%`, top: 0, bottom: 0, width: 1.5, background: 'var(--text-secondary)', opacity: 0.4 }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-secondary)' }}>
        <span>{goal.pct}% din target</span>
        <span>{monthProgress}% din lună</span>
      </div>
    </div>
  );
}
