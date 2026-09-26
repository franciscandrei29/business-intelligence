import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Link, useLoaderData, useSearchParams } from '@remix-run/react';
import { requireUser, requireUserContext } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import { Zap, ArrowLeft } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'AI Advisor — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await requireUserContext(request);
  const user = ctx.user;
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');

  const stores = await db.storeConnection.findMany({
    where: { userId: ctx.effectiveOwnerId },
    select: { id: true, name: true },
  });

  const selectedStoreId = storeId || stores[0]?.id;
  if (!selectedStoreId) return json({ stores, recommendations: [], generatedAt: null });

  const insight = await db.aiInsight.findFirst({
    where: { storeConnectionId: selectedStoreId, type: 'ADVISOR_DAILY' },
    orderBy: { generatedAt: 'desc' },
    select: { causalAnalysis: true, generatedAt: true },
  });

  let recommendations: any[] = [];
  if (insight) {
    try {
      const parsed = JSON.parse(insight.causalAnalysis);
      recommendations = parsed.recommendations || [];
    } catch {
      // Old format (markdown) - show as single recommendation
      recommendations = [{ priority: 'important', title: 'Analiză zilnică', description: insight.causalAnalysis.slice(0, 500), action: 'Vezi detaliile complete', category: 'general' }];
    }
  }

  return json({ stores, recommendations, generatedAt: insight?.generatedAt?.toISOString() || null, selectedStoreId });
}

const PRIORITY_CONFIG: Record<string, { bg: string; text: string; label: string; border: string }> = {
  urgent:      { bg: 'var(--danger-bg)',  text: 'var(--danger-text)',  label: 'Urgent',          border: '#dc2626' },
  important:   { bg: 'var(--warning-bg)', text: 'var(--warning-text)', label: 'Important',       border: '#d97706' },
  improvement: { bg: 'var(--info-bg)',    text: 'var(--info-text)',    label: 'Îmbunătățire', border: '#0369a1' },
  opportunity: { bg: 'var(--success-bg)', text: 'var(--success-text)', label: 'Oportunitate',    border: '#16a34a' },
};

const CATEGORY_LABELS: Record<string, string> = {
  vanzari: 'Vânzări', stoc: 'Stoc', clienti: 'Clienți',
  marketing: 'Marketing', operatiuni: 'Operațiuni', financiar: 'Financiar', general: 'General',
};

export default function AiAdvisorPage() {
  const { stores, recommendations, generatedAt, selectedStoreId } = useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();

  const grouped = {
    urgent: recommendations.filter((r: any) => r.priority === 'urgent'),
    important: recommendations.filter((r: any) => r.priority === 'important'),
    improvement: recommendations.filter((r: any) => r.priority === 'improvement'),
    opportunity: recommendations.filter((r: any) => r.priority === 'opportunity'),
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">AI Advisor</h1>
          <p className="page-subtitle">
            Recomandări bazate pe datele magazinului
            {generatedAt && <> · Actualizat {new Date(generatedAt).toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</>}
          </p>
        </div>
        <div className="page-actions">
          {stores.length > 1 && (
            <select className="form-input" style={{ width: 180 }} value={selectedStoreId || ''}
              onChange={(e) => setSearchParams({ store: e.target.value })}>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
        </div>
      </div>

      {recommendations.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '56px 24px' }}>
          <Zap size={40} color="var(--text-secondary)" style={{ marginBottom: 12 }} />
          <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
            Nu există recomandări încă. Se generează automat zilnic la 06:30.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {Object.entries(grouped).map(([priority, recs]) => {
            if ((recs as any[]).length === 0) return null;
            const cfg = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.improvement;
            return (
              <div key={priority}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: cfg.bg, color: cfg.text, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {cfg.label}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{(recs as any[]).length} recomandări</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(recs as any[]).map((rec: any, i: number) => (
                    <div key={i} className="card" style={{ padding: '16px 20px', borderLeft: `3px solid ${cfg.border}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{rec.title}</div>
                        {rec.category && (
                          <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', flexShrink: 0 }}>
                            {CATEGORY_LABELS[rec.category] || rec.category}
                          </span>
                        )}
                      </div>
                      {rec.description && (
                        <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 8 }}>{rec.description}</p>
                      )}
                      {rec.action && (
                        <div style={{ fontSize: 12, color: cfg.text, fontWeight: 500 }}>
                          {rec.action}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
