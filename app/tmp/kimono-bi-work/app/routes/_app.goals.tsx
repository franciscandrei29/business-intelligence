import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData, useSearchParams } from '@remix-run/react';
import { requireUser } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import { Target, TrendingUp, Zap, Rocket, AlertCircle } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Goal Tracker — Kimono BI' }];

type GoalDirection = 'up' | 'down';

interface Goal {
  key: string;
  name: string;
  hint: string;
  current: number;
  currentDisplay: string;
  target: number;
  targetDisplay: string;
  prev: number;
  prevDisplay: string;
  unit: string;
  direction: GoalDirection;
  pct: number;
  status: 'ahead' | 'on-track' | 'at-risk' | 'behind';
  color: string;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');

  const stores = await db.storeConnection.findMany({
    where: { userId: user.id },
    select: { id: true, name: true },
  });

  const selectedStoreId = storeId || stores[0]?.id;
  if (!selectedStoreId) return json({ stores, goals: [], monthProgress: 0, currentMonth: '', selectedStoreId: null });

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const dayOfMonth = now.getDate();
  const daysInMonth = monthEnd.getDate();
  const monthProgress = dayOfMonth / daysInMonth;

  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

  const [currentOrders, prevOrders, currentCustomers, prevCustomers] = await Promise.all([
    db.order.findMany({
      where: { storeConnectionId: selectedStoreId, placedAt: { gte: monthStart } },
      select: { total: true, customerId: true, totalRefunded: true, lineItems: true },
    }),
    db.order.findMany({
      where: { storeConnectionId: selectedStoreId, placedAt: { gte: prevMonthStart, lte: prevMonthEnd } },
      select: { total: true, customerId: true, totalRefunded: true, lineItems: true },
    }),
    db.customer.count({
      where: { storeConnectionId: selectedStoreId, firstOrderAt: { gte: monthStart } },
    }),
    db.customer.count({
      where: { storeConnectionId: selectedStoreId, firstOrderAt: { gte: prevMonthStart, lte: prevMonthEnd } },
    }),
  ]);

  const curRevenue = currentOrders.reduce((s, o) => s + Number(o.total), 0);
  const prevRevenue = prevOrders.reduce((s, o) => s + Number(o.total), 0);
  const curOrderCount = currentOrders.length;
  const prevOrderCount = prevOrders.length;
  const curAov = curOrderCount > 0 ? curRevenue / curOrderCount : 0;
  const prevAov = prevOrderCount > 0 ? prevRevenue / prevOrderCount : 0;
  const curRefunds = currentOrders.reduce((s, o) => s + Number(o.totalRefunded || 0), 0);
  const prevRefunds = prevOrders.reduce((s, o) => s + Number(o.totalRefunded || 0), 0);

  // Repeat rate (unique customers in month with 2+ orders this month)
  const curCustOrderCount: Record<string, number> = {};
  for (const o of currentOrders) if (o.customerId) curCustOrderCount[o.customerId] = (curCustOrderCount[o.customerId] || 0) + 1;
  const curUnique = Object.keys(curCustOrderCount).length;
  const curRepeat = Object.values(curCustOrderCount).filter((c) => c > 1).length;
  const curRepeatRate = curUnique > 0 ? (curRepeat / curUnique) * 100 : 0;

  const prevCustOrderCount: Record<string, number> = {};
  for (const o of prevOrders) if (o.customerId) prevCustOrderCount[o.customerId] = (prevCustOrderCount[o.customerId] || 0) + 1;
  const prevUnique = Object.keys(prevCustOrderCount).length;
  const prevRepeat = Object.values(prevCustOrderCount).filter((c) => c > 1).length;
  const prevRepeatRate = prevUnique > 0 ? (prevRepeat / prevUnique) * 100 : 0;

