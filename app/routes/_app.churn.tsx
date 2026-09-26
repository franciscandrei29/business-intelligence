import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useState } from 'react';
import { Form, useLoaderData, useSearchParams } from '@remix-run/react';
import { requireUser, requireUserContext } from '~/lib/auth/requireAuth.server';
import { requireModule } from '~/lib/plans.server';
import { db } from '~/lib/db.server';
import { predictChurn } from '~/lib/churn/index';
import { Users, AlertTriangle, Download } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Churn Prediction — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await requireUserContext(request);
  const user = ctx.user;
  await requireModule(request, ctx.effectiveOwnerId, 'churn');
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');

  const stores = await db.storeConnection.findMany({
    where: { userId: ctx.effectiveOwnerId },
    select: { id: true, name: true },
  });

  const selectedStoreId = storeId || stores[0]?.id;
  if (!selectedStoreId) return json({ stores, predictions: [], summary: null, selectedStoreId: null, riskFilter: '' });

  let predictions = await predictChurn(selectedStoreId);
  const riskFilter = url.searchParams.get('risk') || '';
  if (riskFilter) predictions = predictions.filter((p) => p.riskLevel === riskFilter);

  const summary = {
    total: predictions.length,
    critical: predictions.filter((p) => p.riskLevel === 'critical').length,
    high: predictions.filter((p) => p.riskLevel === 'high').length,
    medium: predictions.filter((p) => p.riskLevel === 'medium').length,
    atRiskRevenue: predictions.reduce((s, p) => s + p.totalSpent, 0),
  };

  return json({ stores, predictions: predictions.slice(0, 500), summary, selectedStoreId, riskFilter });
}

const RISK: Record<string, { bg: string; text: string; border: string; label: string; dot: string }> = {
  critical: { bg: 'var(--danger-bg)',  text: 'var(--danger-text)',  border: 'var(--danger-bg-strong)',  label: 'Critic',  dot: 'var(--danger-bg-strong)' },
  high:     { bg: 'var(--warning-bg)', text: 'var(--warning-text)', border: 'var(--warning-bg-strong)', label: 'Ridicat', dot: 'var(--warning-bg-strong)' },
  medium:   { bg: 'var(--info-bg)',    text: 'var(--info-text)',    border: 'var(--info-bg-strong)',    label: 'Mediu',   dot: 'var(--info-bg-strong)' },
  low:      { bg: 'var(--success-bg)', text: 'var(--success-text)', border: 'var(--success-bg-strong)', label: 'Scăzut', dot: 'var(--success-bg-strong)' },
};

export default function ChurnPage() {
  const { stores, predictions, summary, selectedStoreId, riskFilter } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  const [perPage, setPerPage] = useState(25);
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(predictions.length / perPage);
  const paginated = predictions.slice(page * perPage, (page + 1) * perPage);

  const exportCSV = () => {
    const header = 'Risc,Client,Email,Scor,Zile inactiv,Comenzi,Total cheltuit,Semnale';
    const rows = predictions.map(p =>
      `${p.riskLevel},"${p.name}","${p.email || ''}",${p.churnScore},${p.daysSinceLastOrder},${p.ordersCount},${p.totalSpent},"${p.signals.join('; ')}"`
    );
    const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'churn-predictions.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Churn Prediction</h1>
          <p className="page-subtitle">{predictions.length} clienți cu risc de pierdere</p>
        </div>
        <div className="page-actions">
          <button onClick={exportCSV} className="btn btn-secondary" style={{ fontSize: 12 }}>
            <Download size={12} /> Export CSV
          </button>
          {stores.length > 1 && (
            <select className="form-input" style={{ width: 180 }} value={selectedStoreId || ''}
              onChange={(e) => setSearchParams({ store: e.target.value })}>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <select className="form-input" style={{ width: 160 }} value={riskFilter}
            onChange={(e) => {
              const p = new URLSearchParams(searchParams);
              p.set('risk', e.target.value);
              setSearchParams(p);
            }}>
            <option value="">Toate nivelurile</option>
            <option value="critical">Critic</option>
            <option value="high">Ridicat</option>
            <option value="medium">Mediu</option>
          </select>
        </div>
      </div>

      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Risc critic', value: summary.critical, color: 'var(--danger-text)', bg: 'var(--danger-bg)' },
            { label: 'Risc ridicat', value: summary.high, color: 'var(--warning-text)', bg: 'var(--warning-bg)' },
            { label: 'Risc mediu', value: summary.medium, color: 'var(--info-text)', bg: 'var(--info-bg)' },
            { label: 'Venit la risc', value: `${Math.round(summary.atRiskRevenue).toLocaleString('ro-RO')} RON`, color: 'var(--text-primary)', bg: 'var(--bg-tertiary)' },
          ].map((stat) => (
            <div key={stat.label} className="card" style={{ padding: '14px 16px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>{stat.label}</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: stat.color, letterSpacing: '-0.5px' }}>{stat.value}</div>
            </div>
          ))}
        </div>
      )}

      {predictions.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '56px 24px' }}>
          <div style={{ width: 48, height: 48, background: 'var(--success-bg)', borderRadius: '50%', margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Users size={22} color="var(--success-text)" />
          </div>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
            Nu există clienți cu risc de churn sau nu există date suficiente.
          </p>
        </div>
      ) : (
        <>
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 680 }}>
            <thead>
              <tr style={{ borderBottom: '0.5px solid var(--border-default)' }}>
                {['Risc', 'Client', 'Scor', 'Zile inactiv', 'Comenzi', 'Total cheltuit', 'Semnale'].map((h, i) => (
                  <th key={h} style={{
                    padding: '10px 14px', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)',
                    textAlign: i >= 2 && i <= 5 ? 'center' : 'left',
                    textTransform: 'uppercase', letterSpacing: '0.5px',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginated.map((p, i) => {
                const risk = RISK[p.riskLevel] || RISK.medium;
                return (
                  <tr key={i} style={{ borderBottom: i < paginated.length - 1 ? '0.5px solid var(--border-default)' : undefined }}>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 99, background: risk.bg, color: risk.text, fontSize: 11, fontWeight: 600 }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: risk.dot }} />
                        {risk.label}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{p.email || '—'}</div>
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                      <div style={{ width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: risk.bg, color: risk.text, fontWeight: 700, fontSize: 13, margin: '0 auto' }}>
                        {p.churnScore}
                      </div>
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'center', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{p.daysSinceLastOrder}z</td>
                    <td style={{ padding: '10px 14px', textAlign: 'center', fontSize: 13 }}>{p.ordersCount}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'center', fontSize: 13, fontWeight: 600, color: 'var(--success-text)' }}>
                      {p.totalSpent.toLocaleString('ro-RO')} RON
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 11, color: 'var(--text-secondary)', maxWidth: 220 }}>
                      {p.signals.slice(0, 2).join(' · ')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {predictions.length > 0 && (
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
              <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
                style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'white', fontSize: 11, cursor: page === 0 ? 'not-allowed' : 'pointer', opacity: page === 0 ? 0.4 : 1 }}>
                ← Prev
              </button>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{page + 1} / {totalPages}</span>
              <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}
                style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'white', fontSize: 11, cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer', opacity: page >= totalPages - 1 ? 0.4 : 1 }}>
                Next →
              </button>
            </div>
          </div>
        )}
      </>
      )}
    </div>
  );
}
