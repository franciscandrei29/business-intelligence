import React, { useMemo, useState } from 'react';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Link, useLoaderData, useSearchParams } from '@remix-run/react';
import { requireUserContext } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import { formatCurrency, formatNumber } from '~/lib/utils';
import { TrendingUp, TrendingDown, Minus, ShoppingBag, Users, Receipt, Percent, RotateCcw, Award, Calendar } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Statistici — Kimono BI' }];

const PERIOD_DAYS: Record<string, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '180d': 180,
  '365d': 365,
};

const PERIOD_LABELS: Record<string, string> = {
  '7d': 'Ultimele 7 zile',
  '30d': 'Ultima lună',
  '90d': 'Ultimele 3 luni',
  '180d': 'Ultimele 6 luni',
  '365d': 'Ultimul an',
};

type Granularity = 'day' | 'week' | 'month';

function pickGranularity(days: number): Granularity {
  if (days <= 14) return 'day';
  if (days <= 100) return 'week';
  return 'month';
}

function bucketKey(date: Date, gran: Granularity): string {
  if (gran === 'day') {
    return date.toISOString().slice(0, 10); // YYYY-MM-DD
  }
  if (gran === 'week') {
    const monday = new Date(date);
    const day = monday.getUTCDay();
    const diff = (day === 0 ? -6 : 1 - day);
    monday.setUTCDate(monday.getUTCDate() + diff);
    return monday.toISOString().slice(0, 10); // monday of week
  }
  return date.toISOString().slice(0, 7); // YYYY-MM
}

