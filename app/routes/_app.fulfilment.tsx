import { useState } from 'react';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData, useSearchParams } from '@remix-run/react';
import { requireUser, requireUserContext } from '~/lib/auth/requireAuth.server';
import { requireModule } from '~/lib/plans.server';
import { db } from '~/lib/db.server';
import { computeFulfilmentMetrics } from '~/lib/fulfilment/index';
import { Clock, AlertTriangle, CheckCircle2, Truck } from 'lucide-react';
import { TablePagination } from '~/components/TablePagination';

export const meta: MetaFunction = () => [{ title: 'Time to Fulfilment — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await requireUserContext(request);
  const user = ctx.user;
  await requireModule(request, ctx.effectiveOwnerId, 'fulfilment');
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');
  const days = Number(url.searchParams.get('days') || 30);

  const stores = await db.storeConnection.findMany({
    where: { userId: ctx.effectiveOwnerId },
    select: { id: true, name: true },
  });

  const selectedStoreId = storeId || stores[0]?.id;
  if (!selectedStoreId) return json({ stores, metrics: null, selectedStoreId: null, days });

  const metrics = await computeFulfilmentMetrics(selectedStoreId, days);
  return json({ stores, metrics, selectedStoreId, days });
}

function fmtHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 8) return `${h.toFixed(1)} h`;
  const days = h / 8;
  return `${days.toFixed(1)} zile lucr.`;
}

