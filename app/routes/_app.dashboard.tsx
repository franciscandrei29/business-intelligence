import { useState } from 'react';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { Form, Link, useLoaderData, useSearchParams } from '@remix-run/react';
import { requireUser, requireUserContext } from '~/lib/auth/requireAuth.server';
import { requireModule } from '~/lib/plans.server';
import { db } from '~/lib/db.server';
import { calculateScaleReadiness } from '~/lib/scale/index';
import { getAnnotations } from '~/lib/annotations';
import { formatCurrency, formatNumber, formatDate } from '~/lib/utils';
import { TrendingUp, TrendingDown, AlertTriangle, ShoppingCart, Zap, ArrowRight, Bot, CheckCircle2 } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Today — Kimono BI' }];

function getDateRange(date: Date) {
  const roDate = date.toLocaleDateString('en-CA', { timeZone: 'Europe/Bucharest' });
  const start = new Date(roDate + 'T00:00:00+03:00');
  const end = new Date(roDate + 'T23:59:59.999+03:00');
  return { start, end };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await requireUserContext(request);
  const user = ctx.user;
  await requireModule(request, ctx.effectiveOwnerId, 'dashboard');
  const url = new URL(request.url);
  const storeIdParam = url.searchParams.get('store');

  const stores = await db.storeConnection.findMany({
    where: { userId: ctx.effectiveOwnerId },
    select: { id: true, name: true, platform: true, lastSyncAt: true, syncStatus: true },
    orderBy: { createdAt: 'asc' },
  });

  if (stores.length === 0) return redirect('/onboarding');

  const store = stores.find((s) => s.id === storeIdParam) || stores[0];
  const now = new Date();
  const todayRange = getDateRange(now);
  const yesterdayDate = new Date(now); yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayRange = getDateRange(yesterdayDate);
  const sevenDaysAgo = new Date(now); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6); sevenDaysAgo.setHours(0, 0, 0, 0);

  const [todayOrders, yesterdayOrders, weekOrders, todayCustomers, yesterdayCustomers, alerts, insight] = await Promise.all([
    db.order.aggregate({ where: { storeConnectionId: store.id, placedAt: { gte: todayRange.start, lte: todayRange.end } }, _sum: { total: true }, _count: true }),
    db.order.aggregate({ where: { storeConnectionId: store.id, placedAt: { gte: yesterdayRange.start, lte: yesterdayRange.end } }, _sum: { total: true }, _count: true }),
    db.order.findMany({ where: { storeConnectionId: store.id, placedAt: { gte: sevenDaysAgo } }, select: { placedAt: true, total: true }, orderBy: { placedAt: 'asc' } }),
    db.customer.count({ where: { storeConnectionId: store.id, firstOrderAt: { gte: todayRange.start, lte: todayRange.end } } }),
    db.customer.count({ where: { storeConnectionId: store.id, firstOrderAt: { gte: yesterdayRange.start, lte: yesterdayRange.end } } }),
    db.stockAlert.findMany({ where: { storeConnectionId: store.id, currentStock: { gt: 0 } }, orderBy: [{ daysRemaining: 'asc' }, { severity: 'asc' }], take: 6 }),
    db.aiInsight.findFirst({ where: { storeConnectionId: store.id, type: 'ADVISOR_DAILY' }, orderBy: { generatedAt: 'desc' }, select: { healthScore: true, causalAnalysis: true, recommendations: true, generatedAt: true } }),
  ]);

  const dayMap: Record<string, { revenue: number; orders: number }> = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    const key = d.toLocaleDateString('en-CA', { timeZone: 'Europe/Bucharest' });
    dayMap[key] = { revenue: 0, orders: 0 };
  }
  for (const o of weekOrders) {
    const key = new Date(o.placedAt).toLocaleDateString('en-CA', { timeZone: 'Europe/Bucharest' });
    if (dayMap[key]) { dayMap[key].revenue += Number(o.total); dayMap[key].orders += 1; }
  }
  const days7 = Object.entries(dayMap).map(([date, v]) => ({ date, ...v }));

  // Get new customers per day in a single query
  const custPerDayRaw = await db.customer.findMany({
    where: { storeConnectionId: store.id, firstOrderAt: { gte: sevenDaysAgo } },
    select: { firstOrderAt: true },
  });
  const custDayMap: Record<string, number> = {};
  for (const cr of custPerDayRaw) {
    if (!cr.firstOrderAt) continue;
    const key = new Date(cr.firstOrderAt).toLocaleDateString('en-CA', { timeZone: 'Europe/Bucharest' });
    custDayMap[key] = (custDayMap[key] || 0) + 1;
  }
  const custPerDay = days7.map(d => custDayMap[d.date] || 0);

  const todayRevenue = Number(todayOrders._sum.total || 0);
  const yesterdayRevenue = Number(yesterdayOrders._sum.total || 0);
  const todayOrderCount = todayOrders._count;
  const yesterdayOrderCount = yesterdayOrders._count;
  const todayAOV = todayOrderCount > 0 ? todayRevenue / todayOrderCount : 0;
  const yesterdayAOV = yesterdayOrderCount > 0 ? yesterdayRevenue / yesterdayOrderCount : 0;
  function pct(a: number, b: number) { if (!b) return null; return (a - b) / Math.abs(b); }

  const totalProducts = await db.product.count({ where: { storeConnectionId: store.id } });
  const totalOrders = await db.order.count({ where: { storeConnectionId: store.id } });
  const totalCustomers = await db.customer.count({ where: { storeConnectionId: store.id } });

  // Top products today - reuse todayOrders data from weekOrders
  const todayDateStr = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Bucharest' });
  const todayOrdersForProducts = await db.order.findMany({
    where: { storeConnectionId: store.id, placedAt: { gte: todayRange.start, lte: todayRange.end } },
    select: { lineItems: true },
  });
  const productSales: Record<string, { title: string; units: number; revenue: number }> = {};
  for (const o of todayOrdersForProducts) {
    if (!o.lineItems) continue;
    try {
      const items = JSON.parse(o.lineItems);
      for (const it of items) {
        const pid = it.productId || it.title || '';
        if (!productSales[pid]) productSales[pid] = { title: it.title || pid, units: 0, revenue: 0 };
        productSales[pid].units += it.quantity || 1;
        productSales[pid].revenue += (it.price || 0) * (it.quantity || 1);
      }
    } catch {}
  }
  const topProducts = Object.values(productSales).sort((a, b) => b.revenue - a.revenue).slice(0, 5);

  // Repeat rate (quick)
  const totalCustWithOrders = await db.customer.count({ where: { storeConnectionId: store.id, ordersCount: { gte: 1 } } });
  const repeatCust = await db.customer.count({ where: { storeConnectionId: store.id, ordersCount: { gte: 2 } } });
  const repeatRate = totalCustWithOrders > 0 ? Math.round((repeatCust / totalCustWithOrders) * 1000) / 10 : 0;

  let scaleScore = 60;
  try { const sr = await calculateScaleReadiness(store.id); scaleScore = Math.round((sr.overallScore || 60) / 5) * 5; } catch {}

  const sevenDaysAgoStr = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Bucharest' });
  const annotations = getAnnotations(store.id, sevenDaysAgoStr, todayStr);

  let recommendations: any[] = [];
  try { if (insight) { const p = JSON.parse(insight.causalAnalysis); recommendations = (p.recommendations || []).slice(0, 5); } } catch {}

  // Operational costs summary
  let opCosts = { total: 0, returnCost: 0, cardFees: 0, shippingCost: 0 };
  try {
    const settings = await db.storeSettings.findUnique({ where: { storeConnectionId: store.id } });
    if (settings && (settings.returnCost || settings.cardFeePercent || settings.shippingCostPerOrder)) {
      const [returnedCount, cardCount] = await Promise.all([
        db.courierTracking.count({ where: { storeConnectionId: store.id, isReturned: true } }),
        db.courierTracking.count({ where: { storeConnectionId: store.id, isDelivered: true, isCod: false } }),
      ]);
      opCosts.returnCost = Math.round((settings.returnCost || 0) * returnedCount * 100) / 100;
      opCosts.shippingCost = Math.round((settings.shippingCostPerOrder || 0) * totalOrders * 100) / 100;
      opCosts.cardFees = Math.round((cardCount * (settings.cardFeeFixed || 0)) * 100) / 100;
      opCosts.total = opCosts.returnCost + opCosts.shippingCost + opCosts.cardFees;
    }
  } catch {}

  return json({
    stores, store,
    today: { revenue: todayRevenue, orders: todayOrderCount, customers: todayCustomers, aov: todayAOV },
    yesterday: { revenue: yesterdayRevenue, orders: yesterdayOrderCount, customers: yesterdayCustomers, aov: yesterdayAOV },
    changes: { revenue: pct(todayRevenue, yesterdayRevenue), orders: pct(todayOrderCount, yesterdayOrderCount), customers: pct(todayCustomers, yesterdayCustomers), aov: pct(todayAOV, yesterdayAOV) },
    days7, custPerDay, totalStats: { products: totalProducts, orders: totalOrders, customers: totalCustomers },
    scaleScore, lastSyncAt: store.lastSyncAt?.toISOString() || null,
    alerts, insight: insight ? { healthScore: insight.healthScore, generatedAt: insight.generatedAt } : null,
    topProducts, repeatRate, repeatCust, totalCustWithOrders, recommendations, annotations: annotations.map(a => ({ date: a.date, text: a.text, category: a.category })),
  });
}

