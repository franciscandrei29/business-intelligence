import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData, useSearchParams } from '@remix-run/react';
import { useState, useMemo } from 'react';
import { requireUser, requireUserContext } from '~/lib/auth/requireAuth.server';
import { requireModule } from '~/lib/plans.server';
import { db } from '~/lib/db.server';
import { calculateContributionMargin } from '~/lib/margin/index';
import { Receipt, AlertTriangle, TrendingDown, TrendingUp } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Contribution Margin — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await requireUserContext(request);
  const user = ctx.user;
  await requireModule(request, ctx.effectiveOwnerId, 'margin');
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');
  const days = Number(url.searchParams.get('days') || 30);

  const stores = await db.storeConnection.findMany({
    where: { userId: ctx.effectiveOwnerId },
    select: { id: true, name: true },
  });

  const selectedStoreId = storeId || stores[0]?.id;
  if (!selectedStoreId) return json({ stores, margin: null, selectedStoreId: null, days });

  const margin = await calculateContributionMargin(selectedStoreId, days);
  return json({ stores, margin, selectedStoreId, days });
}

type SortKey = 'marginAsc' | 'marginDesc' | 'marginPctAsc' | 'marginPctDesc' | 'revenueDesc' | 'dateDesc';
type FilterKey = 'all' | 'negative' | 'low' | 'healthy';

