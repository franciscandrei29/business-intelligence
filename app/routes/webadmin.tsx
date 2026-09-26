import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { Form, Link, Outlet, useLoaderData, useLocation } from '@remix-run/react';
import { Crown, LogOut, LayoutDashboard, Users, Store, CreditCard, Bot, MessageSquare, Activity, Shield, Clock, Mail, Cpu, HeartPulse, ChevronRight, BarChart3, Filter as Funnel, Bell, Zap, ToggleLeft } from 'lucide-react';
import { getUserFromRequest } from '~/lib/auth/session.server';

export const meta: MetaFunction = () => [{ title: 'Web Admin · Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) throw redirect('/webadmin/login');
  if (!(user as any).isSuperAdmin) throw redirect('/webadmin/login?error=not_authorized');
  return json({ user: { email: user.email, fullName: user.fullName } });
}

const NAV = [
  { section: 'Dashboard', items: [
    { key: 'kpis', label: 'Overview', icon: LayoutDashboard },
  ]},
  { section: 'Management', items: [
    { key: 'users', label: 'Utilizatori', icon: Users },
    { key: 'stores', label: 'Magazine', icon: Store },
    { key: 'stripe', label: 'Stripe & Billing', icon: CreditCard },
  ]},
  { section: 'AI & Insights', items: [
    { key: 'ai', label: 'AI Usage', icon: Bot },
    { key: 'askai', label: 'Ask AI Questions', icon: MessageSquare },
  ]},
  { section: 'Analytics', items: [
    { key: 'revenue', label: 'Revenue & MRR', icon: BarChart3 },
    { key: 'funnel', label: 'User Funnel', icon: Funnel },
  ]},
  { section: 'Operations', items: [
    { key: 'alerts', label: 'Alerte', icon: Bell },
    { key: 'actions', label: 'Quick Actions', icon: Zap },
    { key: 'flags', label: 'Feature Flags', icon: ToggleLeft },
  ]},
  { section: 'Monitoring', items: [
    { key: 'activity', label: 'Activity Feed', icon: Activity },
    { key: 'audit', label: 'Audit Log', icon: Shield },
    { key: 'cron', label: 'Cron Runs', icon: Clock },
    { key: 'email', label: 'Email Delivery', icon: Mail },
    { key: 'pm2', label: 'PM2 Processes', icon: Cpu },
    { key: 'health', label: 'System Health', icon: HeartPulse },
  ]},
];

export default function WebadminLayout() {
  const { user } = useLoaderData<typeof loader>();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const activeTab = params.get('tab') || 'kpis';

  const activeLabel = NAV.flatMap(s => s.items).find(i => i.key === activeTab)?.label || 'Overview';

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0B0E14' }}>

      {/* Sidebar */}
      <aside style={{
        width: 260, minHeight: '100vh', background: '#0F1318',
        borderRight: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', flexDirection: 'column',
        position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 50,
      }}>
        {/* Logo */}
        <div style={{
          padding: '20px 20px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          <Link to="/webadmin" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 12 }}>
            <img src="/favicon.svg" alt="" style={{ width: 36, height: 36, borderRadius: 10 }} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', letterSpacing: '-0.3px' }}>
                Kimono <span style={{ color: '#FF5A1F' }}>BI</span>
              </div>
              <div style={{ fontSize: 10, color: '#FF8A50', letterSpacing: '1.5px', textTransform: 'uppercase', fontWeight: 600, marginTop: 1 }}>
                Webadmin
              </div>
            </div>
          </Link>
        </div>

        {/* Navigation */}
        <nav style={{ flex: 1, padding: '12px 10px', overflowY: 'auto' }}>
          {NAV.map((section) => (
            <div key={section.section} style={{ marginBottom: 20 }}>
              <div style={{
                fontSize: 10, fontWeight: 600, color: '#555', letterSpacing: '1.2px',
                textTransform: 'uppercase', padding: '0 10px', marginBottom: 6,
              }}>
                {section.section}
              </div>
              {section.items.map((item) => {
                const isActive = activeTab === item.key;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.key}
                    to={`/webadmin?tab=${item.key}`}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '9px 12px', borderRadius: 8, marginBottom: 2,
                      textDecoration: 'none', fontSize: 13, fontWeight: isActive ? 600 : 400,
                      color: isActive ? '#fff' : '#999',
                      background: isActive ? 'rgba(255,90,31,0.12)' : 'transparent',
                      transition: 'all 0.15s',
                    }}
                  >
                    <Icon size={16} color={isActive ? '#FF5A1F' : '#666'} style={{ flexShrink: 0 }} />
                    <span style={{ flex: 1 }}>{item.label}</span>
                    {isActive && <ChevronRight size={12} color="#FF5A1F" />}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* User + Logout */}
        <div style={{
          padding: '16px 14px', borderTop: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: 'linear-gradient(135deg, #FF5A1F, #FF8A50)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, color: '#fff',
            }}>
              {user.fullName?.charAt(0)?.toUpperCase() || user.email.charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.fullName || 'Admin'}
              </div>
              <div style={{ fontSize: 10, color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.email}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Link to="/dashboard" style={{
              flex: 1, padding: '7px 0', borderRadius: 6,
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
              color: '#888', fontSize: 11, fontWeight: 500, textDecoration: 'none',
              textAlign: 'center', transition: 'all 0.15s',
            }}>
              Platforma
            </Link>
            <Form action="/logout" method="post" style={{ flex: 1 }}>
              <button type="submit" style={{
                width: '100%', padding: '7px 0', borderRadius: 6,
                background: 'rgba(255,70,70,0.08)', border: '1px solid rgba(255,70,70,0.15)',
                color: '#e55', fontSize: 11, fontWeight: 500, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              }}>
                <LogOut size={11} /> Logout
              </button>
            </Form>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div style={{ flex: 1, marginLeft: 260 }}>
        {/* Top bar */}
        <header style={{
          padding: '18px 28px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          background: '#0F1318',
          position: 'sticky', top: 0, zIndex: 40,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: '#fff', margin: 0, letterSpacing: '-0.3px' }}>
              {activeLabel}
            </h1>
            <p style={{ fontSize: 11, color: '#666', margin: '2px 0 0' }}>
              Super-Admin Console
            </p>
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '4px 12px', borderRadius: 20,
            background: 'rgba(255,90,31,0.08)', border: '1px solid rgba(255,90,31,0.15)',
          }}>
            <Crown size={12} color="#FF5A1F" />
            <span style={{ fontSize: 11, color: '#FF8A50', fontWeight: 600 }}>Super Admin</span>
          </div>
        </header>

        {/* Page content */}
        <main style={{ padding: '24px 28px' }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