function Trend({ value }: { value: number | null }) {
  if (value === null) return <span className="trend trend-neutral">—</span>;
  const p = (value * 100).toFixed(1);
  if (value > 0) return <span className="trend trend-up"><TrendingUp size={11} /> +{p}% față de ieri</span>;
  if (value < 0) return <span className="trend trend-down"><TrendingDown size={11} /> {p}% față de ieri</span>;
  return <span className="trend trend-neutral">0% față de ieri</span>;
}

function Sparkline({ data, color = 'var(--kimono-orange)', tooltips }: { data: number[]; color?: string; tooltips?: string[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const max = Math.max(...data, 1);
  return (
    <div style={{ position: 'relative' }}>
      <svg className="kpi-card-sparkline" height="44" viewBox={`0 0 ${data.length * 10} 44`} preserveAspectRatio="none" onMouseLeave={() => setHovered(null)}>
        {data.map((v, i) => {
          const barH = Math.max(2, (v / max) * 36);
          return <rect key={i} x={i * 10 + 1} y={44 - barH - 4} width={8} height={barH} fill={color} opacity={hovered === i ? 1 : (i === data.length - 1 ? 1 : 0.35)} rx={2} style={{ cursor: tooltips ? 'pointer' : undefined, transition: 'opacity 0.15s' }} onMouseEnter={() => setHovered(i)} />;
        })}
      </svg>
      {hovered !== null && tooltips?.[hovered] && (
        <div style={{ position: 'absolute', bottom: '100%', left: `${((hovered + 0.5) / data.length) * 100}%`, transform: 'translateX(-50%)', background: '#1a1a1a', color: 'white', padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap', pointerEvents: 'none', marginBottom: 2, zIndex: 10, boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
          {tooltips[hovered]}
        </div>
      )}
    </div>
  );
}

function HealthSegments({ score }: { score: number }) {
  const filled = Math.round((score / 100) * 10);
  return (
    <div className="health-card-segments">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className={`health-card-segment${i < filled ? ' filled' : ''}`} />
      ))}
    </div>
  );
}

const DAY_LABELS = ['dum', 'lun', 'mar', 'mie', 'joi', 'vin', 'sâm'];
function getDayLabel(dateStr: string) { return DAY_LABELS[new Date(dateStr + 'T12:00:00').getDay()]; }

export default function DashboardPage() {
  const { stores, store, today, yesterday, changes, days7, alerts, insight, totalStats, scaleScore, lastSyncAt, custPerDay, topProducts, repeatRate, repeatCust, totalCustWithOrders, recommendations, annotations: chartAnnotations, opCosts } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const todayLabel = formatDate(new Date(), 'long');
  const revenueSparkline = days7.map((d) => d.revenue);
  const ordersSparkline = days7.map((d) => d.orders);

  if (stores.length === 0) {
    return (
      <div>
        <div className="page-header"><div><h1 className="page-title">Today</h1><p className="page-subtitle">{todayLabel}</p></div></div>
        <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <ShoppingCart size={20} color="var(--text-secondary)" style={{ marginBottom: 16 }} />
          <p style={{ color: 'var(--text-secondary)', marginBottom: 16, fontSize: 14 }}>Nu ai niciun magazin conectat.</p>
          <Link to="/stores/new" className="btn btn-primary">+ Conectează magazin</Link>
        </div>
      </div>
    );
  }

  const urgentCount = alerts.filter((a) => a.daysRemaining <= 7).length;

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Today</h1>
          <p className="page-subtitle">{todayLabel} · {store?.name}</p>
        </div>
        <div className="page-actions">
          {stores.length > 1 && (
            <select className="form-input" style={{ width: 200 }} value={store?.id || ''} onChange={(e) => setSearchParams({ store: e.target.value })}>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <Link to="/ask-ai" className="btn btn-primary"><Zap size={12} /> Ask AI</Link>
        </div>
      </div>

      {/* Store badge + Stats */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'stretch', flexWrap: 'wrap' }}>
        <div className="card" style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 10, flex: '0 0 auto' }}>
          <CheckCircle2 size={16} color="#16a34a" />
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>Magazin {store?.name} conectat</div>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
              {lastSyncAt ? `Sync: ${(() => { const diff = Math.floor((Date.now() - new Date(lastSyncAt).getTime()) / 60000); if (diff < 1) return 'acum'; if (diff < 60) return `acum ${diff} min`; if (diff < 1440) return `acum ${Math.floor(diff / 60)} ore`; return `acum ${Math.floor(diff / 1440)} zile`; })()}` : 'Niciun sync'} · Sync la 30 min
            </div>
          </div>
        </div>
        <div className="card" style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0369a1" strokeWidth="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg>
          <div><div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{formatNumber(totalStats?.products || 0)}</div><div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>Produse</div></div>
        </div>
        <div className="card" style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D85A30" strokeWidth="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></svg>
          <div><div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{formatNumber(totalStats?.orders || 0)}</div><div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>Comenzi total</div></div>
        </div>
        <div className="card" style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0F6E56" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
          <div><div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{formatNumber(totalStats?.customers || 0)}</div><div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>Clienți total</div></div>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-card-label">Venit azi</div>
          <div className="kpi-card-number">{formatCurrency(today?.revenue, 'RON')}</div>
          <div className="kpi-card-trend"><Trend value={changes?.revenue ?? null} /><span className="kpi-card-context">{formatCurrency(yesterday?.revenue, 'RON')} ieri</span></div>
          <Sparkline data={revenueSparkline} tooltips={days7.map(d => `${getDayLabel(d.date)}: ${formatCurrency(d.revenue, "RON")}`)} />
        </div>
        <div className="kpi-card">
          <div className="kpi-card-label">Comenzi azi</div>
          <div className="kpi-card-number">{formatNumber(today?.orders)}</div>
          <div className="kpi-card-trend"><Trend value={changes?.orders ?? null} /><span className="kpi-card-context">{formatNumber(yesterday?.orders)} ieri</span></div>
          <Sparkline data={ordersSparkline} color="var(--info-bg-strong)" tooltips={days7.map(d => `${getDayLabel(d.date)}: ${d.orders} comenzi`)} />
        </div>
        <div className="kpi-card">
          <div className="kpi-card-label">Valoare medie comandă</div>
          <div className="kpi-card-number">{formatCurrency(today?.aov, 'RON', { decimals: 0 })}</div>
          <div className="kpi-card-trend"><Trend value={changes?.aov ?? null} /><span className="kpi-card-context">{formatCurrency(yesterday?.aov, 'RON', { decimals: 0 })} ieri</span></div>
          <Sparkline data={revenueSparkline.map((r, i) => (ordersSparkline[i] > 0 ? r / ordersSparkline[i] : 0))} color="var(--accent-purple)" tooltips={days7.map((d, i) => { const aov = d.orders > 0 ? d.revenue / d.orders : 0; return `${getDayLabel(d.date)}: ${formatCurrency(aov, "RON")}`; })} />
        </div>
        <Link to="/scale" className="health-card" style={{ textDecoration: 'none', cursor: 'pointer' }}>
          <div className="health-card-label">Health Score</div>
          <div className="health-card-score">{scaleScore}<span style={{ fontSize: 16, opacity: 0.6 }}>/100</span></div>
          <div className="health-card-desc">{scaleScore >= 80 ? 'Magazin sănătos' : scaleScore >= 60 ? 'Necesită atenție' : 'Risc ridicat'}</div>
          <HealthSegments score={scaleScore ?? 0} />
        </Link>
      </div>

      {/* AI Advisor Recommendations */}
      {recommendations && recommendations.length > 0 && (
        <div className="card" style={{ padding: '18px 20px', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Zap size={14} color="var(--kimono-orange)" /><span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>AI Advisor</span></div>
            <Link to="/ai-advisor" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Vezi toate <ArrowRight size={10} /></Link>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(recommendations as any[]).map((rec: any, i: number) => {
              const colors: Record<string, { bg: string; text: string; label: string }> = { urgent: { bg: 'var(--danger-bg)', text: 'var(--danger-text)', label: 'Urgent' }, important: { bg: 'var(--warning-bg)', text: 'var(--warning-text)', label: 'Important' }, improvement: { bg: 'var(--info-bg)', text: 'var(--info-text)', label: 'Îmbunătățire' }, opportunity: { bg: 'var(--success-bg)', text: 'var(--success-text)', label: 'Oportunitate' } };
              const c = colors[rec.priority] || colors.improvement;
              return (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 10, alignItems: 'start', padding: '10px 12px', borderRadius: 8, background: 'var(--bg-subtle)' }}>
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '3px 0', borderRadius: 4, background: c.bg, color: c.text, textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'center', whiteSpace: 'nowrap' }}>{c.label}</span>
                  <div><div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>{rec.title}</div><div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{rec.action || rec.description}</div></div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Bottom grid - 4 column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, gridColumn: '1 / 4', minWidth: 0 }}>
          {/* Revenue last 7 days */}
          <div className="card" style={{ padding: '18px 20px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>Venit — ultimele 7 zile</span>
              <Link to="/analytics" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Analiză completă <ArrowRight size={10} /></Link>
            </div>
            {days7.every((d) => d.revenue === 0) ? (
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', padding: '20px 0' }}>Nu există date de vânzări încă.</p>
            ) : (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 80 }}>
                {days7.map((d) => {
                  const max = Math.max(...days7.map((x) => x.revenue), 1);
                  const pctVal = (d.revenue / max) * 100;
                  const isToday = d.date === new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Bucharest' });
                  const dayLabel = new Date(d.date + 'T12:00:00').toLocaleDateString('ro-RO', { weekday: 'short' });
                  const dayAnns = (chartAnnotations as any[] || []).filter((a: any) => a.date === d.date);
                  const hasAnn = dayAnns.length > 0;
                  const annColor = hasAnn ? ({ campaign: '#2563eb', promotion: '#16a34a', product_launch: '#7c3aed', issue: '#dc2626', other: '#d97706' } as Record<string, string>)[dayAnns[0]?.category] || '#d97706' : '';
                  return (
                    <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                      <div style={{ position: 'relative', width: '100%', height: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end' }}>
                        <div style={{ fontSize: 9, color: isToday ? 'var(--kimono-orange)' : 'var(--text-tertiary)', fontWeight: 600, marginBottom: 3 }}>{d.revenue > 0 ? formatCurrency(d.revenue, 'RON') : ''}</div>
                        <div style={{ width: '100%', height: `${Math.max(4, pctVal * 0.45)}px`, background: isToday ? 'var(--kimono-orange)' : 'var(--border-strong)', borderRadius: '3px 3px 0 0', transition: 'height 0.3s' }} />
                      </div>
                      <span style={{ fontSize: 10, color: isToday ? 'var(--kimono-orange)' : 'var(--text-tertiary)', fontWeight: isToday ? 600 : 400, borderBottom: hasAnn ? `2px solid ${annColor}` : 'none', paddingBottom: hasAnn ? 2 : 0, cursor: hasAnn ? 'pointer' : undefined }} title={hasAnn ? dayAnns.map((a: any) => a.text).join(' | ') : undefined}>
                        {dayLabel}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Ask AI banner */}
          {insight && (
            <div style={{ background: 'var(--bg-dark)', borderRadius: 'var(--radius-xl)', padding: '16px 20px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={{ width: 32, height: 32, background: 'var(--kimono-orange)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Bot size={16} color="white" /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'white', marginBottom: 6 }}>Ask AI — Întreabă orice despre magazinul tău</div>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', lineHeight: 1.55, margin: 0 }}>Chat cu AI antrenat pe datele tale reale. Pune întrebări despre vânzări, clienți, stoc și primești răspunsuri instant.</p>
              </div>
              <Link to="/ask-ai" style={{ fontSize: 11, color: 'var(--kimono-orange)', whiteSpace: 'nowrap', flexShrink: 0, marginTop: 2 }}>Vezi tot <ArrowRight size={10} /></Link>
            </div>
          )}

          {/* Quick stats - 3 cards under Ask AI */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <div className="card" style={{ padding: '14px 16px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Repeat Rate</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: repeatRate >= 10 ? 'var(--success-text)' : 'var(--warning-text)' }}>{repeatRate}%</div>
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{formatNumber(repeatCust)} din {formatNumber(totalCustWithOrders)}</div>
            </div>
            <Link to="/rfm" className="card" style={{ padding: '14px 16px', textDecoration: 'none' }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Clienți noi azi</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-primary)' }}>{formatNumber(today?.customers || 0)}</div>
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{formatNumber(yesterday?.customers || 0)} ieri</div>
            </Link>
            <Link to="/forecast" className="card" style={{ padding: '14px 16px', textDecoration: 'none' }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Venit 7 zile</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-primary)' }}>{formatCurrency(days7.reduce((s, d) => s + d.revenue, 0), 'RON')}</div>
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{formatNumber(days7.reduce((s, d) => s + d.orders, 0))} comenzi</div>
            </Link>
          </div>

          {/* Second row of stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <Link to="/analytics" className="card" style={{ padding: '14px 16px', textDecoration: 'none' }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Comenzi 7 zile</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-primary)' }}>{formatNumber(days7.reduce((s, d) => s + d.orders, 0))}</div>
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{formatNumber(today?.orders || 0)} azi</div>
            </Link>
            <div className="card" style={{ padding: '14px 16px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>AOV azi</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-primary)' }}>{formatCurrency(today?.aov || 0, 'RON', { decimals: 0 })}</div>
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{formatCurrency(yesterday?.aov || 0, 'RON', { decimals: 0 })} ieri</div>
            </div>
            <Link to="/stores" className="card" style={{ padding: '14px 16px', textDecoration: 'none' }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Produse active</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-primary)' }}>{formatNumber(totalStats?.products || 0)}</div>
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{formatNumber(totalStats?.orders || 0)} comenzi total</div>
            </Link>
          </div>
        </div>

        {/* Right: Stock alerts */}
        <div className="card" style={{ padding: "18px 20px", overflow: "hidden", minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>Stoc în scădere {urgentCount > 0 && <span style={{ marginLeft: 8, background: 'var(--danger-bg)', color: 'var(--danger-text)', fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 99 }}>{urgentCount} urgente</span>}</span>
            <Link to="/stock" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Toate <ArrowRight size={10} /></Link>
          </div>
          {alerts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0' }}><div style={{ fontSize: 22, marginBottom: 8 }}>✓</div><p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Nicio alertă activă</p></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {alerts.map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 'var(--radius-md)', background: 'var(--warning-bg)' }}>
                  <AlertTriangle size={13} style={{ color: 'var(--warning-text)', flexShrink: 0, marginTop: 1 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.productTitle}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>Stoc: {a.currentStock} · {a.daysRemaining} zile rămase</div>
                  </div>
                </div>
              ))}
              {alerts.length >= 6 && <Link to="/stock" className="btn btn-secondary btn-full" style={{ marginTop: 4, fontSize: 11 }}>Vezi toate alertele</Link>}
            </div>
          )}
        </div>

      </div>



      {/* Top products - full width */}
      <div className="card" style={{ padding: '18px 20px', marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>Top produse azi</span>
          <Link to="/analytics" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Detalii <ArrowRight size={10} /></Link>
        </div>
        {(topProducts as any[])?.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 10 }}>
            {(topProducts as any[]).map((p: any, i: number) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--bg-subtle)' }}>
                <span style={{ width: 20, height: 20, borderRadius: 5, background: 'var(--kimono-orange)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: 'white', flexShrink: 0 }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.title}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{p.units} buc</div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', flexShrink: 0 }}>{Math.round(p.revenue).toLocaleString('ro-RO')} RON</span>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Nicio vânzare astăzi.</p>
        )}
      </div>

    </div>
  );
}