  // Gross margin
  const products = await db.product.findMany({
    where: { storeConnectionId: selectedStoreId },
    select: { externalId: true, costPerUnit: true, sku: true },
  });
  const costMap = new Map<string, number>();
  const skuMap = new Map<string, string>();
  for (const p of products) {
    if (p.costPerUnit) costMap.set(p.externalId, Number(p.costPerUnit));
    if (p.sku) skuMap.set(p.sku, p.externalId);
  }
  function computeCOGS(orders: typeof currentOrders): number {
    let cogs = 0;
    for (const o of orders) {
      if (!o.lineItems) continue;
      try {
        const items = JSON.parse(o.lineItems);
        for (const it of items) {
          let pid = String(it.product_id || it.productId || '');
          if (!pid && it.sku) pid = skuMap.get(String(it.sku)) || '';
          const cost = pid ? costMap.get(pid) || 0 : 0;
          cogs += cost * Number(it.quantity || 0);
        }
      } catch {}
    }
    return cogs;
  }
  const curCogs = computeCOGS(currentOrders);
  const prevCogs = computeCOGS(prevOrders);
  const curMargin = curRevenue > 0 ? ((curRevenue - curCogs) / curRevenue) * 100 : 0;
  const prevMargin = prevRevenue > 0 ? ((prevRevenue - prevCogs) / prevRevenue) * 100 : 0;

  const curRefundRate = curOrderCount > 0 ? (curRefunds / curRevenue) * 100 : 0;
  const prevRefundRate = prevOrderCount > 0 ? (prevRefunds / prevRevenue) * 100 : 0;

  function fmt(n: number, unit: string): string {
    if (unit === '%') return n.toFixed(1);
    return Math.round(n).toLocaleString('ro-RO');
  }

  function buildGoal(key: string, name: string, hint: string, cur: number, prev: number, unit: string, direction: GoalDirection): Goal {
    const growthFactor = direction === 'up' ? 1.1 : 0.9;
    const target = Math.max(0, prev * growthFactor);
    const expectedProgress = direction === 'up' ? target * monthProgress : Math.max(target, prev * 0.5);
    const pct = target > 0 ? Math.min(999, Math.max(0, (cur / target) * 100)) : 0;
    const pace = direction === 'up' ? (expectedProgress > 0 ? cur / expectedProgress : 0) : (cur <= target ? 1 : target / Math.max(cur, 0.01));
    let status: Goal['status'] = 'behind';
    let color = '#dc2626';
    if (pace >= 1.0) { status = 'ahead'; color = '#16a34a'; }
    else if (pace >= 0.85) { status = 'on-track'; color = '#16a34a'; }
    else if (pace >= 0.6) { status = 'at-risk'; color = '#d97706'; }

    return {
      key, name, hint,
      current: Math.round(cur * 100) / 100,
      currentDisplay: fmt(cur, unit),
      target: Math.round(target * 100) / 100,
      targetDisplay: fmt(target, unit),
      prev: Math.round(prev * 100) / 100,
      prevDisplay: fmt(prev, unit),
      unit, direction,
      pct: Math.round(pct * 10) / 10,
      status, color,
    };
  }

  const goals: Goal[] = [
    buildGoal('revenue', 'Venit', '+10% vs luna trecuta', curRevenue, prevRevenue, 'RON', 'up'),
    buildGoal('orders', 'Comenzi', '+10% vs luna trecuta', curOrderCount, prevOrderCount, '', 'up'),
    buildGoal('aov', 'AOV (Average Order Value)', '+10% vs luna trecuta', curAov, prevAov, 'RON', 'up'),
    buildGoal('newCustomers', 'Clienti noi', '+10% vs luna trecuta', currentCustomers, prevCustomers, '', 'up'),
    buildGoal('repeatRate', 'Rata repeat purchase', '+10% vs luna trecuta', curRepeatRate, prevRepeatRate || 5, '%', 'up'),
    buildGoal('margin', 'Marja bruta', '+10% vs luna trecuta', curMargin, prevMargin || 30, '%', 'up'),
    buildGoal('refundRate', 'Rata refund (scadere)', '-10% vs luna trecuta', curRefundRate, prevRefundRate || 2, '%', 'down'),
  ];

  return json({
    stores,
    goals,
    monthProgress: Math.round(monthProgress * 100),
    currentMonth: now.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' }),
    selectedStoreId,
  });
}

