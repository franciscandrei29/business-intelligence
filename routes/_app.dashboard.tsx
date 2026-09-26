import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Link, useLoaderData, useSearchParams } from '@remix-run/react';
import { requireUser } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import { ShoppingCart, Package, Users, TrendingUp, AlertTriangle, DollarSign } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Dashboard — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');

  const stores = await db.storeConnection.findMany({
    where: { userId: user.id },
    select: { id: true, name: true, platform: true },
    orderBy: { createdAt: 'asc' },
  });

  if (stores.length === 0) {
    return json({ stores, store: null, kpis: null, alerts: [], revenueByMonth: [] });
  }

  const selectedStoreId = storeId || stores[0].id;
  const store = stores.find((s) => s.id === selectedStoreId) || stores[0];

  // KPIs
  const [productCount, orderCount, customerCount, totalRevenue, stockAlerts] = await Promise.all([
    db.product.count({ where: { storeConnectionId: store.id } }),
    db.order.count({ where: { storeConnectionId: store.id } }),
    db.customer.count({ where: { storeConnectionId: store.id } }),
    db.order.aggregate({
      where: { storeConnectionId: store.id },
      _sum: { total: true },
    }),
    db.stockAlert.findMany({
      where: { storeConnectionId: store.id },
      orderBy: { daysRemaining: 'asc' },
      take: 5,
    }),
  ]);

  // Revenue by month (last 6 months)
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const orders = await db.order.findMany({
    where: { storeConnectionId: store.id, placedAt: { gte: sixMonthsAgo } },
    select: { placedAt: true, total: true },
    orderBy: { placedAt: 'asc' },
  });

  const revenueByMonth: Record<string, number> = {};
  for (const o of orders) {
    const month = o.placedAt.toISOString().slice(0, 7);
    revenueByMonth[month] = (revenueByMonth[month] || 0) + Number(o.total);
  }

  const revenueData = Object.entries(revenueByMonth).map(([month, revenue]) => ({
    month,
    revenue: Math.round(revenue * 100) / 100,
  }));

  // AOV
  const aov = orderCount > 0 ? Number(totalRevenue._sum.total || 0) / orderCount : 0;

  // Health score (simplified)
  const hasProducts = productCount > 0;
  const hasOrders = orderCount > 0;
  const hasCustomers = customerCount > 0;
  const criticalAlerts = stockAlerts.filter((a) => a.severity === 'critical').length;
  let healthScore = 0;
  if (hasProducts) healthScore += 25;
  if (hasOrders) healthScore += 25;
  if (hasCustomers) healthScore += 25;
  if (criticalAlerts === 0) healthScore += 25;
  else if (criticalAlerts <= 3) healthScore += 15;

  const healthGrade = healthScore >= 90 ? 'A' : healthScore >= 75 ? 'B' : healthScore >= 50 ? 'C' : 'D';

  return json({
    stores,
    store,
    kpis: {
      products: productCount,
      orders: orderCount,
      customers: customerCount,
      revenue: Math.round(Number(totalRevenue._sum.total || 0) * 100) / 100,
      aov: Math.round(aov * 100) / 100,
      healthScore,
      healthGrade,
    },
    alerts: stockAlerts,
    revenueByMonth: revenueData,
  });
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'var(--color-danger)',
  high: 'var(--color-warning)',
  medium: 'var(--color-info)',
};

export default function DashboardPage() {
  const { stores, store, kpis, alerts, revenueByMonth } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  if (stores.length === 0) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Dashboard</h1>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-md)' }}>
            Nu ai niciun magazin conectat. Adauga primul tau magazin pentru a vedea datele.
          </p>
          <Link to="/stores/new" className="btn btn-primary">Conecteaza magazin</Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">{store?.name}</p>
        </div>
        {stores.length > 1 && (
          <select
            className="form-input"
            style={{ width: 220 }}
            value={store?.id || ''}
            onChange={(e) => setSearchParams({ store: e.target.value })}
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.platform})</option>
            ))}
          </select>
        )}
      </div>


      <div className="info-box">
        <p>
          Dashboard-ul iti arata o privire de ansamblu asupra magazinului: venituri, comenzi, valoarea medie a comenzii (AOV), si un Health Score care masoara sanatatea generala a business-ului. Selecteaza un magazin din dropdown daca ai mai multe conectate.
        </p>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
            <DollarSign size={18} style={{ color: 'var(--color-success)' }} />
            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>Venit total</span>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>
            {kpis?.revenue.toLocaleString('ro-RO')} RON
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
            <ShoppingCart size={18} style={{ color: 'var(--color-info)' }} />
            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>Comenzi</span>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>
            {kpis?.orders.toLocaleString('ro-RO')}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            AOV: {kpis?.aov.toLocaleString('ro-RO')} RON
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
            <Users size={18} style={{ color: 'var(--color-primary)' }} />
            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>Clienti</span>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>
            {kpis?.customers.toLocaleString('ro-RO')}
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
            <Package size={18} style={{ color: 'var(--color-warning)' }} />
            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>Produse</span>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>
            {kpis?.products.toLocaleString('ro-RO')}
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
            <TrendingUp size={18} style={{ color: kpis?.healthScore && kpis.healthScore >= 75 ? 'var(--color-success)' : 'var(--color-warning)' }} />
            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>Health Score</span>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>
            {kpis?.healthScore}/100
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            Grad: {kpis?.healthGrade}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'var(--space-md)' }}>
        {/* Revenue by month */}
        <div className="card">
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>
            Venit pe luna (ultimele 6 luni)
          </h3>
          {revenueByMonth.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>Nu exista date inca.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
              {revenueByMonth.map((m) => {
                const maxRevenue = Math.max(...revenueByMonth.map((r) => r.revenue));
                const pct = maxRevenue > 0 ? (m.revenue / maxRevenue) * 100 : 0;
                return (
                  <div key={m.month} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                    <span style={{ width: 60, fontSize: '0.75rem', color: 'var(--color-text-muted)', flexShrink: 0 }}>
                      {m.month}
                    </span>
                    <div style={{ flex: 1, height: 20, background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: 'var(--color-primary)', borderRadius: 'var(--radius-sm)', transition: 'width 0.3s' }} />
                    </div>
                    <span style={{ width: 90, fontSize: '0.75rem', color: 'var(--color-text)', textAlign: 'right', flexShrink: 0 }}>
                      {m.revenue.toLocaleString('ro-RO')}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Stock alerts */}
        <div className="card">
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>
            Alerte stoc
          </h3>
          {alerts.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>Nu exista alerte de stoc.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
              {alerts.map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', padding: 'var(--space-sm)', background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)' }}>
                  <AlertTriangle size={16} style={{ color: SEVERITY_COLORS[a.severity] || 'var(--color-text-muted)', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.8125rem', color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {a.productTitle}
                    </div>
                    <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>
                      Stoc: {a.currentStock} | {a.daysRemaining} zile ramase
                    </div>
                  </div>
                </div>
              ))}
              <Link to="/stock" style={{ fontSize: '0.8125rem', marginTop: 'var(--space-xs)' }}>
                Vezi toate alertele →
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
