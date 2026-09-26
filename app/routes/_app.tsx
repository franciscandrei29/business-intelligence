import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Form, Link, Outlet, useLoaderData, useLocation, useNavigate, useSearchParams } from '@remix-run/react';
import { useState } from 'react';
import { requireUser, requireUserContext } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import { getInitials, getAvatarColor } from '~/lib/utils';
import { getPlanModules, ALWAYS_ALLOWED, PLAN_LIMITS } from '~/lib/plans';
import { getUserPlan } from '~/lib/plans.server';
import {
  LayoutGrid, Zap, AlertTriangle,
  BarChart3, Users, Package, Megaphone,
  Archive, Clock, Activity,
  TrendingUp, AlertCircle, SplitSquareHorizontal, Target,
  Store, UsersRound, Settings, CreditCard, ShieldCheck,
  LogOut, ChevronDown, Menu, X,
  Grid3x3, CalendarDays, UserMinus,
  Percent, Undo2,
  Share2, StickyNote, HeartPulse, Bot, FileBarChart,
  Gauge, Mail, DollarSign, PieChart, Repeat, PackageX, FileText, CheckSquare,
  LineChart, Crown, Truck,
} from 'lucide-react';

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await requireUserContext(request);
  const user = ctx.user;
  const stores = await db.storeConnection.findMany({
    where: { userId: ctx.effectiveOwnerId },
    select: { id: true, name: true, platform: true },
    orderBy: { createdAt: 'asc' },
  });
  const sub = await db.subscription.findUnique({ where: { userId: ctx.effectiveOwnerId } });
  const plan = sub?.plan || 'FREE';

  // Trial days remaining
  let trialDaysLeft: number | null = null;
  if (sub?.trialEndsAt) {
    trialDaysLeft = Math.max(0, Math.ceil((new Date(sub.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
  }

  // AI messages used this month
  const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0,0,0,0);
  const aiUsed = stores.length > 0 ? await db.aiReport.count({
    where: { storeConnection: { userId: ctx.effectiveOwnerId }, type: 'ADVISOR', createdAt: { gte: startOfMonth } },
  }) : 0;

  // Last sync time - use storeConnection.lastSyncAt for consistency
  let lastSync: string | null = null;
  if (stores.length > 0) {
    const storeForSync = await db.storeConnection.findFirst({
      where: { userId: ctx.effectiveOwnerId },
      orderBy: { lastSyncAt: 'desc' },
      select: { lastSyncAt: true },
    });
    if (storeForSync?.lastSyncAt) lastSync = storeForSync.lastSyncAt.toISOString();
  }
  return json({
    user: { id: user.id, fullName: user.fullName, email: user.email, company: user.company, isSuperAdmin: (user as any).isSuperAdmin || false },
    role: ctx.role,
    isOwner: ctx.isOwner,
    stores,
    plan,
    trialDaysLeft,
    aiUsed,
    lastSync,
  });
}

type NavRole = 'owner' | 'admin' | 'analyst' | 'viewer';

interface NavItem {
  to: string;
  label: string;
  icon: React.ElementType;
  badge?: number;
  roles?: NavRole[]; // when set, only visible if user.role is in list. Omitted => visible to all.
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const NAV: NavSection[] = [
  {
    label: 'Principal',
    items: [
      { to: '/dashboard', label: 'Today', icon: LayoutGrid },
      { to: '/ai-advisor', label: 'AI Advisor', icon: Bot },
      { to: '/ask-ai', label: 'Ask AI', icon: Zap, roles: ['owner', 'admin', 'analyst'] },

      { to: '/stock', label: 'Smart Alerts', icon: AlertTriangle },
    ],
  },
  {
    label: 'Reports',
    items: [
      { to: '/statistics', label: 'Statistici', icon: LineChart },
      { to: '/analytics', label: 'Revenue', icon: BarChart3 },
      { to: '/rfm', label: 'RFM Segments', icon: Grid3x3 },
      { to: '/cohorts', label: 'Cohorts', icon: CalendarDays },
      { to: '/ltv', label: 'LTV Analytics', icon: TrendingUp },
      { to: '/churn', label: 'Churn Prediction', icon: UserMinus },
      { to: '/bcg', label: 'Product Matrix', icon: Package },
      { to: '/basket', label: 'Cross-sell', icon: Grid3x3 },
      { to: '/discounts', label: 'Discount Impact', icon: Percent },
      { to: '/refunds', label: 'Refund Analytics', icon: Undo2 },
      { to: '/margin', label: 'Profit Margin', icon: DollarSign },
      { to: '/profitability', label: 'Profitability', icon: PieChart },
      { to: '/repeat', label: 'Repeat Purchase', icon: Repeat },
      { to: '/stockout', label: 'Stockout Detection', icon: PackageX },
      { to: '/shares', label: 'Rapoarte partajate', icon: Share2, roles: ['owner', 'admin', 'analyst'] },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/turnover', label: 'Inventory', icon: Archive },
      { to: '/fulfilment', label: 'Time to Fulfilment', icon: Clock },
      { to: '/peaks', label: 'Peak Hours', icon: Activity },
      { to: '/courier', label: 'Courier Tracking', icon: Truck },
    ],
  },
  {
    label: 'Ads',
    items: [
      { to: '/ads', label: 'Ads & Acquisition', icon: Megaphone },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { to: '/forecast', label: 'Revenue Forecast', icon: TrendingUp },
      { to: '/anomalies', label: 'Anomaly Detection', icon: AlertCircle },
      { to: '/compare', label: 'Period Compare', icon: SplitSquareHorizontal },
      { to: '/goals', label: 'Goal Tracker', icon: Target },
      { to: '/narrative', label: 'AI Narrative', icon: FileText },
      { to: '/digest', label: 'Email Digest', icon: Mail, roles: ['owner', 'admin'] },
      { to: '/actions', label: 'Action Items', icon: CheckSquare, roles: ['owner', 'admin'] },
      { to: '/annotations', label: 'Annotations', icon: StickyNote, roles: ['owner', 'admin', 'analyst'] },
      { to: '/scale', label: 'Scale Analysis', icon: Gauge },
    ],
  },
  {
    label: 'Account',
    items: [
      { to: '/stores', label: 'Magazine', icon: Store },
      { to: '/team', label: 'Echipa', icon: UsersRound },
      { to: '/settings', label: 'Setari', icon: Settings },
      { to: '/pricing-analysis', label: 'Abonament', icon: CreditCard, roles: ['owner'] },
      { to: '/audit', label: 'BI Audit', icon: HeartPulse },
      { to: '/data-health', label: 'Data Health', icon: ShieldCheck },
    ],
  },
];

const ROLE_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  owner:   { label: 'Owner',   bg: 'rgba(124,58,237,0.12)', color: '#7c3aed' },
  admin:   { label: 'Admin',   bg: 'rgba(216,90,48,0.12)',  color: '#A33D14' },
  analyst: { label: 'Analyst', bg: 'rgba(3,105,161,0.12)',  color: '#0A4F76' },
  viewer:  { label: 'Viewer',  bg: 'rgba(95,94,90,0.12)',   color: '#525252' },
};

export default function AppLayout() {
  const { user, role, isOwner, stores, plan, trialDaysLeft, aiUsed, lastSync } = useLoaderData<typeof loader>();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const initials = getInitials(user.fullName);
  const avatarColor = getAvatarColor(user.id);

  // Active store: read from URL ?store=ID, fallback to first store
  const storeIdFromUrl = searchParams.get('store');
  const activeStore = stores.find((s) => s.id === storeIdFromUrl) || stores[0];

  const isActive = (to: string) => location.pathname === to || location.pathname.startsWith(to + '/');

  const switchStore = (storeId: string) => {
    const params = new URLSearchParams(location.search);
    params.set('store', storeId);
    // Navigate to same path with new store param. Other params (filters etc.) preserved.
    navigate(`${location.pathname}?${params.toString()}`);
  };

  return (
    <div className="app-layout">
      {/* Mobile header */}
      <div className="mobile-header">
        <button
          className="mobile-menu-btn"
          onClick={() => setSidebarOpen(true)}
          aria-label="Deschide meniu"
        >
          <Menu size={18} />
        </button>
        <span style={{ fontSize: 14, fontWeight: 500 }}>
          <img src="/logo-kimono-bi.svg" alt="Kimono BI" style={{ height: 24, width: 'auto' }} />
        </span>
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="mobile-overlay open"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        {/* Logo */}
        <Link to={activeStore ? `/dashboard?store=${activeStore.id}` : "/dashboard"} style={{ textDecoration: "none", display: "block" }}>
        <div className="sidebar-logo">
          <div className="sidebar-logo-inner">
            <img src="/logo-kimono-bi.svg" alt="Kimono BI" style={{ height: 32, width: 'auto' }} />
            {sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(false)}
                style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}
                aria-label="Inchide meniu"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>
        </Link>

        {/* Store switcher — functional dropdown */}
        {activeStore && (
          <div className="sidebar-store" style={{ position: 'relative' }}>
            <div className="sidebar-store-icon" style={{ padding: 0, overflow: 'hidden' }}>
              {activeStore.platform === 'SHOPIFY' ? (
                <img src="/shopify-icon.svg" alt="Shopify" style={{ width: 20, height: 20 }} />
              ) : activeStore.platform === 'WOOCOMMERCE' ? (
                <img src="/woocommerce-icon.svg" alt="WooCommerce" style={{ width: 20, height: 20 }} />
              ) : (
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--kimono-orange)' }}>{activeStore.name.charAt(0).toUpperCase()}</span>
              )}
            </div>
            <span className="sidebar-store-name" style={{ flex: 1 }}>{activeStore.name}</span>
            <Link to="/stores/new" title="Adauga magazin nou" style={{
              width: 20, height: 20, borderRadius: 5, position: 'relative', zIndex: 2,
              background: 'var(--kimono-orange)', textDecoration: 'none', flexShrink: 0,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="white" strokeWidth="2" strokeLinecap="round"/></svg>
            </Link>
            {stores.length > 1 && (
              <>
                <ChevronDown size={12} className="sidebar-store-chevron" />
                <select
                  value={activeStore.id}
                  onChange={(e) => switchStore(e.target.value)}
                  aria-label="Schimbă magazinul"
                  style={{
                    position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer',
                    border: 'none', appearance: 'none', WebkitAppearance: 'none', background: 'transparent',
                    width: '100%', height: '100%',
                  }}
                >
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </>
            )}
          </div>
        )}

        {!activeStore && (role === 'owner' || role === 'admin') && (
          <div style={{ margin: '0 10px 8px' }}>
            <Link
              to="/stores/new"
              className="btn btn-primary btn-full"
              style={{ fontSize: 11, padding: '7px 12px' }}
            >
              + Conecteaza magazin
            </Link>
          </div>
        )}
        {!activeStore && role !== 'owner' && role !== 'admin' && (
          <div style={{ margin: '0 10px 8px', padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: 8, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
            Echipa nu are încă un magazin conectat. Doar Owner-ul sau un Admin poate adăuga unul.
          </div>

        )}

        {/* Navigation */}
        <nav className="sidebar-nav">
          {NAV.map((section) => {
            const allowedModules = getPlanModules(plan);
            // Until the team has at least one store connected, only setup-related items make sense.
            // The data modules would all be empty, so we hide them to reduce clutter for new accounts.
            const noStoresWhitelist = ['/stores', '/team', '/settings', '/pricing-analysis'];
            const filteredItems = section.items.filter((item) => {
              // No stores yet: show only setup essentials
              if (stores.length === 0 && !noStoresWhitelist.includes(item.to)) return false;
              // Plan gate
              const route = item.to.replace('/', '');
              const planAllowed = ALWAYS_ALLOWED.includes(route) || allowedModules.includes(route);
              if (!planAllowed) return false;
              // Role gate (when set)
              if (item.roles && !item.roles.includes(role as NavRole)) return false;
              return true;
            });
            if (filteredItems.length === 0) return null;
            return (
            <div key={section.label}>
              <div className="sidebar-section-label">{section.label}</div>
              {filteredItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.to);
                return (
                  <Link
                    key={item.to}
                    to={activeStore ? `${item.to}?store=${activeStore.id}` : item.to}
                    className={`sidebar-item${active ? ' active' : ''}`}
                    onClick={() => setSidebarOpen(false)}
                  >
                    <span className="sidebar-item-icon">
                      <Icon size={14} strokeWidth={1.8} />
                    </span>
                    <span className="sidebar-item-label">{item.label}</span>
                    {item.badge != null && item.badge > 0 && (
                      <span className="sidebar-item-badge">{item.badge}</span>
                    )}
                  </Link>
                );
              })}
            </div>
            );
          })}
        </nav>

        {/* Plan & Usage */}
        <div style={{ padding: '0 10px 8px', marginTop: 'auto' }}>
          {/* Plan badge + trial */}
          <div style={{ background: 'var(--bg-tertiary)', borderRadius: 8, padding: '10px 12px', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: trialDaysLeft !== null && trialDaysLeft !== undefined ? 6 : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: (PLAN_LIMITS[plan] || PLAN_LIMITS.FREE).color }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: (PLAN_LIMITS[plan] || PLAN_LIMITS.FREE).color }}>
                  {(PLAN_LIMITS[plan] || PLAN_LIMITS.FREE).label}
                </span>
              </div>
              {trialDaysLeft !== null && trialDaysLeft !== undefined && (
                <span style={{ fontSize: 10, color: trialDaysLeft <= 3 ? '#dc2626' : 'var(--text-tertiary)' }}>
                  {trialDaysLeft > 0 ? `${trialDaysLeft} zile rămase` : 'Trial expirat'}
                </span>
              )}
            </div>
            {trialDaysLeft !== null && trialDaysLeft !== undefined && trialDaysLeft > 0 && (
              <div style={{ height: 3, background: 'var(--border-default)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.max(2, ((14 - trialDaysLeft) / 14) * 100)}%`, background: trialDaysLeft <= 3 ? '#dc2626' : (PLAN_LIMITS[plan] || PLAN_LIMITS.FREE).color, borderRadius: 2, transition: 'width 0.3s' }} />
              </div>
            )}
          </div>

          {/* AI usage */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', fontSize: 10, color: 'var(--text-tertiary)' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            {(PLAN_LIMITS[plan] || PLAN_LIMITS.FREE).aiMessages === -1
              ? <span>Ask AI: <strong style={{ color: 'var(--text-secondary)' }}>{aiUsed}</strong> mesaje luna asta</span>
              : <span>Ask AI: <strong style={{ color: 'var(--text-secondary)' }}>{aiUsed}/{(PLAN_LIMITS[plan] || PLAN_LIMITS.FREE).aiMessages}</strong></span>
            }
          </div>

          {/* Last sync */}
          {lastSync && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px 6px', fontSize: 10, color: 'var(--text-tertiary)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              <span>Sync: {(() => {
                const diff = Math.floor((Date.now() - new Date(lastSync).getTime()) / 60000);
                if (diff < 1) return 'acum';
                if (diff < 60) return `acum ${diff} min`;
                if (diff < 1440) return `acum ${Math.floor(diff / 60)} ore`;
                return `acum ${Math.floor(diff / 1440)} zile`;
              })()}</span>
            </div>
          )}
        </div>

        {/* User footer */}
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className={`avatar avatar-${avatarColor}`} style={{ width: 28, height: 28, fontSize: 11 }}>
              {initials}
            </div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.fullName}</span>
                {role && (
                  <span style={{
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: '0.4px',
                    textTransform: 'uppercase',
                    padding: '2px 6px',
                    borderRadius: 99,
                    background: ROLE_BADGE[role]?.bg || ROLE_BADGE.viewer.bg,
                    color: ROLE_BADGE[role]?.color || ROLE_BADGE.viewer.color,
                    flexShrink: 0,
                  }}>
                    {ROLE_BADGE[role]?.label || role}
                  </span>
                )}
              </div>
              <div className="sidebar-user-email">{user.company || user.email}</div>
            </div>
          </div>
          <Form method="post" action="/logout">
            <button type="submit" className="sidebar-logout">
              <LogOut size={13} strokeWidth={1.8} />
              Deconectare
            </button>
          </Form>
        </div>
      </aside>

      {/* Main content */}
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
