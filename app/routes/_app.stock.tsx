import { useState } from 'react';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Form, useLoaderData, useNavigation, useSearchParams } from '@remix-run/react';
import { requireUser, requireUserContext } from '~/lib/auth/requireAuth.server';
import { requireModule } from '~/lib/plans.server';
import { db } from '~/lib/db.server';
import { calculateStockAlerts } from '~/lib/stock/index';
import { formatNumber } from '~/lib/utils';
import { RefreshCw, AlertTriangle, CheckCircle, AlertOctagon, Clock, Eye } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Smart Alerts — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await requireUserContext(request);
  const user = ctx.user;
  await requireModule(request, ctx.effectiveOwnerId, 'stock');
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');

  const stores = await db.storeConnection.findMany({
    where: { userId: ctx.effectiveOwnerId },
    select: { id: true, name: true },
  });

  const selectedStoreId = storeId || stores[0]?.id;
  if (!selectedStoreId) return json({ stores, alerts: [], selectedStoreId: null });

  const alerts = await db.stockAlert.findMany({
    where: { storeConnectionId: selectedStoreId },
    orderBy: [{ severity: 'asc' }, { daysRemaining: 'asc' }],
  });

  return json({ stores, alerts, selectedStoreId });
}

export async function action({ request }: ActionFunctionArgs) {
  const ctx = await requireUserContext(request);
  const user = ctx.user;
  const form = await request.formData();
  const storeId = String(form.get('storeId'));
  const store = await db.storeConnection.findFirst({ where: { id: storeId, userId: ctx.effectiveOwnerId } });
  if (!store) return json({ error: 'Store not found' }, { status: 404 });
  await calculateStockAlerts(storeId);
  return json({ success: true });
}

interface Alert {
  productTitle: string;
  currentStock: number;
  velocityPerDay: number;
  daysRemaining: number;
  severity: string;
}

type TabKey = 'stockout' | 'risk' | 'monitor';

const TABS: { key: TabKey; label: string; icon: any; color: string; desc: string }[] = [
  { key: 'stockout', label: 'Stockout activ', icon: AlertOctagon, color: '#dc2626', desc: 'Stoc epuizat și vânzări >0.5/zi — pierdere activă de venituri' },
  { key: 'risk', label: 'Fără stoc', icon: Clock, color: '#d97706', desc: 'Stoc 0, cerere mică în zilele următoare — reaprovizionează acum' },
  { key: 'monitor', label: 'Stoc în scădere', icon: Eye, color: '#0369a1', desc: 'Au stoc dar se epuizează dar constantă — reaprovizionare recomandată' },
];

function categorize(a: Alert): TabKey {
  if (a.currentStock <= 0 && a.velocityPerDay >= 0.5) return 'stockout';
  if (a.currentStock <= 0 && a.velocityPerDay >= 0.1) return 'risk'; // stoc 0, cerere mica
  if (a.currentStock > 0 && a.velocityPerDay >= 0.1) return 'monitor'; // are stoc, se epuizeaza
  return 'monitor';
}