const STATUS_CFG: Record<string, { label: string; Icon: any; bg: string; fg: string }> = {
  ahead: { label: 'Inainte', Icon: Rocket, bg: '#dcfce7', fg: '#166534' },
  'on-track': { label: 'On Track', Icon: TrendingUp, bg: '#dcfce7', fg: '#166534' },
  'at-risk': { label: 'Risc', Icon: AlertCircle, bg: '#fef3c7', fg: '#92400e' },
  behind: { label: 'In urma', Icon: Zap, bg: '#fee2e2', fg: '#991b1b' },
};

export default function GoalsPage() {
  const { stores, goals, monthProgress, currentMonth, selectedStoreId } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
        <div>
          <h1 className="page-title">Goal Tracker</h1>
          <p className="page-subtitle">{currentMonth} · {monthProgress}% din luna trecut</p>
        </div>
        {stores.length > 1 && (
          <select className="form-input" style={{ width: 220 }} value={selectedStoreId || ''} onChange={(e) => setSearchParams({ store: e.target.value })}>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>

      <div className="info-box">
        <p>
          Targete auto-calculate: <strong>+10%</strong> vs luna precedenta pe fiecare KPI (-10% pentru refund rate). Bara gri = ritmul asteptat la ziua curenta. Daca bara colorata depaseste bara gri, esti pe drumul bun.
        </p>
      </div>

      {!goals || goals.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
          <Target size={48} style={{ color: 'var(--color-muted)', marginBottom: 12 }} />
          <p style={{ color: 'var(--color-muted)' }}>Conecteaza un magazin.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 'var(--space-md)' }}>
          {goals.map((g) => <GoalCard key={g.key} goal={g} monthProgress={monthProgress} />)}
        </div>
      )}
    </div>
  );
}

function GoalCard({ goal, monthProgress }: { goal: any; monthProgress: number }) {
  const cfg = STATUS_CFG[goal.status] || STATUS_CFG.behind;
  const displayPct = Math.min(100, goal.pct);

  return (
    <div className="card" style={{ borderLeft: `6px solid ${goal.color}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0a0a0a' }}>{goal.name}</div>
          <div style={{ fontSize: 11, color: '#525252', marginTop: 2 }}>{goal.hint}</div>
        </div>
        <span className="status-badge" style={{ background: cfg.bg, color: cfg.fg, borderColor: goal.color, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <cfg.Icon size={11} />
          {cfg.label}
        </span>
      </div>

      {/* Big current/target */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: 28, fontWeight: 800, color: '#0a0a0a', fontFamily: 'SF Mono, Monaco, monospace' }}>
          {goal.currentDisplay}{goal.unit === '%' ? '%' : ''}
        </div>
        {goal.unit && goal.unit !== '%' && <div style={{ fontSize: 13, color: '#525252', fontWeight: 500 }}>{goal.unit}</div>}
      </div>
      <div style={{ fontSize: 12, color: '#525252', marginBottom: 12, fontWeight: 500 }}>
        Target: <strong style={{ color: '#0a0a0a', fontFamily: 'SF Mono, monospace' }}>{goal.targetDisplay}{goal.unit === '%' ? '%' : goal.unit ? ' ' + goal.unit : ''}</strong>
        {' · '}Prev: {goal.prevDisplay}{goal.unit === '%' ? '%' : goal.unit ? ' ' + goal.unit : ''}
      </div>

      {/* Progress bar */}
      <div style={{ position: 'relative', height: 16, background: '#FAFAFA', border: '2px solid #0a0a0a', overflow: 'hidden', marginBottom: 6 }}>
        <div style={{ width: `${displayPct}%`, height: '100%', background: goal.color }} />
        {/* Month progress marker */}
        <div style={{ position: 'absolute', left: `${monthProgress}%`, top: -2, bottom: -2, width: 2, background: '#0a0a0a' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#525252', fontWeight: 500 }}>
        <span>{goal.pct}% din target</span>
        <span>{monthProgress}% din luna</span>
      </div>
    </div>
  );
}
