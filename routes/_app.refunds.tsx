import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData, useSearchParams } from '@remix-run/react';
import { requireUser } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import { RotateCcw, Package, AlertTriangle } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Returns — Kimono BI' }];

const REASON_LABELS: Record<string, string> = {
  SIZE_TOO_SMALL: 'Prea mic',
  SIZE_TOO_LARGE: 'Prea mare',
  UNWANTED: 'Nedorit',
  NOT_AS_DESCRIBED: 'Diferit de descriere',
  WRONG_ITEM: 'Articol gresit',
  DEFECTIVE: 'Defect',
  STYLE: 'Nu-mi place stilul',
  COLOR: 'Culoare',
  OTHER: 'Alt motiv',
  CUSTOMER: 'Cerere client',
  NOT_YET_RETURNED: 'In asteptare',
};

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  REQUESTED: { label: 'Cerut', color: '#92400e', bg: '#fef3c7' },
  OPEN: { label: 'Deschis', color: '#1e40af', bg: '#dbeafe' },
  CLOSED: { label: 'Inchis', color: '#166534', bg: '#dcfce7' },
  DECLINED: { label: 'Refuzat', color: '#991b1b', bg: '#fee2e2' },
  CANCELED: { label: 'Anulat', color: '#525252', bg: '#f1f5f9' },
};

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');
  const days = Number(url.searchParams.get('days') || 90);

  const stores = await db.storeConnection.findMany({
    where: { userId: user.id },
    select: { id: true, name: true },
  });

  const selectedStoreId = storeId || stores[0]?.id;
  if (!selectedStoreId) return json({ stores, data: null, selectedStoreId: null, days });

  const since = new Date(); since.setDate(since.getDate() - days);

  const [ordersInPeriod, ordersWithReturns] = await Promise.all([
    db.order.count({ where: { storeConnectionId: selectedStoreId, placedAt: { gte: since } } }),
    db.order.findMany({
      where: { storeConnectionId: selectedStoreId, placedAt: { gte: since }, returnsCount: { gt: 0 } },
      select: { id: true, orderNumber: true, total: true, placedAt: true, returnsCount: true, returnItems: true, totalRefunded: true, currency: true },
      orderBy: { placedAt: 'desc' },
    }),
  ]);

  // Aggregate stats
  const returnRate = ordersInPeriod > 0 ? (ordersWithReturns.length / ordersInPeriod) * 100 : 0;
  const reasonCounts: Record<string, number> = {};
  const statusCounts: Record<string, number> = {};
  let totalItemsReturned = 0;
  let totalReturnEvents = 0;

  const enriched = ordersWithReturns.map((o) => {
    let items: any[] = [];
    try { items = o.returnItems ? JSON.parse(o.returnItems) : []; } catch {}
    for (const r of items) {
      totalReturnEvents++;
      statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
      for (const li of (r.lineItems || [])) {
        totalItemsReturned += Number(li.quantity || 0);
        const reason = li.reason || 'OTHER';
        reasonCounts[reason] = (reasonCounts[reason] || 0) + Number(li.quantity || 0);
      }
    }
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      placedAt: o.placedAt.toISOString(),
      total: Number(o.total),
      currency: o.currency,
      returnsCount: o.returnsCount,
      returns: items,
    };
  });

  const topReasons = Object.entries(reasonCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([reason, qty]) => ({ reason, qty, label: REASON_LABELS[reason] || reason }));

  // Monthly trend
  const monthly: Record<string, { orders: number; returns: number }> = {};
  for (let i = 0; i < 12; i++) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    monthly[d.toISOString().slice(0, 7)] = { orders: 0, returns: 0 };
  }
  // We can't easily aggregate orders by month without another query; skip for now.

  return json({
    stores, selectedStoreId, days,
    data: {
      ordersInPeriod,
      ordersWithReturns: ordersWithReturns.length,
      returnRate: Math.round(returnRate * 10) / 10,
      totalItemsReturned,
      totalReturnEvents,
      topReasons,
      statusCounts,
      orders: enriched,
    },
  });
}