export default function StockPage() {
  const { stores, alerts, selectedStoreId } = useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const isCalculating = navigation.state === 'submitting';
  const [activeTab, setActiveTab] = useState<TabKey>('stockout');
  const [sortCol, setSortCol] = useState<'velocity' | 'loss' | 'days'>('velocity');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');

  const toggleSort = (col: 'velocity' | 'loss' | 'days') => {
    if (sortCol === col) setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    else { setSortCol(col); setSortDir('desc'); }
  };

  // Filter out velocity < 0.1
  const relevant = (alerts as Alert[]).filter(a => a.velocityPerDay >= 0.1);
  const stockout = relevant.filter(a => categorize(a) === 'stockout');
  const risk = relevant.filter(a => categorize(a) === 'risk');
  const monitor = relevant.filter(a => categorize(a) === 'monitor');

  const tabData: Record<TabKey, Alert[]> = { stockout, risk, monitor };
  const tabCounts: Record<TabKey, number> = { stockout: stockout.length, risk: risk.length, monitor: monitor.length };
  const currentAlerts = [...tabData[activeTab]].sort((a, b) => {
    let va: number, vb: number;
    if (sortCol === 'velocity') { va = a.velocityPerDay; vb = b.velocityPerDay; }
    else if (sortCol === 'days') { va = a.daysRemaining; vb = b.daysRemaining; }
    else { va = a.currentStock <= 0 ? a.velocityPerDay * 100 : 0; vb = b.currentStock <= 0 ? b.velocityPerDay * 100 : 0; }
    return sortDir === 'desc' ? vb - va : va - vb;
  });

  // Estimate lost revenue for stockout
  const lostRevenuePerDay = stockout.reduce((s, a) => s + a.velocityPerDay * 100, 0); // rough estimate

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Smart Alerts</h1>
          <p className="page-subtitle">
            {relevant.length === 0 ? 'Nicio alertă activă' : `${relevant.length} alerte active`}
          </p>
        </div>
        <div className="page-actions">
          {stores.length > 1 && (
            <select className="form-input" style={{ width: 180 }} value={selectedStoreId || ''}
              onChange={(e) => setSearchParams({ store: e.target.value })}>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {selectedStoreId && (
            <Form method="post">
              <input type="hidden" name="storeId" value={selectedStoreId} />
              <button type="submit" className="btn btn-secondary" disabled={isCalculating}>
                <RefreshCw size={12} style={{ animation: isCalculating ? 'spin 1s linear infinite' : undefined }} />
                {isCalculating ? 'Se calculează...' : 'Recalculează'}
              </button>
            </Form>
          )}
        </div>
      </div>

      {/* Summary KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        <div className="card" style={{ padding: '14px 16px', borderLeft: '3px solid #dc2626' }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Stockout activ</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#dc2626' }}>{stockout.length}</div>
          <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>epuizate, cerere mare</div>
        </div>
        <div className="card" style={{ padding: '14px 16px', borderLeft: '3px solid #d97706' }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Risc epuizare</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#d97706' }}>{risk.length}</div>
          <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>se termină în &lt;30 zile</div>
        </div>
        <div className="card" style={{ padding: '14px 16px', borderLeft: '3px solid #0369a1' }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>De monitorizat</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#0369a1' }}>{monitor.length}</div>
          <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>au stoc, se epuizează</div>
        </div>
      </div>

      {relevant.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '56px 24px' }}>
          <div style={{ width: 48, height: 48, background: 'var(--success-bg)', borderRadius: '50%', margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CheckCircle size={22} color="var(--success-text)" />
          </div>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
            Nicio alertă de stoc. Toate produsele active au stoc suficient.
          </p>
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 0, borderBottom: '0.5px solid var(--border-default)' }}>
            {TABS.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;
              const count = tabCounts[tab.key];
              return (
                <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '10px 18px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    background: 'none', border: 'none',
                    borderBottom: isActive ? `2px solid ${tab.color}` : '2px solid transparent',
                    color: isActive ? tab.color : 'var(--text-secondary)',
                    transition: 'all 0.15s',
                  }}>
                  <Icon size={13} />
                  {tab.label}
                  <span style={{
                    padding: '1px 7px', borderRadius: 99, fontSize: 10, fontWeight: 700,
                    background: isActive ? tab.color + '18' : 'var(--bg-tertiary)',
                    color: isActive ? tab.color : 'var(--text-tertiary)',
                  }}>{count}</span>
                </button>
              );
            })}
          </div>



          {/* Table */}
          {currentAlerts.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '40px 24px' }}>
              <CheckCircle size={20} color="var(--success-text)" style={{ marginBottom: 8 }} />
              <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Nicio alertă în această categorie.</p>
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
                <thead>
                  <tr style={{ borderBottom: '0.5px solid var(--border-default)' }}>
                    <th style={{ padding: '10px 16px', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Produs</th>
                    <th style={{ padding: '10px 16px', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Stoc actual</th>
                    <th onClick={() => toggleSort('velocity')} style={{ padding: '10px 16px', fontSize: 11, fontWeight: 600, color: sortCol === 'velocity' ? 'var(--kimono-orange)' : 'var(--text-secondary)', textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.5px', cursor: 'pointer', userSelect: 'none' }}>Vânzări/zi {sortCol === 'velocity' ? (sortDir === 'desc' ? '▼' : '▲') : '↕'}</th>
                    <th onClick={() => toggleSort('days')} style={{ padding: '10px 16px', fontSize: 11, fontWeight: 600, color: sortCol === 'days' ? 'var(--kimono-orange)' : 'var(--text-secondary)', textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.5px', cursor: 'pointer', userSelect: 'none' }}>Zile rămase {sortCol === 'days' ? (sortDir === 'desc' ? '▼' : '▲') : '↕'}</th>
                    <th onClick={() => toggleSort('loss')} style={{ padding: '10px 16px', fontSize: 11, fontWeight: 600, color: sortCol === 'loss' ? 'var(--kimono-orange)' : 'var(--text-secondary)', textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.5px', cursor: 'pointer', userSelect: 'none' }}>Pierdere est./zi {sortCol === 'loss' ? (sortDir === 'desc' ? '▼' : '▲') : '↕'}</th>
                  </tr>
                </thead>
                <tbody>
                  {currentAlerts.map((a, i) => {
                    const estLossPerDay = a.currentStock <= 0 ? Math.round(a.velocityPerDay * 100) : 0;
                    return (
                      <tr key={i} style={{ borderBottom: i < currentAlerts.length - 1 ? '0.5px solid var(--border-default)' : undefined }}>
                        <td style={{ padding: '10px 16px', fontSize: 13, color: 'var(--text-primary)', maxWidth: 350 }}>
                          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {a.productTitle}
                          </div>
                        </td>
                        <td style={{ padding: '10px 16px', fontSize: 13, textAlign: 'right', fontWeight: 600, color: a.currentStock <= 0 ? 'var(--danger-text)' : 'var(--text-primary)' }}>
                          {a.currentStock <= 0 ? '0' : formatNumber(a.currentStock)}
                        </td>
                        <td style={{ padding: '10px 16px', fontSize: 13, textAlign: 'right', color: 'var(--text-secondary)' }}>
                          {a.velocityPerDay.toFixed(1)}
                        </td>
                        <td style={{ padding: '10px 16px', fontSize: 13, textAlign: 'right', fontWeight: 600, color: a.daysRemaining <= 3 ? 'var(--danger-text)' : a.daysRemaining <= 7 ? 'var(--warning-text)' : 'var(--text-primary)' }}>
                          {a.currentStock <= 0 ? '—' : a.daysRemaining + 'z'}
                        </td>
                        <td style={{ padding: '10px 16px', fontSize: 13, textAlign: 'right', fontWeight: 600, color: estLossPerDay > 0 ? 'var(--danger-text)' : 'var(--text-tertiary)' }}>
                          {estLossPerDay > 0 ? `~${estLossPerDay} RON` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

    </div>
  );
}