export default function MarginPage() {
  const { stores, margin, selectedStoreId, days } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [perPage, setPerPage] = useState(25);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<SortKey>('marginAsc');
  const [filter, setFilter] = useState<FilterKey>('all');

  const filteredOrders = useMemo(() => {
    if (!margin) return [];
    let list = [...margin.allOrders];
    if (filter === 'negative') list = list.filter((o) => o.contributionMargin < 0);
    else if (filter === 'low') list = list.filter((o) => o.marginPercent < 15);
    else if (filter === 'healthy') list = list.filter((o) => o.marginPercent >= 40);

    list.sort((a, b) => {
      switch (sort) {
        case 'marginAsc': return a.contributionMargin - b.contributionMargin;
        case 'marginDesc': return b.contributionMargin - a.contributionMargin;
        case 'marginPctAsc': return a.marginPercent - b.marginPercent;
        case 'marginPctDesc': return b.marginPercent - a.marginPercent;
        case 'revenueDesc': return b.revenue - a.revenue;
        case 'dateDesc': return new Date(b.date as any).getTime() - new Date(a.date as any).getTime();
      }
    });
    return list.slice(0, 200);
  }, [margin, filter, sort]);

  const setDays = (d: number) => {
    const p = new URLSearchParams(searchParams);
    p.set('days', String(d));
    setSearchParams(p);
  };

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
        <div>
          <h1 className="page-title">Contribution Margin</h1>
          <p className="page-subtitle">Profit real per comanda (venit - COGS - shipping - discount - refund)</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select className="form-input" style={{ width: 140 }} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>Ultima saptamana</option>
            <option value={30}>Ultimele 30 zile</option>
            <option value={60}>Ultimele 60 zile</option>
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
          Contribution Margin = Venit - COGS - Shipping - Discount - Refund. <strong>Sub 0 = pierdere</strong> — vinzi pe minus. Sub 15% = marja prea mica, atentie. Peste 40% = sanatos.
          {margin && margin.coverage.costCoveragePct < 70 && (
            <span style={{ display: 'block', marginTop: 6, color: 'var(--danger-text)', fontWeight: 600 }}>
              Acoperire costuri: doar {margin.coverage.costCoveragePct}% din produse au cost setat ({margin.coverage.productsWithCost}/{margin.coverage.productsTotal}). Marja calculata este sub-estimare.
            </span>
          )}
        </p>
      </div>

      {!margin ? (
        <div className="card" style={{ textAlign: 'center', padding: '56px 24px' }}>
          <Receipt size={48} style={{ color: 'var(--color-muted)', marginBottom: 12 }} />
          <p style={{ color: 'var(--color-muted)' }}>Conecteaza un magazin pentru a vedea marja.</p>
        </div>
      ) : (
        <>
          {/* Red-flag KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
            <BigKpi label="Marja medie" value={`${margin.avgMarginPercent.toFixed(1)}%`} color={margin.avgMarginPercent >= 40 ? '#16a34a' : margin.avgMarginPercent >= 20 ? '#d97706' : '#dc2626'} />
            <BigKpi label="Marja totala" value={`${Math.round(margin.totalContributionMargin).toLocaleString('ro-RO')} RON`} color="#0a0a0a" />
            <BigKpi label="Comenzi pe minus" value={String(margin.negativeOrdersCount)} sub={`${Math.round(margin.negativeOrdersLoss).toLocaleString('ro-RO')} RON pierdere`} color="#dc2626" />
            <BigKpi label="Marja sub 15%" value={String(margin.lowMarginCount)} sub={`din ${margin.ordersAnalyzed} comenzi`} color="#d97706" />
          </div>

          {/* Breakdown */}
          <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Defalcare venit → marja</h3>
            <Waterfall margin={margin} />
          </div>

          {/* Filter controls */}
          <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Filtru</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {[
                    { key: 'all', label: 'Toate', count: margin.ordersAnalyzed },
                    { key: 'negative', label: 'Pe minus', count: margin.negativeOrdersCount },
                    { key: 'low', label: 'Sub 15%', count: margin.lowMarginCount },
                    { key: 'healthy', label: 'Sanatoase 40%+', count: margin.allOrders.filter((o) => o.marginPercent >= 40).length },
                  ].map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => setFilter(opt.key as FilterKey)}
                      className="btn btn-secondary"
                      style={{ background: filter === opt.key ? 'rgba(216,90,48,0.08)' : 'white', color: filter === opt.key ? 'var(--kimono-orange)' : 'var(--text-secondary)', border: filter === opt.key ? '1.5px solid var(--kimono-orange)' : '1px solid var(--border-default)', fontSize: 12, padding: '6px 12px', borderRadius: 8 }}
                    >
                      {opt.label} ({opt.count})
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Sortare</div>
                <select className="form-input" style={{ width: 240 }} value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                  <option value="marginAsc">Marja (cea mai mica intai)</option>
                  <option value="marginDesc">Marja (cea mai mare intai)</option>
                  <option value="marginPctAsc">Marja % (cea mai mica intai)</option>
                  <option value="marginPctDesc">Marja % (cea mai mare intai)</option>
                  <option value="revenueDesc">Venit descrescator</option>
                  <option value="dateDesc">Data (recent intai)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Orders table */}
          <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
            <table style={{ width: '100%', minWidth: 900 }}>
              <thead>
                <tr style={{ borderBottom: '0.5px solid var(--border-default)' }}>
                  {['Comandă', 'Data', 'Venit', 'COGS', 'Shipping', 'Discount', 'Refund', 'Marja', 'Marja %'].map((h, i) => (
                    <th key={h} style={{ padding: '10px 14px', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textAlign: i >= 2 ? 'right' : 'left', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredOrders.slice(page * perPage, (page + 1) * perPage).map((o) => {
                  const isNeg = o.contributionMargin < 0;
                  const isLow = o.marginPercent < 15 && !isNeg;
                  const color = isNeg ? '#dc2626' : isLow ? '#d97706' : '#16a34a';
                  return (
                    <tr key={o.orderId} style={{ borderBottom: '0.5px solid var(--border-default)' }}>
                      <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{o.orderNumber || o.orderId.slice(0, 8)}</td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{new Date(o.date as any).toLocaleDateString('ro-RO')}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>{Math.round(o.revenue).toLocaleString('ro-RO')}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{Math.round(o.cogs).toLocaleString('ro-RO')}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{Math.round(o.shipping).toLocaleString('ro-RO')}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 13, whiteSpace: 'nowrap', color: o.discounts > 0 ? 'var(--warning-text)' : 'var(--text-tertiary)' }}>{Math.round(o.discounts).toLocaleString('ro-RO')}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 13, whiteSpace: 'nowrap', color: o.refunds > 0 ? 'var(--danger-text)' : 'var(--text-tertiary)' }}>{Math.round(o.refunds).toLocaleString('ro-RO')}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', color, borderRadius: isNeg ? 4 : 0, background: isNeg ? 'var(--danger-bg)' : 'transparent' }}>{Math.round(o.contributionMargin).toLocaleString('ro-RO')}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', color, borderRadius: isNeg ? 4 : 0, background: isNeg ? 'var(--danger-bg)' : 'transparent' }}>{o.marginPercent.toFixed(1)}%</td>
                    </tr>
                  );
                })}
                {filteredOrders.length === 0 && (
                  <tr><td colSpan={9} style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)' }}>Nicio comanda pentru filtrul selectat.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {filteredOrders.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Per pagină:</span>
                {[25, 50, 100].map(n => (
                  <button key={n} onClick={() => { setPerPage(n); setPage(0); }}
                    style={{ padding: '4px 10px', borderRadius: 6, border: perPage === n ? '1.5px solid var(--kimono-orange)' : '1px solid var(--border-default)', background: perPage === n ? 'rgba(216,90,48,0.08)' : 'white', color: perPage === n ? 'var(--kimono-orange)' : 'var(--text-secondary)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                    {n}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{page * perPage + 1}-{Math.min((page + 1) * perPage, filteredOrders.length)} din {filteredOrders.length}</span>
                <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
                  style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'white', fontSize: 11, cursor: page === 0 ? 'not-allowed' : 'pointer', opacity: page === 0 ? 0.4 : 1 }}>
                  ←
                </button>
                <button onClick={() => setPage(Math.min(Math.ceil(filteredOrders.length / perPage) - 1, page + 1))} disabled={(page + 1) * perPage >= filteredOrders.length}
                  style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'white', fontSize: 11, cursor: (page + 1) * perPage >= filteredOrders.length ? 'not-allowed' : 'pointer', opacity: (page + 1) * perPage >= filteredOrders.length ? 0.4 : 1 }}>
                  →
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BigKpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="card" style={{ borderLeft: `3px solid ${color}`, padding: '14px 16px' }}>
      <div className="mono-label">{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color, fontFamily: 'SF Mono, Monaco, monospace', marginTop: 4, letterSpacing: -0.5 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, fontWeight: 500 }}>{sub}</div>}
    </div>
  );
}