export default function FulfilmentPage() {
  const { stores, metrics, selectedStoreId, days } = useLoaderData<typeof loader>();
  const [tblPerPage, setTblPerPage] = useState(25);
  const [tblPage, setTblPage] = useState(0);
  const [searchParams, setSearchParams] = useSearchParams();

  const setDays = (d: number) => {
    const p = new URLSearchParams(searchParams);
    p.set('days', String(d));
    setSearchParams(p);
  };

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
        <div>
          <h1 className="page-title">Time to Fulfilment</h1>
          <p className="page-subtitle">Timp livrare in ore de business · L-V 09:00-17:00</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select className="form-input" style={{ width: 140 }} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>Ultimele 7 zile</option>
            <option value={30}>Ultimele 30 zile</option>
            <option value={90}>Ultimele 90 zile</option>
          </select>
          {stores.length > 1 && (
            <select className="form-input" style={{ width: 220 }} value={selectedStoreId || ''} onChange={(e) => {
              const p = new URLSearchParams(searchParams); p.set('store', e.target.value); setSearchParams(p);
            }}>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
        </div>
      </div>

      <div className="info-box">
        <p>
          Metricile masoara <strong>ore de business</strong>, nu ore calendaristice. O comanda plasata vineri 16:00 si livrata luni 10:00 numara ~3 ore de business (1 ora vineri + 1 ora luni + 0 in weekend). Sub 8 ore = livrata intr-o zi lucratoare.
        </p>
      </div>

      {!metrics ? (
        <div className="card" style={{ textAlign: 'center', padding: '56px 24px' }}>
          <Clock size={48} style={{ color: 'var(--color-muted)', marginBottom: 12 }} />
          <p style={{ color: 'var(--color-muted)' }}>Conecteaza un magazin.</p>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
            <Kpi label="Timp mediu" value={fmtHours(metrics.avgBusinessHours)} Icon={Clock} color="#0a0a0a" />
            <Kpi label="Median" value={fmtHours(metrics.medianBusinessHours)} Icon={Clock} color="#525252" />
            <Kpi label="P90" value={fmtHours(metrics.p90BusinessHours)} Icon={AlertTriangle} color="#d97706" sub="90% livrate in maxim" />
            <Kpi label="Sub 1 zi lucr." value={`${metrics.pctUnderBusinessDay}%`} Icon={CheckCircle2} color="#16a34a" sub={`${metrics.fulfilled} livrate total`} />
            <Kpi label="Sub 2 zile lucr." value={`${metrics.pctUnderTwoBusinessDays}%`} Icon={CheckCircle2} color="#16a34a" />
            <Kpi label="In asteptare" value={String(metrics.unfulfilled)} Icon={Truck} color={metrics.pendingOverdue > 0 ? '#dc2626' : '#525252'} sub={metrics.pendingOverdue > 0 ? `${metrics.pendingOverdue} intarziate 8h+` : 'in grafic'} />
          </div>

          {/* By DoW */}
          <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Timp mediu dupa ziua plasarii</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {metrics.byDayOfWeek.map((d) => {
                const pct = metrics.avgBusinessHours > 0 ? (d.avgHours / Math.max(...metrics.byDayOfWeek.map((x) => x.avgHours), 1)) * 100 : 0;
                const isSlow = d.avgHours > metrics.avgBusinessHours * 1.5;
                return (
                  <div key={d.dow} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ width: 90, fontSize: 13, fontWeight: 600 }}>{d.dow}</span>
                    <div style={{ flex: 1, height: 22, background: 'var(--bg-tertiary)', border: '0.5px solid var(--border-default)', borderRadius: 4, position: 'relative' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: isSlow ? '#dc2626' : '#FF5A1F' }} />
                    </div>
                    <span style={{ width: 120, fontSize: 12, fontWeight: 700, textAlign: 'right', fontFamily: 'inherit' }}>
                      {d.count > 0 ? fmtHours(d.avgHours) : '—'}
                    </span>
                    <span style={{ width: 60, fontSize: 11, color: 'var(--text-secondary)', textAlign: 'right' }}>
                      {d.count} cmd
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tables side by side */}
          <div style={{ display: 'grid', gridTemplateColumns: metrics.oldestUnfulfilled.length > 0 && metrics.slowestOrders.length > 0 ? '1fr 1fr' : '1fr', gap: 16 }}>

          {/* Pending alerts */}
          {metrics.oldestUnfulfilled.length > 0 && (
            <div className="card" style={{ borderLeft: '3px solid #dc2626' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <AlertTriangle size={14} color="var(--danger-text)" />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--danger-text)' }}>În așteptare</span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '0.5px solid var(--border-default)' }}>
                    {['Comandă', 'Plasată', 'Durată'].map((h, i) => (
                      <th key={h} style={{ padding: '8px 10px', fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)', textAlign: i === 2 ? 'right' : 'left', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {metrics.oldestUnfulfilled.map((o, i) => (
                    <tr key={i} style={{ borderBottom: '0.5px solid var(--border-default)' }}>
                      <td style={{ padding: '6px 10px', fontSize: 12, fontWeight: 500 }}>{o.orderNumber || '-'}</td>
                      <td style={{ padding: '6px 10px', fontSize: 11, color: 'var(--text-secondary)' }}>{new Date(o.placedAt).toLocaleDateString('ro-RO')}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, fontSize: 12, color: o.businessHoursPending > 8 ? 'var(--danger-text)' : 'var(--text-primary)' }}>
                        {fmtHours(o.businessHoursPending)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Slowest fulfilled */}
          {metrics.slowestOrders.length > 0 && (
            <div className="card" style={{ borderLeft: '3px solid #d97706' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Clock size={14} color="var(--warning-text)" />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Cele mai lente livrări</span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '0.5px solid var(--border-default)' }}>
                    {['Comandă', 'Plasată', 'Livrată', 'Durată'].map((h, i) => (
                      <th key={h} style={{ padding: '8px 10px', fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)', textAlign: i === 3 ? 'right' : 'left', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {metrics.slowestOrders.map((o, i) => (
                    <tr key={i}>
                      <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{o.orderNumber || '-'}</td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{new Date(o.placedAt).toLocaleDateString('ro-RO')}</td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{new Date(o.fulfilledAt).toLocaleDateString('ro-RO')}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' }}>{fmtHours(o.businessHours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, Icon, color, sub }: { label: string; value: string; Icon: any; color: string; sub?: string }) {
  return (
    <div className="card" style={{ borderLeft: `3px solid ${color}`, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <Icon size={14} style={{ color }} />
        <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>{label}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: 'inherit' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, fontWeight: 500 }}>{sub}</div>}
    </div>
  );
}
