import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData, useSearchParams } from '@remix-run/react';
import { requireUser } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import { predictChurn } from '~/lib/churn/index';
import { AlertTriangle } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Churn Prediction — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');

  const stores = await db.storeConnection.findMany({
    where: { userId: user.id },
    select: { id: true, name: true },
  });

  const selectedStoreId = storeId || stores[0]?.id;
  if (!selectedStoreId) return json({ stores, predictions: [], summary: null });

  let predictions = await predictChurn(selectedStoreId);

  const riskFilter = url.searchParams.get('risk') || '';
  if (riskFilter) {
    predictions = predictions.filter((p) => p.riskLevel === riskFilter);
  }

  const summary = {
    total: predictions.length,
    critical: predictions.filter((p) => p.riskLevel === 'critical').length,
    high: predictions.filter((p) => p.riskLevel === 'high').length,
    medium: predictions.filter((p) => p.riskLevel === 'medium').length,
    atRiskRevenue: predictions.reduce((s, p) => s + p.totalSpent, 0),
  };

  return json({ stores, predictions: predictions.slice(0, 100), summary, riskFilter });
}

const RISK_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  critical: { bg: 'rgba(231, 76, 60, 0.15)', color: '#e74c3c', label: 'Critic' },
  high: { bg: 'rgba(243, 156, 18, 0.15)', color: '#f39c12', label: 'Ridicat' },
  medium: { bg: 'rgba(52, 152, 219, 0.15)', color: '#3498db', label: 'Mediu' },
  low: { bg: 'rgba(46, 204, 113, 0.15)', color: '#2ecc71', label: 'Scazut' },
};

export default function ChurnPage() {
  const { stores, predictions, summary, riskFilter } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Churn Prediction</h1>
        <p className="page-subtitle">Clienti cu risc de pierdere</p>
      </div>

      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
          <div className="card" style={{ borderLeft: '3px solid var(--color-danger)' }}>
            <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>Risc critic</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#e74c3c' }}>{summary.critical}</div>
          </div>
          <div className="card" style={{ borderLeft: '3px solid var(--color-warning)' }}>
            <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>Risc ridicat</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#f39c12' }}>{summary.high}</div>
          </div>
          <div className="card" style={{ borderLeft: '3px solid var(--color-info)' }}>
            <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>Risc mediu</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#3498db' }}>{summary.medium}</div>
          </div>
          <div className="card" style={{ borderLeft: '3px solid var(--color-primary)' }}>
            <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>Venit la risc</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>
              {Math.round(summary.atRiskRevenue).toLocaleString('ro-RO')} RON
            </div>
          </div>
        </div>
      )}

      <div className="info-box">
        <p>
          Churn Prediction identifica clientii cu risc de pierdere. Scorul 0-100 masoara probabilitatea ca un client sa nu mai cumpere. Factori: cat timp a trecut de la ultima comanda, frecventa comenzilor, si comparatia cu media magazinului. Clientii cu scor Critic ar trebui contactati imediat cu o oferta de reactivare.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)', flexWrap: 'wrap' }}>
        <select className="form-input" style={{ width: 180 }} value={riskFilter} onChange={(e) => { const params = new URLSearchParams(searchParams); params.set('risk', e.target.value); setSearchParams(params); }}>
          <option value="">Toate nivelurile</option>
          <option value="critical">Critic</option>
          <option value="high">Ridicat</option>
          <option value="medium">Mediu</option>
        </select>
      </div>

      {predictions.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
          <p style={{ color: 'var(--color-text-muted)' }}>Nu exista clienti cu risc de churn sau nu exista date suficiente.</p>
        </div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                <th style={{ textAlign: 'left', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Risc</th>
                <th style={{ textAlign: 'left', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Client</th>
                <th style={{ textAlign: 'center', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Scor</th>
                <th style={{ textAlign: 'right', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Zile inactiv</th>
                <th style={{ textAlign: 'right', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Comenzi</th>
                <th style={{ textAlign: 'right', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Total cheltuit</th>
                <th style={{ textAlign: 'left', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Semnale</th>
              </tr>
            </thead>
            <tbody>
              {predictions.map((p, i) => {
                const style = RISK_STYLES[p.riskLevel];
                return (
                  <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: 'var(--space-sm) var(--space-md)' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 'var(--radius-full)', background: style.bg, color: style.color, fontSize: '0.6875rem', fontWeight: 600 }}>
                        {style.label}
                      </span>
                    </td>
                    <td style={{ padding: 'var(--space-sm) var(--space-md)' }}>
                      <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>{p.name}</div>
                      <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>{p.email || '-'}</div>
                    </td>
                    <td style={{ padding: 'var(--space-sm) var(--space-md)', textAlign: 'center' }}>
                      <div style={{ width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: style.bg, color: style.color, fontWeight: 700, fontSize: '0.8125rem', margin: '0 auto' }}>
                        {p.churnScore}
                      </div>
                    </td>
                    <td style={{ padding: 'var(--space-sm) var(--space-md)', textAlign: 'right', fontSize: '0.875rem', fontWeight: 600 }}>{p.daysSinceLastOrder}</td>
                    <td style={{ padding: 'var(--space-sm) var(--space-md)', textAlign: 'right', fontSize: '0.875rem' }}>{p.ordersCount}</td>
                    <td style={{ padding: 'var(--space-sm) var(--space-md)', textAlign: 'right', fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-success)' }}>{p.totalSpent.toLocaleString('ro-RO')} RON</td>
                    <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', maxWidth: 250 }}>
                      {p.signals.slice(0, 2).join(' | ')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
