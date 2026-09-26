import { useState } from 'react';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData, useSearchParams } from '@remix-run/react';
import { requireUser, requireUserContext } from '~/lib/auth/requireAuth.server';
import { requireModule } from '~/lib/plans.server';
import { db } from '~/lib/db.server';
import { RotateCcw, Package, AlertTriangle, XCircle } from 'lucide-react';
import { TablePagination } from '~/components/TablePagination';

export const meta: MetaFunction = () => [{ title: 'Refunds & Anulari — Kimono BI' }];

const CANCEL_REASON_LABELS: Record<string, string> = {
  CUSTOMER: 'Cerere client',
  FRAUD: 'Fraudă suspectă',
  INVENTORY: 'Stoc indisponibil',
  DECLINED: 'Plată refuzată',
  OTHER: 'Alt motiv',
  STAFF: 'Anulată de staff',
};

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await requireUserContext(request);
  const user = ctx.user;
  await requireModule(request, ctx.effectiveOwnerId, 'refunds');
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');
  const days = Number(url.searchParams.get('days') || 90);

  const stores = await db.storeConnection.findMany({
    where: { userId: ctx.effectiveOwnerId },
    select: { id: true, name: true },
  });

  const selectedStoreId = storeId || stores[0]?.id;
  if (!selectedStoreId) return json({ stores, data: null, selectedStoreId: null, days });

  const since = new Date(); since.setDate(since.getDate() - days);

  const [ordersInPeriod, ordersWithRefund] = await Promise.all([
    db.order.count({ where: { storeConnectionId: selectedStoreId, placedAt: { gte: since } } }),
    db.order.findMany({
      where: { storeConnectionId: selectedStoreId, placedAt: { gte: since }, OR: [{ totalRefunded: { gt: 0 } }, { financialStatus: { in: ["REFUNDED", "PARTIALLY_REFUNDED"] } }] },
      select: { id: true, orderNumber: true, total: true, placedAt: true, returnsCount: true, returnItems: true, totalRefunded: true, currency: true, financialStatus: true, status: true },
      orderBy: { placedAt: 'desc' },
    }),
  ]);

  const refundRate = ordersInPeriod > 0 ? (ordersWithRefund.length / ordersInPeriod) * 100 : 0;

  // Aggregate
  const reasonCounts: Record<string, number> = {};
  let totalRefundAmount = 0;
  let realRefundCount = 0;
  let cancelledCount = 0;
  let itemsRefundedTotal = 0;
  const monthlyBuckets: Record<string, { count: number; amount: number }> = {};

  const enriched = ordersWithRefund.map((o) => {
    const totalRef = Number(o.totalRefunded || 0);
    totalRefundAmount += totalRef;
    if (totalRef > 0) realRefundCount++;

    let refunds: any[] = [];
    let cancelReason: string | null = null;
    let cancelledAt: string | null = null;
    try {
      if (o.returnItems) {
        const parsed = JSON.parse(o.returnItems);
        refunds = parsed.refunds || [];
        cancelReason = parsed.cancelReason || null;
        cancelledAt = parsed.cancelledAt || null;
      }
    } catch {}

    if (cancelReason) {
      cancelledCount++;
      reasonCounts[cancelReason] = (reasonCounts[cancelReason] || 0) + 1;
    }

    for (const r of refunds) {
      for (const it of (r.items || [])) {
        itemsRefundedTotal += Number(it.quantity || 0);
      }
    }

    const month = o.placedAt.toISOString().slice(0, 7);
    if (!monthlyBuckets[month]) monthlyBuckets[month] = { count: 0, amount: 0 };
    monthlyBuckets[month].count++;
    monthlyBuckets[month].amount += totalRef;

    return {
      id: o.id,
      orderNumber: o.orderNumber,
      placedAt: o.placedAt.toISOString(),
      total: Number(o.total),
      currency: o.currency,
      totalRefunded: totalRef,
      returnsCount: o.returnsCount,
      status: o.status,
      financialStatus: o.financialStatus,
      cancelReason,
      cancelledAt,
      refunds,
    };
  });

  const topReasons = Object.entries(reasonCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([r, c]) => ({ reason: r, count: c, label: CANCEL_REASON_LABELS[r] || r }));

  const monthlyTrend = Object.entries(monthlyBuckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([m, d]) => ({ month: m, count: d.count, amount: Math.round(d.amount) }));

  // ── Courier returns (SameDay) ───────────────────────────────────────────
  let courierReturns = { count: 0, codLost: 0, deliveredCount: 0, deliveryRate: 0, returnRate: 0, recentReturns: [] as any[] };
  try {
    const [crTotal, crDelivered, crReturned] = await Promise.all([
      db.courierTracking.count({ where: { storeConnectionId: selectedStoreId } }),
      db.courierTracking.count({ where: { storeConnectionId: selectedStoreId, isDelivered: true } }),
      db.courierTracking.count({ where: { storeConnectionId: selectedStoreId, isReturned: true } }),
    ]);
    const crCodLost = await db.courierTracking.aggregate({
      where: { storeConnectionId: selectedStoreId, isReturned: true, isCod: true },
      _sum: { codAmount: true },
    });
    const crRecent = await db.courierTracking.findMany({
      where: { storeConnectionId: selectedStoreId, isReturned: true },
      orderBy: { courierUpdatedAt: 'desc' },
      take: 10,
      select: { awb: true, orderNumber: true, codAmount: true, isCod: true, county: true, courierUpdatedAt: true, statusName: true },
    });
    const total = crDelivered + crReturned;
    courierReturns = {
      count: crReturned,
      codLost: crCodLost._sum.codAmount || 0,
      deliveredCount: crDelivered,
      deliveryRate: total > 0 ? Math.round((crDelivered / total) * 1000) / 10 : 0,
      returnRate: total > 0 ? Math.round((crReturned / total) * 1000) / 10 : 0,
      recentReturns: crRecent.map(r => ({ ...r, courierUpdatedAt: r.courierUpdatedAt?.toISOString() || null })),
    };
  } catch {}

  return json({
    stores, selectedStoreId, days,
    data: {
      ordersInPeriod,
      ordersWithRefund: ordersWithRefund.length,
      refundRate: Math.round(refundRate * 10) / 10,
      cancelledCount,
      realRefundCount,
      totalRefundAmount: Math.round(totalRefundAmount * 100) / 100,
      itemsRefundedTotal,
      topReasons,
      monthlyTrend,
      orders: enriched,
      courierReturns,
    },
  });
}

