import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData, useSearchParams } from '@remix-run/react';
import { requireUser } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Period Comparison — Kimono BI' }];

type Period = { key: string; label: string; startCur: Date; endCur: Date; startPrev: Date; endPrev: Date };

function buildPeriods(now: Date): Period[] {
  const d = (n: number) => {
    const x = new Date(now); x.setDate(x.getDate() - n); return x;
  };
  const startOfDay = (x: Date) => { const y = new Date(x); y.setHours(0, 0, 0, 0); return y; };

  const week = {
    key: 'week',
    label: 'Saptamana',
    startCur: startOfDay(d(6)),
    endCur: now,
    startPrev: startOfDay(d(13)),
    endPrev: startOfDay(d(6)),
  };
  const month = {
    key: 'month',
    label: 'Luna',
    startCur: startOfDay(d(29)),
    endCur: now,
    startPrev: startOfDay(d(59)),
    endPrev: startOfDay(d(29)),
  };
  const quarter = {
    key: 'quarter',
    label: 'Trimestru',
    startCur: startOfDay(d(89)),
    endCur: now,
    startPrev: startOfDay(d(179)),
    endPrev: startOfDay(d(89)),
  };
  const year = {
    key: 'year',
    label: 'An (YoY)',
    startCur: startOfDay(d(364)),
    endCur: now,
    startPrev: startOfDay(d(729)),
    endPrev: startOfDay(d(364)),
  };
  return [week, month, quarter, year];
}

async function metricsForRange(storeId: string, start: Date, end: Date) {
  const [orders, newCustomers] = await Promise.all([
    db.order.findMany({
      where: { storeConnectionId: storeId, placedAt: { gte: start, lt: end } },
      select: { total: true, totalRefunded: true, customerId: true, discountTotal: true },
    }),
    db.customer.count({
      where: { storeConnectionId: storeId, firstOrderAt: { gte: start, lt: end } },
    }),
  ]);

  const revenue = orders.reduce((s, o) => s + Number(o.total), 0);
  const refunds = orders.reduce((s, o) => s + Number(o.totalRefunded || 0), 0);
  const discounts = orders.reduce((s, o) => s + Number(o.discountTotal || 0), 0);
  const netRevenue = revenue - refunds;
  const aov = orders.length > 0 ? revenue / orders.length : 0;
  const uniqueCustomers = new Set(orders.map((o) => o.customerId).filter(Boolean)).size;
  const repeatBuyers = orders.length - uniqueCustomers; // proxy for repeat orders

  return {
    revenue, netRevenue, refunds, discounts, aov,
    orders: orders.length, uniqueCustomers, newCustomers,
    repeatRate: uniqueCustomers > 0 ? (repeatBuyers / orders.length) * 100 : 0,
  };
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
  if (!selectedStoreId) return json({ stores, periods: null, selectedStoreId: null });

  const now = new Date();
  const periods = buildPeriods(now);

  const results = await Promise.all(
    periods.map(async (p) => {
      const [cur, prev] = await Promise.all([
        metricsForRange(selectedStoreId, p.startCur, p.endCur),
        metricsForRange(selectedStoreId, p.startPrev, p.endPrev),
      ]);
      return { period: p, cur, prev };
    })
  );

  return json({
    stores,
    selectedStoreId,
    data: results.map((r) => ({
      key: r.period.key,
      label: r.period.label,
      rangeCur: `${fmtD(r.period.startCur)} – ${fmtD(r.period.endCur)}`,
      rangePrev: `${fmtD(r.period.startPrev)} – ${fmtD(r.period.endPrev)}`,
      cur: r.cur,
      prev: r.prev,
    })),
  });
}

function fmtD(d: Date): string {
  return new Date(d).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: '2-digit' });
}