function Waterfall({ margin }: { margin: any }) {
  const steps = [
    { label: 'Venit', value: margin.totalRevenue, type: 'positive' as const },
    { label: 'COGS', value: -margin.totalCOGS, type: 'negative' as const },
    { label: 'Shipping', value: -margin.totalShipping, type: 'negative' as const },
    { label: 'Discount', value: -margin.totalDiscounts, type: 'negative' as const },
    { label: 'Refund', value: -margin.totalRefunds, type: 'negative' as const },
    { label: 'Marja', value: margin.totalContributionMargin, type: 'total' as const },
  ];
  const max = Math.max(...steps.map((s) => Math.abs(s.value)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {steps.map((s, i) => {
        const pct = max > 0 ? (Math.abs(s.value) / max) * 100 : 0;
        const color = s.type === 'positive' ? '#0a0a0a' : s.type === 'negative' ? '#dc2626' : '#FF5A1F';
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 110, fontSize: 13, fontWeight: 600 }}>{s.label}</span>
            <div style={{ flex: 1, height: 26, background: '#FAFAFA', border: '0.5px solid var(--border-default)', borderRadius: 8, position: 'relative' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: color }} />
            </div>
            <span style={{ width: 160, fontSize: 14, fontWeight: 700, textAlign: 'right', fontFamily: 'inherit', color }}>
              {s.value >= 0 ? '' : '-'}{Math.abs(Math.round(s.value)).toLocaleString('ro-RO')} RON
            </span>
          </div>
        );
      })}
    </div>
  );
}
