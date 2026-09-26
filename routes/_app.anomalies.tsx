import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData, useSearchParams } from '@remix-run/react';
import { requireUser } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import { detectAnomalies } from '~/lib/anomaly/index';
import { AlertTriangle, TrendingDown, TrendingUp, Activity, CheckCircle2 } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Anomaly Detection — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');

  const stores = await db.storeConnection.findMany({
    where: { userId: user.id },
    select: { id: true, name: true },
  });

  const selectedStoreId = storeId || stores[0]?.id;
  if (!selectedStoreId) return json({ stores, anomalies: [], selectedStoreId: null });

  const anomalies = await detectAnomalies(selectedStoreId);
  return json({ stores, anomalies, selectedStoreId });
}

const SEVERITY_CFG: Record<string, { bg: string; fg: string; border: string; label: string; Icon: any }> = {
  critical: { bg: '#fee2e2', fg: '#991b1b', border: '#dc2626', label: 'Critic', Icon: AlertTriangle },
  warning: { bg: '#fef3c7', fg: '#92400e', border: '#d97706', label: 'Atentie', Icon: TrendingDown },
  info: { bg: '#dbeafe', fg: '#1e40af', border: '#2563eb', label: 'Info', Icon: TrendingUp },
};

export default function AnomaliesPage() {
  const { stores, anomalies, selectedStoreId } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  const criticals = anomalies.filter((a) => a.severity === 'critical').length;
  const warnings = anomalies.filter((a) => a.severity === 'warning').length;
  const infos = anomalies.filter((a) => a.severity === 'info').length;

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
        <div>
          <h1 className="page-title">Anomaly Detection</h1>
          <p className="page-subtitle">Comparare day-of-week pe 8 saptamani anterioare · ultimele 14 zile</p>
        </div>
        {stores.length > 1 && (
          <select className="form-input" style={{ width: 220 }} value={selectedStoreId || ''} onChange={(e) => setSearchParams({ store: e.target.value })}>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>

      <div className="info-box">
        <p>
          Detectie DoW-aware: fiecare zi e comparata cu aceeasi zi din saptamanile anterioare (ex: luni vs luni, nu luni vs duminica). Detecteaza: scaderi z&lt;-2 cu deviere &gt;30%, spike-uri z&gt;2 cu crestere &gt;50%, zile zero cand media e &gt;5, si schimbari de AOV.
        </p>
      </div>

      {/* Summary badges */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
        <div className="card" style={{ borderLeft: '6px solid #dc2626' }}>
          <div className="mono-label" style={{ color: '#991b1b' }}>Critice</div>
          <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'SF Mono, monospace' }}>{criticals}</div>
        </div>
        <div className="card" style={{ borderLeft: '6px solid #d97706' }}>
          <div className="mono-label" style={{ color: '#92400e' }}>Atentionari</div>
          <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'SF Mono, monospace' }}>{warnings}</div>
        </div>
        <div className="card" style={{ borderLeft: '6px solid #2563eb' }}>
          <div className="mono-label" style={{ color: '#1e40af' }}>Pozitive</div>
          <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'SF Mono, monospace' }}>{infos}</div>
        </div>
      </div>

      {anomalies.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
          <CheckCircle2 size={48} style={{ color: '#16a34a', marginBottom: 'var(--space-md)' }} />
          <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Totul in parametri normali</h3>
          <p style={{ color: 'var(--color-muted)', fontSize: 14 }}>
            Nu am detectat anomalii fata de pattern-ul tau saptamanal in ultimele 14 zile.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          {anomalies.map((a, i) => {
            const cfg = SEVERITY_CFG[a.severity] || SEVERITY_CFG.info;
            return (
              <div key={i} className="card" style={{ borderLeftWidth: 6, borderLeftColor: cfg.border, padding: 16 }}>
                <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ width: 40, height: 40, background: cfg.bg, border: `2px solid ${cfg.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <cfg.Icon size={20} style={{ color: cfg.fg }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
                      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--color-black)' }}>
                        {a.message}
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span className="status-badge" style={{ background: cfg.bg, color: cfg.fg, borderColor: cfg.border }}>{cfg.label}</span>
                        <span style={{ fontSize: 12, fontFamily: 'SF Mono, monospace', color: 'var(--color-muted)', fontWeight: 600 }}>{a.date}</span>
                      </div>
                    </div>
                    {a.context && (
                      <div style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 8 }}>{a.context}</div>
                    )}
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12 }}>
                      <Metric label="Actual" value={a.currentValue.toLocaleString('ro-RO')} />
                      <Metric label="Asteptat" value={a.expectedValue.toLocaleString('ro-RO')} />
                      <Metric label="Deviere" value={`${a.deviationPercent > 0 ? '+' : ''}${a.deviationPercent}%`} color={a.deviationPercent < 0 ? '#dc2626' : '#16a34a'} />
                      {a.zScore !== 0 && a.zScore !== -99 && <Metric label="Z-score" value={a.zScore.toFixed(2)} />}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="mono-label" style={{ fontSize: 9 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: color || 'var(--color-black)', fontFamily: 'SF Mono, monospace' }}>{value}</div>
    </div>
  );
}