function delta(cur: number, prev: number): number {
  if (prev === 0) return cur > 0 ? 100 : 0;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

const METRIC_ROWS = [
  { key: 'revenue', label: 'Venit', unit: 'RON', positiveIsGood: true, fmt: (n: number) => Math.round(n).toLocaleString('ro-RO') },
  { key: 'netRevenue', label: 'Venit net (dupa refund)', unit: 'RON', positiveIsGood: true, fmt: (n: number) => Math.round(n).toLocaleString('ro-RO') },
  { key: 'orders', label: 'Comenzi', unit: '', positiveIsGood: true, fmt: (n: number) => n.toLocaleString('ro-RO') },
  { key: 'aov', label: 'AOV', unit: 'RON', positiveIsGood: true, fmt: (n: number) => Math.round(n).toLocaleString('ro-RO') },
  { key: 'newCustomers', label: 'Clienti noi', unit: '', positiveIsGood: true, fmt: (n: number) => n.toLocaleString('ro-RO') },
  { key: 'uniqueCustomers', label: 'Clienti unici', unit: '', positiveIsGood: true, fmt: (n: number) => n.toLocaleString('ro-RO') },
  { key: 'repeatRate', label: 'Rata repeat in comenzi', unit: '%', positiveIsGood: true, fmt: (n: number) => n.toFixed(1) },
  { key: 'discounts', label: 'Discount acordat', unit: 'RON', positiveIsGood: false, fmt: (n: number) => Math.round(n).toLocaleString('ro-RO') },
  { key: 'refunds', label: 'Refunduri', unit: 'RON', positiveIsGood: false, fmt: (n: number) => Math.round(n).toLocaleString('ro-RO') },
];

export default function ComparePage() {
  const { stores, data, selectedStoreId } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
        <div>
          <h1 className="page-title">Period Comparison</h1>
          <p className="page-subtitle">Saptamana · Luna · Trimestru · YoY, ca pe bursa</p>
        </div>
        {stores.length > 1 && (
          <select className="form-input" style={{ width: 220 }} value={selectedStoreId || ''} onChange={(e) => setSearchParams({ store: e.target.value })}>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>

      <div className="info-box">
        <p>
          Compara fiecare KPI pe 4 orizonturi simultan: ultimele 7 zile vs saptamana precedenta, 30 vs 30, 90 vs 90 si 365 vs 365 (YoY). Culoarea indica directie: verde = bine, rosu = rau (pozitia depinde de KPI — ex. refund mare = rosu chiar daca creste).
        </p>
      </div>

      {!data ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
          <p style={{ color: 'var(--color-muted)' }}>Conecteaza un magazin.</p>
        </div>
      ) : (
        <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
          <table style={{ width: '100%', minWidth: 900, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '14px 16px', fontSize: 11, background: '#0a0a0a', color: '#fff', letterSpacing: 1, textTransform: 'uppercase', fontWeight: 700, minWidth: 220 }}>Metric</th>
                {data.map((p) => (
                  <th key={p.key} style={{ padding: '14px 16px', fontSize: 11, background: '#0a0a0a', color: '#fff', letterSpacing: 1, textTransform: 'uppercase', fontWeight: 700, textAlign: 'center', minWidth: 170 }}>
                    <div>{p.label}</div>
                    <div style={{ fontSize: 9, opacity: 0.75, marginTop: 2, fontWeight: 500 }}>{p.rangeCur}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {METRIC_ROWS.map((m) => (
                <tr key={m.key} style={{ borderBottom: '2px solid #0a0a0a' }}>
                  <td style={{ padding: '14px 16px', fontWeight: 600, fontSize: 13, background: '#FAFAFA', borderRight: '2px solid #0a0a0a' }}>
                    <div>{m.label}</div>
                    {m.unit && <div className="mono-label" style={{ marginTop: 2 }}>{m.unit}</div>}
                  </td>
                  {data.map((p) => {
                    const cur = (p.cur as any)[m.key] as number;
                    const prev = (p.prev as any)[m.key] as number;
                    const d = delta(cur, prev);
                    const isGood = m.positiveIsGood ? d >= 0 : d <= 0;
                    const color = d === 0 ? '#525252' : isGood ? '#16a34a' : '#dc2626';
                    const bg = d === 0 ? 'transparent' : isGood ? '#dcfce7' : '#fee2e2';
                    const Icon = d > 0 ? TrendingUp : d < 0 ? TrendingDown : Minus;
                    return (
                      <td key={p.key} style={{ padding: '12px 16px', textAlign: 'center', borderRight: '2px solid #0a0a0a', background: bg }}>
                        <div style={{ fontFamily: 'SF Mono, Monaco, monospace', fontSize: 18, fontWeight: 800, color: '#0a0a0a', letterSpacing: -0.5 }}>
                          {m.fmt(cur)}
                        </div>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4, padding: '2px 8px', background: '#fff', border: '2px solid #0a0a0a', fontSize: 11, fontWeight: 700, color }}>
                          <Icon size={12} />
                          {d > 0 ? '+' : ''}{d}%
                        </div>
                        <div style={{ fontSize: 10, color: '#525252', marginTop: 4, fontWeight: 500 }}>prev: {m.fmt(prev)}</div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
