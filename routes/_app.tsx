import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Form, Link, Outlet, useLoaderData, useLocation, useSearchParams } from '@remix-run/react';
import { useState } from 'react';
import { requireUser } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import {
  LayoutDashboard, Store, Bot, TrendingUp, Users, Package, ShieldAlert,
  FileBarChart, Settings, LogOut, LineChart, UserX, Activity, DollarSign,
  CreditCard, Zap, Mail, Heart, Receipt, Repeat, Gauge, Sparkles,
  ShoppingCart, Grid3x3, ShoppingBag, Clock, Archive, Percent, RotateCcw,
  XCircle, ArrowLeftRight, Target, BarChart3, UsersRound, Share2,
  StickyNote, HeartPulse, Truck,
} from 'lucide-react';

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const stores = await db.storeConnection.findMany({
    where: { userId: user.id },
    select: { id: true, name: true, platform: true },
    orderBy: { createdAt: 'asc' },
  });
  return json({
    user: { id: user.id, fullName: user.fullName, email: user.email, company: user.company },
    stores,
  });
}

const NAV_SECTIONS: Array<{ group?: string; title: string; items: Array<{ to: string; label: string; icon: any }> }> = [
  { title: 'Principal', items: [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/stores', label: 'Magazine', icon: Store },
  ]},

  // ========== PRODUSE ==========
  { group: 'Produse', title: 'Inventar', items: [
    { to: '/stock', label: 'Smart Alerts', icon: ShieldAlert },
    { to: '/turnover', label: 'Dead Stock', icon: Archive },
    { to: '/stockout', label: 'Stockout Loss', icon: XCircle },
  ]},
  { group: 'Produse', title: 'Performanta', items: [
    { to: '/bcg', label: 'Product Matrix', icon: Grid3x3 },
    { to: '/basket', label: 'Cross-sell', icon: ShoppingBag },
    { to: '/discounts', label: 'Discount Impact', icon: Percent },
  ]},

  // ========== CLIENTI ==========
  { group: 'Clienti', title: 'Segmentare', items: [
    { to: '/rfm', label: 'RFM Segments', icon: TrendingUp },
    { to: '/cohorts', label: 'Cohorts', icon: Users },
  ]},
  { group: 'Clienti', title: 'Retentie', items: [
    { to: '/churn', label: 'Churn Prediction', icon: UserX },
    { to: '/ltv', label: 'LTV Analytics', icon: Heart },
    { to: '/repeat', label: 'Repeat Purchase', icon: Repeat },
  ]},
  { group: 'Clienti', title: 'Refunds', items: [
    { to: '/refunds', label: 'Refund Analytics', icon: RotateCcw },
  ]},

  // ========== ANALYTICS ==========
  { group: 'Analytics', title: 'Trafic', items: [
    { to: '/analytics', label: 'Google Analytics', icon: BarChart3 },
    { to: '/peaks', label: 'Peak Hours', icon: Clock },
  ]},
  { group: 'Analytics', title: 'Predictii', items: [
    { to: '/forecast', label: 'Revenue Forecast', icon: LineChart },
    { to: '/anomalies', label: 'Anomaly Detection', icon: Activity },
    { to: '/compare', label: 'Period Compare', icon: ArrowLeftRight },
    { to: '/goals', label: 'Goal Tracker', icon: Target },
  ]},
  { group: 'Analytics', title: 'Finante', items: [
    { to: '/profitability', label: 'Profitabilitate', icon: DollarSign },
    { to: '/margin', label: 'Contribution Margin', icon: Receipt },
  ]},
  { group: 'Analytics', title: 'Operatiuni', items: [
    { to: '/fulfilment', label: 'Time to Fulfilment', icon: Truck },
  ]},
  { group: 'Analytics', title: 'AI & Rapoarte', items: [
    { to: '/narrative', label: 'AI Insights', icon: Sparkles },
    { to: '/advisor', label: 'AI Advisor', icon: Bot },
    { to: '/audit', label: 'BI Audit', icon: FileBarChart },
    { to: '/scale', label: 'Scale Readiness', icon: Gauge },
  ]},

  { title: 'Automatizari', items: [
    { to: '/actions', label: 'Smart Actions', icon: Zap },
    { to: '/digest', label: 'Email Digest', icon: Mail },
  ]},
  { title: 'Cont', items: [
    { to: '/team', label: 'Echipa', icon: UsersRound },
    { to: '/shares', label: 'Rapoarte partajate', icon: Share2 },
    { to: '/annotations', label: 'Adnotari', icon: StickyNote },
    { to: '/data-health', label: 'Data Health', icon: HeartPulse },
    { to: '/pricing', label: 'Abonament', icon: CreditCard },
    { to: '/settings', label: 'Setari', icon: Settings },
  ]},
];

export default function AppLayout() {
  const { user, stores } = useLoaderData<typeof loader>();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const currentStore = searchParams.get('store') || stores[0]?.id || '';
  const initials = user.fullName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);

  return (
    <div className="app-layout">
      <div className="mobile-header"><button className="mobile-menu-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>&#9776;</button><h1>Kimono <span>BI</span></h1></div>
      <div className={`mobile-overlay${sidebarOpen ? ' open' : ''}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sidebar-header">
          <h1>Kimono <span>BI</span></h1>
        </div>
        {stores.length > 1 && (
          <div style={{ padding: 'var(--space-sm) var(--space-md)', borderBottom: '1px solid var(--color-border)' }}>
            <select
              className="form-input"
              style={{ width: '100%', fontSize: '0.8125rem', padding: '6px 10px' }}
              value={currentStore}
              onChange={(e) => {
                const params = new URLSearchParams(window.location.search);
                params.set('store', e.target.value);
                window.location.search = params.toString();
              }}
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.platform})
                </option>
              ))}
            </select>
          </div>
        )}
        {stores.length === 1 && (
          <div style={{ padding: 'var(--space-sm) var(--space-md)', borderBottom: '1px solid var(--color-border)' }}>
            <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
              <Store size={14} />
              {stores[0].name}
            </div>
          </div>
        )}
        <nav className="sidebar-nav">
          {NAV_SECTIONS.map((section, idx) => {
            const prevGroup = idx > 0 ? NAV_SECTIONS[idx - 1].group : undefined;
            const showGroupHeader = section.group && section.group !== prevGroup;
            return (
              <div key={`${section.group || ''}-${section.title}`} className="sidebar-section">
                {showGroupHeader && (
                  <div className="sidebar-group-title">{section.group}</div>
                )}
                <div className="sidebar-section-title">{section.title}</div>
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = location.pathname === item.to;
                  return (
                    <Link key={item.to} to={currentStore ? `${item.to}?store=${currentStore}` : item.to} className={`sidebar-link${isActive ? ' active' : ''}`} onClick={() => setSidebarOpen(false)}>
                      <Icon size={18} />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-avatar">{initials}</div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{user.fullName}</div>
              <div className="sidebar-user-email">{user.email}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)' }}>
            <Form method="post" action="/logout" style={{ flex: 1 }}>
              <button type="submit" className="btn btn-secondary btn-full" style={{ fontSize: '0.8125rem' }}>
                <LogOut size={14} />
                Deconectare
              </button>
            </Form>
          </div>
        </div>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