export default function RefundsPage() {
  const { stores, selectedStoreId, days, data } = useLoaderData<typeof loader>();
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
          <h1 className="page-title">Returns</h1>
          <p className="page-subtitle">Retururi de produse cu motiv si status (Shopify Returns module)</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select className="form-input" style={{ width: 140 }} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={30}>Ultimele 30 zile</option>
            <option value={90}>Ultimele 90 zile</option>
            <option value={180}>Ultimele 180 zile</option>
            <option value={365}>Ultimele 365 zile</option>
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
          Datele vin din modulul <strong>Returns</strong> al Shopify (nu din refunds manuale). Vezi motiv, cantitate si status pentru fiecare retur. Daca vezi 0 retururi, ruleaza backfill-ul sau magazinul nu foloseste modulul Returns.
        </p>
      </div>

      {!data ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
          <RotateCcw size={48} style={{ color: 'var(--color-muted)', marginBottom: 12 }} />
          <p style={{ color: 'var(--color-muted)' }}>Conecteaza un magazin.</p>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
            <Kpi label="Rata retur" value={`${data.returnRate}%`} sub={`${data.ordersWithReturns} / ${data.ordersInPeriod} comenzi`} color={data.returnRate >= 10 ? '#dc2626' : data.returnRate >= 5 ? '#d97706' : '#16a34a'} />
            <Kpi label="Retururi totale" value={String(data.totalReturnEvents)} sub="evenimente de retur" color="#0a0a0a" />
            <Kpi label="Articole returnate" value={String(data.totalItemsReturned)} sub="bucati" color="#0a0a0a" />
            <Kpi label="Comenzi cu retur" value={String(data.ordersWithReturns)} sub={`din ${data.ordersInPeriod} total`} color="#d97706" />
          </div>

          {data.ordersWithReturns === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
              <Package size={40} style={{ color: '#16a34a', marginBottom: 12 }} />
              <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Niciun retur in perioada selectata</h3>
              <p style={{ color: 'var(--color-muted)', fontSize: 13 }}>
                Daca folosesti modulul Returns din Shopify si nu apar date, ruleaza <code style={{ background: '#FAFAFA', border: '2px solid #0a0a0a', padding: '2px 6px', fontFamily: 'SF Mono, monospace' }}>node scripts/backfill-returns.mjs</code>
              </p>
            </div>
          ) : (
            <>
              {/* Top reasons */}
              {data.topReasons.length > 0 && (
                <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Top motive de retur</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {data.topReasons.slice(0, 10).map((r, i) => {
                      const max = Math.max(...data.topReasons.map((x) => x.qty), 1);
                      const pct = (r.qty / max) * 100;
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <span style={{ width: 220, fontSize: 13, fontWeight: 600 }}>{r.label}</span>
                          <div style={{ flex: 1, height: 22, background: '#FAFAFA', border: '2px solid #0a0a0a', position: 'relative' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: '#FF5A1F' }} />
                          </div>
                          <span style={{ width: 60, fontSize: 13, fontWeight: 700, textAlign: 'right', fontFamily: 'SF Mono, monospace' }}>{r.qty}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Status breakdown */}
              {Object.keys(data.statusCounts).length > 0 && (
                <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Status retururi</h3>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {Object.entries(data.statusCounts).map(([status, count]) => {
                      const cfg = STATUS_LABELS[status] || { label: status, color: '#0a0a0a', bg: '#FAFAFA' };
                      return (
                        <div key={status} style={{ padding: '8px 16px', background: cfg.bg, border: `2px solid ${cfg.color}`, color: cfg.color, fontWeight: 700, fontSize: 13 }}>
                          {cfg.label}: {count}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Orders list */}
              <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
                <div style={{ padding: 16, borderBottom: '2px solid #0a0a0a' }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700 }}>Comenzi cu retur ({data.ordersWithReturns})</h3>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>Comanda</th>
                      <th>Data</th>
                      <th style={{ textAlign: 'right' }}>Valoare</th>
                      <th style={{ textAlign: 'right' }}>Nr retururi</th>
                      <th>Detalii</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.orders.slice(0, 100).map((o) => (
                      <tr key={o.id}>
                        <td style={{ fontFamily: 'SF Mono, monospace', fontWeight: 700 }}>#{o.orderNumber || '?'}</td>
                        <td style={{ fontSize: 12, color: '#525252' }}>{new Date(o.placedAt).toLocaleDateString('ro-RO')}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'SF Mono, monospace' }}>{Math.round(o.total).toLocaleString('ro-RO')} {o.currency}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{o.returnsCount}</td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {o.returns.map((r: any, i: number) => {
                              const cfg = STATUS_LABELS[r.status] || { label: r.status, color: '#0a0a0a', bg: '#FAFAFA' };
                              return (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                                  <span style={{ padding: '1px 6px', background: cfg.bg, color: cfg.color, fontWeight: 700, fontSize: 10, border: `1px solid ${cfg.color}` }}>{cfg.label}</span>
                                  <span>{r.totalQuantity} buc</span>
                                  <span style={{ color: '#525252' }}>
                                    {(r.lineItems || []).slice(0, 3).map((li: any) => REASON_LABELS[li.reason] || li.reason).filter(Boolean).join(', ')}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {data.orders.length > 100 && (
                <p style={{ fontSize: 12, color: '#525252', marginTop: 8, textAlign: 'center' }}>Se afiseaza primele 100 din {data.ordersWithReturns} comenzi cu retur.</p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="card" style={{ borderLeft: `6px solid ${color}` }}>
      <div className="mono-label">{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color, fontFamily: 'SF Mono, monospace', marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#525252', marginTop: 4, fontWeight: 500 }}>{sub}</div>}
    </div>
  );
}
