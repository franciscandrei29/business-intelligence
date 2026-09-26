import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { Form, Link, useLoaderData, useSearchParams } from '@remix-run/react';
import { requireUser } from '~/lib/auth/requireAuth.server';
import { getTokens, saveTokens, removeTokens, listProperties, fetchAnalytics } from '~/lib/ga/index';
import { BarChart3, ExternalLink, Unplug, RefreshCw, Users, Eye, MousePointerClick, Timer, ArrowUpDown, ShoppingCart, TrendingUp } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Google Analytics — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const daysParam = url.searchParams.get('days');
  const days = daysParam ? parseInt(daysParam) : 30;

  const tokens = getTokens(user.id);
  const isConnected = !!tokens;
  const hasProperty = !!tokens?.propertyId;

  let properties: Array<{id: string, name: string}> = [];
  let analytics = null;
  let propertyName = '';

  if (isConnected && !hasProperty) {
    properties = await listProperties(user.id);
  }

  if (isConnected && hasProperty) {
    analytics = await fetchAnalytics(user.id, days);
    // Try to get property name
    const props = await listProperties(user.id);
    const found = props.find(p => p.id === tokens.propertyId);
    if (found) propertyName = found.name;
  }

  return json({
    isConnected,
    hasProperty,
    properties,
    analytics,
    propertyId: tokens?.propertyId || null,
    propertyName,
    days,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  const intent = form.get('intent');

  if (intent === 'selectProperty') {
    const propertyId = form.get('propertyId') as string;
    if (propertyId) {
      const tokens = getTokens(user.id);
      if (tokens) {
        saveTokens(user.id, tokens, propertyId);
      }
    }
    return redirect('/analytics');
  }

  if (intent === 'disconnect') {
    removeTokens(user.id);
    return redirect('/analytics');
  }

  return json({ error: 'Unknown intent' }, { status: 400 });
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function formatDate(dateStr: string): string {
  if (dateStr.length !== 8) return dateStr;
  return `${dateStr.slice(6, 8)}/${dateStr.slice(4, 6)}`;
}

export default function AnalyticsPage() {
  const { isConnected, hasProperty, properties, analytics, propertyId, propertyName, days } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  // Not connected state
  if (!isConnected) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Google Analytics</h1>
          <p className="page-subtitle">Conecteaza contul Google Analytics 4 pentru a vedea traficul magazinului</p>
        </div>

        <div className="info-box">
          <p>
            Google Analytics iti arata traficul real al magazinului: cate sesiuni, de unde vin vizitatorii, ce pagini convertesc cel mai bine. Conversion Rate masoara procentul de vizitatori care cumpara. Landing pages cu bounce rate mare (&gt;70%) au nevoie de imbunatatire. Conecteaza contul Google Analytics cu un click.
          </p>
        </div>

        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
          <BarChart3 size={48} style={{ color: 'var(--color-primary)', marginBottom: 'var(--space-md)' }} />
          <h2 style={{ color: 'var(--color-text-heading)', marginBottom: 'var(--space-sm)' }}>Conecteaza Google Analytics
          </h2>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-lg)', maxWidth: 500, margin: '0 auto var(--space-lg)' }}>
            Autorizeaza accesul la datele Google Analytics 4 pentru a vedea sesiuni, utilizatori, surse de trafic si conversii direct in Kimono BI.
          </p>
          <a href="/api/auth/google" className="btn btn-primary" style={{ fontSize: '1rem', padding: 'var(--space-sm) var(--space-xl)' }}>
            <ExternalLink size={18} />
            Conecteaza Google Analytics
          </a>
        </div>
      </div>
    );
  }

  // Connected but no property selected
  if (!hasProperty) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Google Analytics</h1>
          <p className="page-subtitle">Selecteaza proprietatea GA4</p>
        </div>

        <div className="card" style={{ marginBottom: 'var(--space-md)', background: 'rgba(46, 204, 113, 0.08)', border: '1px solid rgba(46, 204, 113, 0.2)' }}>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', margin: 0 }}>
            Cont Google conectat cu succes! Selecteaza proprietatea GA4 de mai jos.
          </p>
        </div>

        {properties.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-md)' }}>
              Nu s-au gasit proprietati GA4 in contul tau. Verifica ca ai cel putin o proprietate Google Analytics 4 activa.
            </p>
            <Form method="post">
              <input type="hidden" name="intent" value="disconnect" />
              <button type="submit" className="btn btn-secondary">
                <Unplug size={16} />
                Deconecteaza
              </button>
            </Form>
          </div>
        ) : (
          <div className="card">
            <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>
              Proprietati disponibile
            </h3>
            <Form method="post">
              <input type="hidden" name="intent" value="selectProperty" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
                {properties.map((prop) => (
                  <label
                    key={prop.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-sm)',
                      padding: 'var(--space-sm) var(--space-md)',
                      background: 'var(--color-bg)',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                    }}
                  >
                    <input type="radio" name="propertyId" value={prop.id} required />
                    <span style={{ color: 'var(--color-text)' }}>{prop.name}</span>
                    <span style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>ID: {prop.id}</span>
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                <button type="submit" className="btn btn-primary">Selecteaza</button>
                <Form method="post" style={{ display: 'inline' }}>
                  <input type="hidden" name="intent" value="disconnect" />
                  <button type="submit" className="btn btn-secondary">
                    <Unplug size={16} />
                    Deconecteaza
                  </button>
                </Form>
              </div>
            </Form>
          </div>
        )}
      </div>
    );
  }

  // Full analytics dashboard
  const o = analytics?.overview;
  const conversionRate = o && o.sessions > 0 ? Math.round((o.conversions / o.sessions) * 1000) / 10 : 0;

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
        <div>
          <h1 className="page-title">Google Analytics</h1>
          <p className="page-subtitle">{propertyName || `Property ${propertyId}`}</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              className={`btn ${days === d ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '0.8125rem' }}
              onClick={() => setSearchParams({ days: String(d) })}
            >
              {d} zile
            </button>
          ))}
          <Form method="post" style={{ display: 'inline' }}>
            <input type="hidden" name="intent" value="disconnect" />
            <button type="submit" className="btn btn-secondary" style={{ fontSize: '0.8125rem' }} title="Deconecteaza Google Analytics">
              <Unplug size={14} />
              Deconecteaza
            </button>
          </Form>
        </div>
      </div>

      <div className="info-box">
        <p>
          Google Analytics iti arata traficul real al magazinului: cate sesiuni, de unde vin vizitatorii, ce pagini convertesc cel mai bine. Conversion Rate masoara procentul de vizitatori care cumpara. Landing pages cu bounce rate mare (&gt;70%) au nevoie de imbunatatire. Conecteaza contul Google Analytics cu un click.
        </p>
      </div>

      {!analytics ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
          <p style={{ color: 'var(--color-text-muted)' }}>Nu s-au putut incarca datele analytics. Verifica conexiunea sau incearca din nou.</p>
        </div>
      ) : (
        <>
          {/* Overview KPI Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
                <Eye size={18} style={{ color: 'var(--color-primary)' }} />
                <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>Sesiuni</span>
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>
                {o!.sessions.toLocaleString('ro-RO')}
              </div>
            </div>

            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
                <Users size={18} style={{ color: 'var(--color-info)' }} />
                <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>Utilizatori</span>
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>
                {o!.users.toLocaleString('ro-RO')}
              </div>
            </div>

            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
                <Users size={18} style={{ color: 'var(--color-success)' }} />
                <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>Utilizatori noi</span>
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>
                {o!.newUsers.toLocaleString('ro-RO')}
              </div>
            </div>

            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
                <ArrowUpDown size={18} style={{ color: o!.bounceRate > 70 ? 'var(--color-danger)' : 'var(--color-success)' }} />
                <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>Bounce Rate</span>
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: o!.bounceRate > 70 ? 'var(--color-danger)' : 'var(--color-text-heading)' }}>
                {o!.bounceRate}%
              </div>
            </div>

            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
                <Timer size={18} style={{ color: 'var(--color-warning)' }} />
                <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>Durata medie</span>
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>
                {formatDuration(o!.avgSessionDuration)}
              </div>
            </div>

            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
                <Eye size={18} style={{ color: 'var(--color-primary)' }} />
                <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>Page Views</span>
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>
                {o!.pageViews.toLocaleString('ro-RO')}
              </div>
            </div>

            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
                <MousePointerClick size={18} style={{ color: 'var(--color-success)' }} />
                <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>Conversii</span>
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>
                {o!.conversions.toLocaleString('ro-RO')}
              </div>
            </div>

            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
                <ShoppingCart size={18} style={{ color: 'var(--color-info)' }} />
                <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>Achizitii</span>
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>
                {o!.purchases.toLocaleString('ro-RO')}
              </div>
            </div>

            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
                <TrendingUp size={18} style={{ color: conversionRate >= 3 ? 'var(--color-success)' : 'var(--color-warning)' }} />
                <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>Conversion Rate</span>
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: conversionRate >= 3 ? 'var(--color-success)' : 'var(--color-text-heading)' }}>
                {conversionRate}%
              </div>
            </div>
          </div>

          {/* Daily sessions chart */}
          {analytics.daily.length > 0 && (
            <div className="card" style={{ marginBottom: 'var(--space-xl)' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>
                Sesiuni zilnice
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
                {analytics.daily.map((d: any) => {
                  const maxSessions = Math.max(...analytics.daily.map((r: any) => r.sessions));
                  const pct = maxSessions > 0 ? (d.sessions / maxSessions) * 100 : 0;
                  return (
                    <div key={d.date} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                      <span style={{ width: 50, fontSize: '0.6875rem', color: 'var(--color-text-muted)', flexShrink: 0 }}>
                        {formatDate(d.date)}
                      </span>
                      <div style={{ flex: 1, height: 18, background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--color-primary)', borderRadius: 'var(--radius-sm)', transition: 'width 0.3s' }} />
                      </div>
                      <span style={{ width: 55, fontSize: '0.6875rem', color: 'var(--color-text)', textAlign: 'right', flexShrink: 0 }}>
                        {d.sessions.toLocaleString('ro-RO')}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
            {/* Landing Pages Table */}
            <div className="card" style={{ overflow: 'auto' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>
                Top Landing Pages
              </h3>
              {analytics.landingPages.length === 0 ? (
                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>Nu exista date.</p>
              ) : (
                <table className="data-table" style={{ width: '100%', fontSize: '0.8125rem' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: 'var(--space-xs) var(--space-sm)', color: 'var(--color-text-muted)', fontWeight: 500 }}>Pagina</th>
                      <th style={{ textAlign: 'right', padding: 'var(--space-xs) var(--space-sm)', color: 'var(--color-text-muted)', fontWeight: 500 }}>Sesiuni</th>
                      <th style={{ textAlign: 'right', padding: 'var(--space-xs) var(--space-sm)', color: 'var(--color-text-muted)', fontWeight: 500 }}>Conv</th>
                      <th style={{ textAlign: 'right', padding: 'var(--space-xs) var(--space-sm)', color: 'var(--color-text-muted)', fontWeight: 500 }}>Conv%</th>
                      <th style={{ textAlign: 'right', padding: 'var(--space-xs) var(--space-sm)', color: 'var(--color-text-muted)', fontWeight: 500 }}>Bounce</th>
                      <th style={{ textAlign: 'right', padding: 'var(--space-xs) var(--space-sm)', color: 'var(--color-text-muted)', fontWeight: 500 }}>Durata</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.landingPages.map((lp: any, i: number) => (
                      <tr key={i}>
                        <td style={{ padding: 'var(--space-xs) var(--space-sm)', color: 'var(--color-text)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={lp.page}>
                          {lp.page}
                        </td>
                        <td style={{ padding: 'var(--space-xs) var(--space-sm)', textAlign: 'right', color: 'var(--color-text)' }}>
                          {lp.sessions.toLocaleString('ro-RO')}
                        </td>
                        <td style={{ padding: 'var(--space-xs) var(--space-sm)', textAlign: 'right', color: 'var(--color-text)' }}>
                          {lp.conversions}
                        </td>
                        <td style={{ padding: 'var(--space-xs) var(--space-sm)', textAlign: 'right', color: lp.conversionRate > 3 ? 'var(--color-success)' : 'var(--color-text)' }}>
                          {lp.conversionRate}%
                        </td>
                        <td style={{ padding: 'var(--space-xs) var(--space-sm)', textAlign: 'right', color: lp.bounceRate > 70 ? 'var(--color-danger)' : 'var(--color-text)' }}>
                          {lp.bounceRate}%
                        </td>
                        <td style={{ padding: 'var(--space-xs) var(--space-sm)', textAlign: 'right', color: 'var(--color-text-muted)' }}>
                          {formatDuration(lp.avgDuration)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Traffic Sources Table */}
            <div className="card" style={{ overflow: 'auto' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>
                Surse de trafic
              </h3>
              {analytics.traffic.length === 0 ? (
                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>Nu exista date.</p>
              ) : (
                <table className="data-table" style={{ width: '100%', fontSize: '0.8125rem' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: 'var(--space-xs) var(--space-sm)', color: 'var(--color-text-muted)', fontWeight: 500 }}>Sursa / Medium</th>
                      <th style={{ textAlign: 'right', padding: 'var(--space-xs) var(--space-sm)', color: 'var(--color-text-muted)', fontWeight: 500 }}>Sesiuni</th>
                      <th style={{ textAlign: 'right', padding: 'var(--space-xs) var(--space-sm)', color: 'var(--color-text-muted)', fontWeight: 500 }}>Utilizatori</th>
                      <th style={{ textAlign: 'right', padding: 'var(--space-xs) var(--space-sm)', color: 'var(--color-text-muted)', fontWeight: 500 }}>Conv</th>
                      <th style={{ textAlign: 'right', padding: 'var(--space-xs) var(--space-sm)', color: 'var(--color-text-muted)', fontWeight: 500 }}>Bounce</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.traffic.map((t: any, i: number) => (
                      <tr key={i}>
                        <td style={{ padding: 'var(--space-xs) var(--space-sm)', color: 'var(--color-text)' }}>
                          {t.sourceMedium}
                        </td>
                        <td style={{ padding: 'var(--space-xs) var(--space-sm)', textAlign: 'right', color: 'var(--color-text)' }}>
                          {t.sessions.toLocaleString('ro-RO')}
                        </td>
                        <td style={{ padding: 'var(--space-xs) var(--space-sm)', textAlign: 'right', color: 'var(--color-text)' }}>
                          {t.users.toLocaleString('ro-RO')}
                        </td>
                        <td style={{ padding: 'var(--space-xs) var(--space-sm)', textAlign: 'right', color: 'var(--color-text)' }}>
                          {t.conversions}
                        </td>
                        <td style={{ padding: 'var(--space-xs) var(--space-sm)', textAlign: 'right', color: t.bounceRate > 70 ? 'var(--color-danger)' : 'var(--color-text)' }}>
                          {t.bounceRate}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