export default function RefundsPage() {
  const { stores, selectedStoreId, days, data } = useLoaderData<typeof loader>();
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
          <h1 className="page-title">Refunds & Anulări</h1>
          <p className="page-subtitle">Refund-uri reale + anulări din Shopify (cancel events)</p>
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
          Include <strong>refund-uri reale</strong> (bani returnați) și <strong>anulări</strong> (comenzi cancelled înainte/după plată). Pagina urmăreste modulul Refunds Shopify, nu modulul Returns (nu e folosit de magazin).
        </p>
      </div>

      {!data ? (
        <div className="card" style={{ textAlign: 'center', padding: '56px 24px' }}>
          <RotateCcw size={48} style={{ color: 'var(--color-muted)', marginBottom: 12 }} />
          <p style={{ color: 'var(--color-muted)' }}>Conecteaza un magazin.</p>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
            <Kpi label="Rata refund/anulare" value={`${data.refundRate}%`} sub={`${data.ordersWithRefund} / ${data.ordersInPeriod} comenzi`} color={data.refundRate >= 10 ? '#dc2626' : data.refundRate >= 5 ? '#d97706' : '#16a34a'} />
            <Kpi label="Refund-uri reale (bani)" value={String(data.realRefundCount)} sub={`${data.totalRefundAmount.toLocaleString('ro-RO')} RON returnat`} color="#dc2626" />
            <Kpi label="Anulări" value={String(data.cancelledCount)} sub="fara plata / pre-plata" color="#d97706" />
            <Kpi label="Articole returnate" value={String(data.itemsRefundedTotal)} sub="bucati (din refunds)" color="#0a0a0a" />
          </div>

          {data.ordersWithRefund === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '56px 24px' }}>
              <Package size={40} style={{ color: '#16a34a', marginBottom: 12 }} />
              <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Niciun refund în perioada selectată</h3>
              <p style={{ color: 'var(--color-muted)', fontSize: 13 }}>Magazinul nu a procesat refund-uri sau anulări.</p>
            </div>
          ) : (
            <>
              {data.topReasons.length > 0 && (
                <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Motive anulare</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {data.topReasons.map((r, i) => {
                      const max = Math.max(...data.topReasons.map((x) => x.count), 1);
                      const pct = (r.count / max) * 100;
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <span style={{ width: 180, fontSize: 13, fontWeight: 600 }}>{r.label}</span>
                          <div style={{ flex: 1, height: 22, background: 'var(--bg-tertiary)', border: '0.5px solid var(--border-default)', borderRadius: 4, position: 'relative' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--kimono-orange)' }} />
                          </div>
                          <span style={{ width: 60, fontSize: 13, fontWeight: 700, textAlign: 'right', fontFamily: 'inherit' }}>{r.count}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {data.monthlyTrend.length > 0 && (
                <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Trend lunar</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {data.monthlyTrend.map((m) => {
                      const max = Math.max(...data.monthlyTrend.map((x) => x.count), 1);
                      const pct = (m.count / max) * 100;
                      return (
                        <div key={m.month} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <span style={{ width: 80, fontSize: 12, fontFamily: 'inherit' }}>{m.month}</span>
                          <div style={{ flex: 1, height: 18, background: 'var(--bg-tertiary)', border: '0.5px solid var(--border-default)', borderRadius: 4, position: 'relative' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--warning-bg-strong)' }} />
                          </div>
                          <span style={{ width: 80, fontSize: 12, fontWeight: 700, textAlign: 'right', fontFamily: 'inherit' }}>{m.count} cmd</span>
                          <span style={{ width: 110, fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right', fontFamily: 'inherit' }}>{m.amount.toLocaleString('ro-RO')} RON</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
                <div style={{ padding: '14px 20px', borderBottom: '0.5px solid var(--border-default)' }}>
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Comenzi afectate ({data.ordersWithRefund})</h3>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
                  <thead>
                    <tr style={{ borderBottom: '0.5px solid var(--border-default)' }}>
                      {['Comanda', 'Data', 'Valoare', 'Refund', 'Status', 'Motiv'].map((h, i) => (
                        <th key={h} style={{ padding: '10px 14px', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textAlign: i >= 2 && i <= 3 ? 'right' : 'left', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.orders.slice(0, 100).map((o: any, i: number) => (
                      <tr key={o.id} style={{ borderBottom: i < Math.min(data.orders.length, 100) - 1 ? '0.5px solid var(--border-default)' : undefined }}>
                        <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{o.orderNumber || '-'}</td>
                        <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-secondary)' }}>{new Date(o.placedAt).toLocaleDateString('ro-RO')}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 13, fontWeight: 600 }}>{Math.round(o.total).toLocaleString('ro-RO')} {o.currency}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 13, fontWeight: 600, color: o.totalRefunded > 0 ? 'var(--danger-text)' : 'var(--text-tertiary)' }}>
                          {o.totalRefunded > 0 ? `-${Math.round(o.totalRefunded).toLocaleString('ro-RO')}` : '—'}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: o.financialStatus === 'REFUNDED' ? 'var(--danger-bg)' : o.financialStatus === 'PARTIALLY_REFUNDED' ? 'var(--warning-bg)' : 'var(--bg-tertiary)', color: o.financialStatus === 'REFUNDED' ? 'var(--danger-text)' : o.financialStatus === 'PARTIALLY_REFUNDED' ? 'var(--warning-text)' : 'var(--text-secondary)' }}>
                            {o.financialStatus === 'PARTIALLY_REFUNDED' ? 'Partial' : o.financialStatus === 'REFUNDED' ? 'Refunded' : (o.financialStatus || o.status || '?')}
                          </span>
                        </td>
                        <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-secondary)' }}>
                          {o.cancelReason ? (CANCEL_REASON_LABELS[o.cancelReason] || o.cancelReason) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.orders.length > 100 && (
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8, textAlign: 'center' }}>Se afișează primele 100 din {data.ordersWithRefund}.</p>
              )}
            </>
          )}
        </>
      )}

      {data && <CourierReturnsSection courierReturns={data.courierReturns} />}
    </div>
  );
}

function CourierReturnsSection({ courierReturns }: { courierReturns: any }) {
  if (!courierReturns || courierReturns.count === 0) return null;

  return (
    <div style={{ marginTop: 'var(--space-xl)' }}>
      <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 8 }}>
        Retururi Curier (SameDay)
      </h3>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
        <Kpi label="Colete returnate" value={String(courierReturns.count)} sub={`Rata retur: ${courierReturns.returnRate}%`} color="#ef4444" />
        <Kpi label="COD pierdut" value={`${Number(courierReturns.codLost).toLocaleString('ro-RO')} RON`} sub="comenzi refuzate la livrare" color="#dc2626" />
        <Kpi label="Colete livrate" value={String(courierReturns.deliveredCount)} sub={`Rata livrare: ${courierReturns.deliveryRate}%`} color="#22c55e" />
      </div>

      {courierReturns.recentReturns.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>Ultimele retururi curier</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 500 }}>
            <thead>
              <tr>
                {['AWB', 'Comanda', 'Status', 'COD', 'Judet', 'Data'].map(h => (
                  <th key={h} style={{ textAlign: h === 'COD' ? 'right' : 'left', padding: '8px 12px', fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, borderBottom: '0.5px solid var(--border-default)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {courierReturns.recentReturns.map((r: any) => (
                <tr key={r.awb} style={{ borderBottom: '0.5px solid var(--border-default)' }}>
                  <td style={{ padding: '8px 12px', fontSize: 12 }}><code style={{ fontSize: 11 }}>{r.awb}</code></td>
                  <td style={{ padding: '8px 12px', fontSize: 12 }}>{r.orderNumber || '-'}</td>
                  <td style={{ padding: '8px 12px' }}><span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: 'rgba(239,68,68,0.1)', color: '#dc2626' }}>{r.statusName}</span></td>
                  <td style={{ padding: '8px 12px', fontSize: 12, textAlign: 'right', fontWeight: 600 }}>{r.isCod ? `${Number(r.codAmount || 0).toLocaleString('ro-RO')} RON` : '-'}</td>
                  <td style={{ padding: '8px 12px', fontSize: 12 }}>{r.county || '-'}</td>
                  <td style={{ padding: '8px 12px', fontSize: 12 }}>{r.courierUpdatedAt ? new Date(r.courierUpdatedAt).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short' }) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="card" style={{ borderLeft: `3px solid ${color}`, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color, letterSpacing: '-0.5px' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}