function formatBucket(key: string, gran: Granularity): string {
  if (gran === 'month') {
    const [y, m] = key.split('-');
    const months = ['Ian', 'Feb', 'Mar', 'Apr', 'Mai', 'Iun', 'Iul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[parseInt(m, 10) - 1]} ${y.slice(2)}`;
  }
  if (gran === 'week') {
    const d = new Date(key);
    return `${d.getUTCDate()} ${['Ian','Feb','Mar','Apr','Mai','Iun','Iul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]}`;
  }
  const d = new Date(key);
  return `${d.getUTCDate()} ${['Ian','Feb','Mar','Apr','Mai','Iun','Iul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]}`;
}

interface ParsedLineItem {
  title: string;
  quantity: number;
  price: number;
  productId?: string | null;
  sku?: string | null;
}

function parseLineItems(li: string | null): ParsedLineItem[] {
  if (!li) return [];
  try {
    const arr = JSON.parse(li);
    if (!Array.isArray(arr)) return [];
    return arr.map((x: any) => ({
      title: String(x.title || ''),
      quantity: Number(x.quantity || 0),
      price: Number(x.price || 0),
      productId: x.productId || null,
      sku: x.sku || null,
    }));
  } catch { return []; }
}

interface KpiBlock {
  current: number;
  previous: number;
  delta: number; // pct
}

function pct(curr: number, prev: number): number {
  if (prev === 0) return curr > 0 ? 100 : 0;
  return ((curr - prev) / prev) * 100;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await requireUserContext(request);
  const url = new URL(request.url);
  const period = url.searchParams.get('period') || '30d';
  const storeIdParam = url.searchParams.get('store');
  const days = PERIOD_DAYS[period] || 30;

  const stores = await db.storeConnection.findMany({
    where: { userId: ctx.effectiveOwnerId },
    select: { id: true, name: true, platform: true },
    orderBy: { createdAt: 'asc' },
  });

  if (stores.length === 0) {
    return json({
      stores: [],
      period,
      activeStoreId: null,
      hasData: false as const,
    });
  }

  // Single-store mode: use URL ?store= or fall back to first store
  const activeStore = stores.find((s) => s.id === storeIdParam) || stores[0];
  const storeIds = [activeStore.id];

  const now = new Date();
  const startCurrent = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const startPrevious = new Date(startCurrent.getTime() - days * 24 * 60 * 60 * 1000);

  // Fetch ALL orders in 2x range (current + previous) in one go.
  // Exclude voided/canceled/fully-refunded statuses — they shouldn't count in revenue,
  // tops, or any aggregations. PARTIALLY_REFUNDED stays in: real money was kept; we use net.
  const EXCLUDED_STATUSES = ['VOIDED', 'REFUNDED', 'CANCELED', 'CANCELLED', 'voided', 'refunded', 'canceled', 'cancelled'];
  const orders = await db.order.findMany({
    where: {
      storeConnectionId: { in: storeIds },
      placedAt: { gte: startPrevious, lte: now },
      status: { notIn: EXCLUDED_STATUSES },
    },
    select: {
      id: true,
      total: true,
      totalRefunded: true,
      discountTotal: true,
      customerId: true,
      lineItems: true,
      placedAt: true,
      storeConnectionId: true,
    },
    orderBy: { placedAt: 'asc' },
  });

  // Customers map for top customers names
  const customerIds = Array.from(new Set(orders.map((o) => o.customerId).filter(Boolean) as string[]));
  const customers = customerIds.length
    ? await db.customer.findMany({
        where: { id: { in: customerIds } },
        select: { id: true, email: true, firstName: true, lastName: true },
      })
    : [];
  const customerById: Record<string, { name: string; email: string | null }> = {};
  customers.forEach((c) => {
    const name = `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.email || 'Anonim';
    customerById[c.id] = { name, email: c.email };
  });

  // First-order date per customer (within the 2x range or earlier — to know if "new" in current period)
  const firstOrderByCustomer: Record<string, Date> = {};
  for (const o of orders) {
    if (!o.customerId) continue;
    const existing = firstOrderByCustomer[o.customerId];
    if (!existing || o.placedAt < existing) firstOrderByCustomer[o.customerId] = o.placedAt;
  }
  // Backfill: also check orders BEFORE startPrevious to know if they were already known customers
  const earliestPossible = new Date(startPrevious.getTime() - 1);
  const earlierFirstOrders = customerIds.length
    ? await db.order.groupBy({
        by: ['customerId'],
        where: { customerId: { in: customerIds }, placedAt: { lte: earliestPossible } },
        _min: { placedAt: true },
      })
    : [];
  for (const e of earlierFirstOrders) {
    if (e.customerId && e._min.placedAt) {
      const existing = firstOrderByCustomer[e.customerId];
      if (!existing || e._min.placedAt < existing) firstOrderByCustomer[e.customerId] = e._min.placedAt;
    }
  }

  // Aggregations split by current vs previous period
  const buckets = { current: { from: startCurrent, to: now }, previous: { from: startPrevious, to: startCurrent } };

  function emptyAgg() {
    return {
      revenue: 0,        // gross total (sum of order.total)
      refunds: 0,        // sum of totalRefunded
      discounts: 0,      // sum of discountTotal
      orders: 0,
      customerIds: new Set<string>(),
      newCustomerIds: new Set<string>(),
    };
  }
  const aggCurrent = emptyAgg();
  const aggPrevious = emptyAgg();

  for (const o of orders) {
    const inCurrent = o.placedAt >= buckets.current.from && o.placedAt <= buckets.current.to;
    const inPrev = o.placedAt >= buckets.previous.from && o.placedAt < buckets.previous.to;
    const a = inCurrent ? aggCurrent : (inPrev ? aggPrevious : null);
    if (!a) continue;
    const total = Number(o.total);
    const refund = Number(o.totalRefunded || 0);
    const disc = Number(o.discountTotal || 0);
    a.revenue += total;
    a.refunds += refund;
    a.discounts += disc;
    a.orders += 1;
    if (o.customerId) {
      a.customerIds.add(o.customerId);
      const first = firstOrderByCustomer[o.customerId];
      if (first && first >= buckets.current.from && inCurrent) {
        // First order ever for this customer fell within current window
        a.newCustomerIds.add(o.customerId);
      } else if (first && first >= buckets.previous.from && first < buckets.current.from && inPrev) {
        a.newCustomerIds.add(o.customerId);
      }
    }
  }

  // Hero KPIs (current + previous + delta%)
  const netRevCurr = aggCurrent.revenue - aggCurrent.refunds;
  const netRevPrev = aggPrevious.revenue - aggPrevious.refunds;
  const aovCurr = aggCurrent.orders > 0 ? aggCurrent.revenue / aggCurrent.orders : 0;
  const aovPrev = aggPrevious.orders > 0 ? aggPrevious.revenue / aggPrevious.orders : 0;
  const refundRateCurr = aggCurrent.revenue > 0 ? (aggCurrent.refunds / aggCurrent.revenue) * 100 : 0;
  const refundRatePrev = aggPrevious.revenue > 0 ? (aggPrevious.refunds / aggPrevious.revenue) * 100 : 0;
  const discIntensCurr = aggCurrent.revenue + aggCurrent.discounts > 0 ? (aggCurrent.discounts / (aggCurrent.revenue + aggCurrent.discounts)) * 100 : 0;
  const discIntensPrev = aggPrevious.revenue + aggPrevious.discounts > 0 ? (aggPrevious.discounts / (aggPrevious.revenue + aggPrevious.discounts)) * 100 : 0;
  const customersCurr = aggCurrent.customerIds.size;
  const customersPrev = aggPrevious.customerIds.size;
  const newCustCurr = aggCurrent.newCustomerIds.size;
  const newCustPrev = aggPrevious.newCustomerIds.size;

  const kpis = {
    revenue:    { current: netRevCurr, previous: netRevPrev, delta: pct(netRevCurr, netRevPrev) },
    orders:     { current: aggCurrent.orders, previous: aggPrevious.orders, delta: pct(aggCurrent.orders, aggPrevious.orders) },
    aov:        { current: aovCurr, previous: aovPrev, delta: pct(aovCurr, aovPrev) },
    customers:  { current: customersCurr, previous: customersPrev, delta: pct(customersCurr, customersPrev) },
    newCustomers: { current: newCustCurr, previous: newCustPrev, delta: pct(newCustCurr, newCustPrev) },
    refundRate: { current: refundRateCurr, previous: refundRatePrev, delta: refundRateCurr - refundRatePrev }, // pp delta
    discountIntensity: { current: discIntensCurr, previous: discIntensPrev, delta: discIntensCurr - discIntensPrev }, // pp delta
  };

  // Time series for chart (current period only)
  const granularity = pickGranularity(days);
  const tsMap: Record<string, { revenue: number; orders: number; customers: Set<string> }> = {};
  const ordersCurrent = orders.filter((o) => o.placedAt >= buckets.current.from);
  for (const o of ordersCurrent) {
    const key = bucketKey(o.placedAt, granularity);
    if (!tsMap[key]) tsMap[key] = { revenue: 0, orders: 0, customers: new Set() };
    tsMap[key].revenue += Number(o.total) - Number(o.totalRefunded || 0);
    tsMap[key].orders += 1;
    if (o.customerId) tsMap[key].customers.add(o.customerId);
  }
  const timeSeries = Object.entries(tsMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => ({
      key,
      label: formatBucket(key, granularity),
      revenue: v.revenue,
      orders: v.orders,
      customers: v.customers.size,
    }));

  // Top 10 products (by revenue, current period)
  const productMap: Record<string, { title: string; productId: string | null; revenue: number; units: number; orders: number }> = {};
  for (const o of ordersCurrent) {
    const items = parseLineItems(o.lineItems);
    const seenProducts = new Set<string>();
    for (const li of items) {
      const key = li.productId || li.sku || li.title;
      if (!key) continue;
      if (!productMap[key]) productMap[key] = { title: li.title, productId: li.productId || null, revenue: 0, units: 0, orders: 0 };
      productMap[key].revenue += li.price * li.quantity;
      productMap[key].units += li.quantity;
      if (!seenProducts.has(key)) { productMap[key].orders += 1; seenProducts.add(key); }
    }
  }
  const topProducts = Object.values(productMap)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  const totalRevenueForShare = ordersCurrent.reduce((s, o) => s + Number(o.total) - Number(o.totalRefunded || 0), 0);

  // Top 10 customers (by revenue, current period)
  const customerAgg: Record<string, { revenue: number; orders: number }> = {};
  for (const o of ordersCurrent) {
    if (!o.customerId) continue;
    if (!customerAgg[o.customerId]) customerAgg[o.customerId] = { revenue: 0, orders: 0 };
    customerAgg[o.customerId].revenue += Number(o.total) - Number(o.totalRefunded || 0);
    customerAgg[o.customerId].orders += 1;
  }
  const topCustomers = Object.entries(customerAgg)
    .map(([id, v]) => ({
      id,
      name: customerById[id]?.name || 'Anonim',
      email: customerById[id]?.email || null,
      revenue: v.revenue,
      orders: v.orders,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  // Top 10 best days (by revenue, current period)
  const dayMap: Record<string, { revenue: number; orders: number }> = {};
  for (const o of ordersCurrent) {
    const key = o.placedAt.toISOString().slice(0, 10);
    if (!dayMap[key]) dayMap[key] = { revenue: 0, orders: 0 };
    dayMap[key].revenue += Number(o.total) - Number(o.totalRefunded || 0);
    dayMap[key].orders += 1;
  }
  const topDays = Object.entries(dayMap)
    .map(([key, v]) => ({ date: key, revenue: v.revenue, orders: v.orders }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  // Courier return data
  let courierStats = { returnRate: 0, returned: 0, delivered: 0, returnCost: 0, shippingCost: 0, netRevenue: 0 };
  try {
    const [crDelivered, crReturned] = await Promise.all([
      db.courierTracking.count({ where: { storeConnectionId: activeStore.id, isDelivered: true } }),
      db.courierTracking.count({ where: { storeConnectionId: activeStore.id, isReturned: true } }),
    ]);
    const settings = await db.storeSettings.findUnique({ where: { storeConnectionId: activeStore.id } });
    const total = crDelivered + crReturned;
    const returnRate = total > 0 ? Math.round((crReturned / total) * 1000) / 10 : 0;
    // Fiecare retur pierde transport dus + cost extra retur
      const returnCost = ((settings?.shippingCostPerOrder || 0) + (settings?.returnCost || 0)) * crReturned;
    const shippingCost = (settings?.shippingCostPerOrder || 0) * crDelivered;
    courierStats = {
      returnRate, returned: crReturned, delivered: crDelivered,
      returnCost: Math.round(returnCost * 100) / 100,
      shippingCost: Math.round(shippingCost * 100) / 100,
      netRevenue: Math.round((kpis.revenue.current - returnCost - shippingCost) * 100) / 100,
    };
  } catch {}

  return json({
    hasData: true as const,
    period,
    activeStoreId: activeStore.id,
    activeStoreName: activeStore.name,
    stores,
    granularity,
    days,
    kpis,
    timeSeries,
    topProducts,
    topCustomers,
    topDays,
    totalRevenueForShare,
    courierStats,
  });
}

// ============================================================================
// UI
// ============================================================================

function DeltaBadge({ delta, isPp = false, inverse = false }: { delta: number; isPp?: boolean; inverse?: boolean }) {
  const isUp = delta > 0.05;
  const isDown = delta < -0.05;
  const goodIsUp = !inverse;
  const isPositive = (isUp && goodIsUp) || (isDown && !goodIsUp);
  const color = isPositive ? '#16a34a' : (isUp || isDown ? '#dc2626' : '#737373');
  const bg = isPositive ? 'rgba(22,163,74,0.1)' : (isUp || isDown ? 'rgba(220,38,38,0.1)' : 'rgba(115,115,115,0.1)');
  const Icon = isUp ? TrendingUp : (isDown ? TrendingDown : Minus);
  const value = Math.abs(delta);
  const formatted = isPp ? `${value.toFixed(1)}pp` : `${value.toFixed(1)}%`;
  const sign = isUp ? '+' : (isDown ? '−' : '');
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 99,
      background: bg, color,
    }}>
      <Icon size={11} />
      {sign}{formatted}
    </span>
  );
}

function KpiCard({ icon: Icon, label, value, delta, deltaPp, inverse, accent }: {
  icon: any;
  label: string;
  value: string;
  delta: number;
  deltaPp?: boolean;
  inverse?: boolean;
  accent: string;
}) {
  return (
    <div className="card" style={{ padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ width: 28, height: 28, borderRadius: 7, background: accent + '15', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={14} color={accent} />
        </div>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</span>
      </div>
      <div style={{ fontSize: 24, fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '-0.7px', lineHeight: 1.05, marginBottom: 8 }}>{value}</div>
      <DeltaBadge delta={delta} isPp={deltaPp} inverse={inverse} />
    </div>
  );
}

function TrendChart({ data, metric }: { data: Array<{ key: string; label: string; revenue: number; orders: number; customers: number }>; metric: 'revenue' | 'orders' | 'customers' }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (data.length === 0) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>Niciun date pentru perioada selectată</div>;
  }

  const values = data.map((d) => d[metric]);
  const max = Math.max(...values, 1);
  const mid = max / 2;

  const formatValue = (v: number) => {
    if (metric === 'revenue') return formatCurrency(v);
    return formatNumber(v);
  };

  // Show every Nth label to avoid overlap when many points
  const labelEvery = Math.max(1, Math.ceil(data.length / 12));

  const PADDING_LEFT = 60;
  const PADDING_RIGHT = 8;
  const PADDING_TOP = 12;
  const PADDING_BOTTOM = 28;

  return (
    <div style={{ position: 'relative', height: 260, userSelect: 'none' }}>
      {/* Y-axis labels */}
      <div style={{
        position: 'absolute', left: 0, top: PADDING_TOP, bottom: PADDING_BOTTOM, width: PADDING_LEFT - 8,
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'flex-end',
      }}>
        <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>{formatValue(max)}</span>
        <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>{formatValue(mid)}</span>
        <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>0</span>
      </div>

      {/* Grid lines */}
      <div style={{ position: 'absolute', left: PADDING_LEFT, right: PADDING_RIGHT, top: PADDING_TOP, bottom: PADDING_BOTTOM, pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, borderTop: '0.5px dashed var(--border-default)' }} />
        <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, borderTop: '0.5px dashed var(--border-default)' }} />
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, borderTop: '1px solid var(--border-strong)' }} />
      </div>

      {/* Bars */}
      <div style={{
        position: 'absolute', left: PADDING_LEFT, right: PADDING_RIGHT, top: PADDING_TOP, bottom: PADDING_BOTTOM,
        display: 'flex', alignItems: 'flex-end', gap: 4,
      }}>
        {data.map((d, i) => {
          const v = d[metric];
          const h = (v / max) * 100;
          const isHovered = hoverIdx === i;
          const showTooltipOnRight = i < data.length / 2;
          return (
            <div
              key={d.key}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              style={{
                flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
                alignItems: 'center', position: 'relative', height: '100%', cursor: 'pointer',
              }}
            >
              {/* Tooltip */}
              {isHovered && (
                <div style={{
                  position: 'absolute',
                  bottom: `calc(${Math.max(h, 1)}% + 8px)`,
                  left: showTooltipOnRight ? '50%' : 'auto',
                  right: showTooltipOnRight ? 'auto' : '50%',
                  transform: showTooltipOnRight ? 'translateX(-30%)' : 'translateX(30%)',
                  background: '#0A0A0A',
                  color: 'white',
                  padding: '8px 12px',
                  borderRadius: 6,
                  fontSize: 11,
                  whiteSpace: 'nowrap',
                  zIndex: 10,
                  boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
                  pointerEvents: 'none',
                  lineHeight: 1.5,
                }}>
                  <div style={{ fontWeight: 600, marginBottom: 4, color: '#FFB590', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{d.label}</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontSize: 10, color: '#888' }}>
                      {metric === 'revenue' ? 'Revenue net:' : metric === 'orders' ? 'Comenzi:' : 'Clienți unici:'}
                    </span>
                    <strong style={{ color: 'white', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{formatValue(v)}</strong>
                  </div>
                  <div style={{ fontSize: 10, color: '#888', marginTop: 3 }}>
                    {d.orders} comenzi · {d.customers} clienți
                  </div>
                </div>
              )}

              {/* Bar */}
              <div style={{
                width: '100%',
                maxWidth: 36,
                height: `${h}%`,
                background: isHovered
                  ? 'linear-gradient(180deg, #B84818 0%, var(--kimono-orange) 100%)'
                  : 'linear-gradient(180deg, var(--kimono-orange) 0%, #FFB590 100%)',
                borderRadius: '4px 4px 0 0',
                minHeight: v > 0 ? 2 : 0,
                transition: 'all 0.15s',
                boxShadow: isHovered ? '0 0 0 2px rgba(216,90,48,0.2)' : 'none',
              }} />
            </div>
          );
        })}
      </div>

      {/* X-axis labels */}
      <div style={{
        position: 'absolute', left: PADDING_LEFT, right: PADDING_RIGHT, bottom: 0,
        height: PADDING_BOTTOM - 4, display: 'flex', gap: 4, alignItems: 'flex-start', paddingTop: 6,
      }}>
        {data.map((d, i) => {
          const showLabel = i % labelEvery === 0 || i === data.length - 1;
          return (
            <div key={d.key} style={{
              flex: 1, textAlign: 'center', fontSize: 10,
              color: hoverIdx === i ? 'var(--text-primary)' : 'var(--text-tertiary)',
              fontWeight: hoverIdx === i ? 600 : 400,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              transition: 'all 0.15s',
            }}>
              {showLabel ? d.label : ''}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function StatisticsPage() {
  const data = useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();
  const [metric, setMetric] = useState<'revenue' | 'orders' | 'customers'>('revenue');

  const setParam = (key: string, value: string) => {
    setSearchParams((prev) => {
      prev.set(key, value);
      return prev;
    });
  };

  if (!data.hasData) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">Statistici</h1>
            <p className="page-subtitle">Privire de ansamblu pe perioade configurabile</p>
          </div>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: '60px 30px' }}>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            Niciun magazin conectat sau fără comenzi în perioada selectată. <Link to="/stores" style={{ color: 'var(--kimono-orange)', fontWeight: 600 }}>Conectează magazin</Link>.
          </p>
        </div>
      </div>
    );
  }

  const { period, activeStoreName, kpis, timeSeries, topProducts, topCustomers, topDays, totalRevenueForShare, courierStats } = data;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Statistici</h1>
          <p className="page-subtitle">{activeStoreName} · {PERIOD_LABELS[period]} · vs perioadă similară anterioară</p>
        </div>
        <div className="page-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select className="form-input" value={period} onChange={(e) => setParam('period', e.target.value)} style={{ width: 180 }}>
            {Object.entries(PERIOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>

      {/* Hero KPI grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 22 }}>
        <KpiCard icon={Receipt} label="Revenue (net)" value={formatCurrency(kpis.revenue.current)} delta={kpis.revenue.delta} accent="#D85A30" />
        <KpiCard icon={ShoppingBag} label="Comenzi" value={formatNumber(kpis.orders.current)} delta={kpis.orders.delta} accent="#0369a1" />
        <KpiCard icon={Award} label="AOV" value={formatCurrency(kpis.aov.current)} delta={kpis.aov.delta} accent="#7c3aed" />
        <KpiCard icon={Users} label="Clienți unici" value={formatNumber(kpis.customers.current)} delta={kpis.customers.delta} accent="#16a34a" />
        <KpiCard icon={Users} label="Clienți noi" value={formatNumber(kpis.newCustomers.current)} delta={kpis.newCustomers.delta} accent="#0891b2" />
        <KpiCard icon={RotateCcw} label="Rata retur" value={courierStats && courierStats.delivered > 0 ? `${courierStats.returnRate}%` : `${kpis.refundRate.current.toFixed(1)}%`} delta={kpis.refundRate.delta} deltaPp inverse accent="#dc2626" />
        <KpiCard icon={Percent} label="Intensitate discount" value={`${kpis.discountIntensity.current.toFixed(1)}%`} delta={kpis.discountIntensity.delta} deltaPp inverse accent="#d97706" />
      </div>

      {/* Courier & costs */}
      {courierStats && courierStats.delivered > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 22 }}>

          {courierStats.returnCost > 0 && (
            <div className="card" style={{ padding: '14px 16px', borderLeft: '3px solid #dc2626' }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Cost retururi</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: '#dc2626' }}>-{courierStats.returnCost.toLocaleString('ro-RO')} RON</div>
            </div>
          )}
          {courierStats.shippingCost > 0 && (
            <div className="card" style={{ padding: '14px 16px', borderLeft: '3px solid #f59e0b' }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Cost transport total</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: '#f59e0b' }}>-{courierStats.shippingCost.toLocaleString('ro-RO')} RON</div>
            </div>
          )}
          {(courierStats.returnCost > 0 || courierStats.shippingCost > 0) && (
            <div className="card" style={{ padding: '14px 16px', borderLeft: '3px solid #7c3aed', background: 'rgba(124,58,237,0.03)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Revenue net (dupa transport + retururi)</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#7c3aed' }}>{courierStats.netRevenue.toLocaleString('ro-RO')} RON</div>
            </div>
          )}
        </div>
      )}

      {/* Trend chart */}
      <div className="card" style={{ marginBottom: 22 }}>
        <div style={{ padding: '14px 20px', borderBottom: '0.5px solid var(--border-default)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Evoluție {PERIOD_LABELS[period].toLowerCase()}</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>Granularitate: {data.granularity === 'day' ? 'pe zi' : data.granularity === 'week' ? 'pe săptămână' : 'pe lună'} · {timeSeries.length} puncte</div>
          </div>
          <div style={{ display: 'inline-flex', background: 'var(--bg-tertiary)', borderRadius: 99, padding: 3, gap: 2 }}>
            {(['revenue', 'orders', 'customers'] as const).map((m) => (
              <button key={m} onClick={() => setMetric(m)} style={{
                padding: '6px 12px', borderRadius: 99, border: 'none', cursor: 'pointer',
                background: metric === m ? 'white' : 'transparent',
                color: metric === m ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontSize: 12, fontWeight: 600,
                boxShadow: metric === m ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}>
                {m === 'revenue' ? 'Revenue' : m === 'orders' ? 'Comenzi' : 'Clienți'}
              </button>
            ))}
          </div>
        </div>
        <div style={{ padding: '12px 20px' }}>
          <TrendChart data={timeSeries} metric={metric} />
        </div>
      </div>

      {/* Top performers — 3 columns */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        {/* Top products */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '12px 18px', borderBottom: '0.5px solid var(--border-default)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Top 10 produse</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>După revenue, perioada selectată</div>
          </div>
          {topProducts.length === 0 ? (
            <div style={{ padding: '30px 18px', textAlign: 'center', fontSize: 12, color: 'var(--text-tertiary)' }}>Nicio comandă în perioadă.</div>
          ) : topProducts.map((p, i) => {
            const sharePct = totalRevenueForShare > 0 ? (p.revenue / totalRevenueForShare) * 100 : 0;
            return (
              <div key={`${p.productId}-${i}`} style={{ padding: '10px 18px', borderBottom: '0.5px solid var(--border-default)', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 22, height: 22, borderRadius: 6, background: i === 0 ? 'rgba(216,90,48,0.15)' : 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: i === 0 ? 'var(--kimono-orange)' : 'var(--text-secondary)', flexShrink: 0 }}>
                  {i + 1}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.title}>{p.title}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)', marginTop: 1 }}>{formatNumber(p.units)} unități · {formatNumber(p.orders)} comenzi · {sharePct.toFixed(1)}% din total</div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', flexShrink: 0, textAlign: 'right' }}>{formatCurrency(p.revenue)}</div>
              </div>
            );
          })}
        </div>

        {/* Top customers */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '12px 18px', borderBottom: '0.5px solid var(--border-default)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Top 10 clienți</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>După revenue, perioada selectată</div>
          </div>
          {topCustomers.length === 0 ? (
            <div style={{ padding: '30px 18px', textAlign: 'center', fontSize: 12, color: 'var(--text-tertiary)' }}>Niciun client identificat.</div>
          ) : topCustomers.map((c, i) => (
            <div key={c.id} style={{ padding: '10px 18px', borderBottom: '0.5px solid var(--border-default)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 22, height: 22, borderRadius: 6, background: i === 0 ? 'rgba(216,90,48,0.15)' : 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: i === 0 ? 'var(--kimono-orange)' : 'var(--text-secondary)', flexShrink: 0 }}>
                {i + 1}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.email || c.name}>{c.name}</div>
                <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)', marginTop: 1 }}>{c.email || '—'} · {formatNumber(c.orders)} comenzi</div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', flexShrink: 0, textAlign: 'right' }}>{formatCurrency(c.revenue)}</div>
            </div>
          ))}
        </div>

        {/* Top days */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '12px 18px', borderBottom: '0.5px solid var(--border-default)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Top 10 zile</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>Cele mai bune zile, perioada selectată</div>
          </div>
          {topDays.length === 0 ? (
            <div style={{ padding: '30px 18px', textAlign: 'center', fontSize: 12, color: 'var(--text-tertiary)' }}>Nicio comandă în perioadă.</div>
          ) : topDays.map((d, i) => {
            const date = new Date(d.date);
            const dayName = ['Duminică','Luni','Marți','Miercuri','Joi','Vineri','Sâmbătă'][date.getUTCDay()];
            const formatted = `${date.getUTCDate()} ${['ian','feb','mar','apr','mai','iun','iul','aug','sep','oct','nov','dec'][date.getUTCMonth()]} ${date.getUTCFullYear()}`;
            return (
              <div key={d.date} style={{ padding: '10px 18px', borderBottom: '0.5px solid var(--border-default)', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 22, height: 22, borderRadius: 6, background: i === 0 ? 'rgba(216,90,48,0.15)' : 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: i === 0 ? 'var(--kimono-orange)' : 'var(--text-secondary)', flexShrink: 0 }}>
                  {i + 1}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-primary)' }}>{dayName}, {formatted}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)', marginTop: 1 }}>{formatNumber(d.orders)} comenzi</div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', flexShrink: 0, textAlign: 'right' }}>{formatCurrency(d.revenue)}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer note */}
      <div style={{ marginTop: 24, padding: '14px 18px', background: 'var(--bg-tertiary)', borderRadius: 10, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
        💡 <strong>Cum să citești:</strong> deltele % compară perioada selectată cu perioada similară anterioară (ex: ultimele 30 de zile vs cele 30 înainte). Pentru rate retururi și intensitate discount, deltele sunt în puncte procentuale (pp). Verde = îmbunătățire, roșu = regresie. Revenue = net (după retururi).
      </div>
    </div>
  );
}
