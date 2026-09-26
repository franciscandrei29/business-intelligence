import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { requireUser, requireUserContext } from '~/lib/auth/requireAuth.server';
import { requireModule } from '~/lib/plans.server';
import { db } from '~/lib/db.server';
import { calculateScaleReadiness } from '~/lib/scale/index';
import { Gauge } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Scale Readiness — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await requireUserContext(request);
  const user = ctx.user;
  await requireModule(request, ctx.effectiveOwnerId, 'scale');
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');

  const stores = await db.storeConnection.findMany({
    where: { userId: ctx.effectiveOwnerId },
    select: { id: true, name: true },
  });

  const selectedStoreId = storeId || stores[0]?.id;
  if (!selectedStoreId) return json({ stores, scale: null });

  const scale = await calculateScaleReadiness(selectedStoreId);
  return json({ stores, scale, selectedStoreId });
}

const STATUS_COLORS: Record<string, string> = {
  excellent: '#2ecc71',
  good: '#3498db',
  warning: '#f39c12',
  critical: '#e74c3c',
};

const GRADE_COLORS: Record<string, string> = {
  A: '#2ecc71',
  B: '#3498db',
  C: '#f39c12',
  D: '#e67e22',
  F: '#e74c3c',
};

export default function ScaleReadinessPage() {
  const { stores, scale } = useLoaderData<typeof loader>();

  if (!scale) {
    return (
      <div>
        <div className="page-header"><h1 className="page-title">Scale Readiness</h1></div>
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
          <p style={{ color: 'var(--color-text-muted)' }}>Conecteaza un magazin pentru a vedea scorul de scalabilitate.</p>
        </div>
      </div>
    );
  }

  const gradeColor = GRADE_COLORS[scale.grade] || '#f39c12';

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Scale Readiness</h1>
        <p className="page-subtitle">Cat de pregatit este magazinul tau pentru scalare</p>
      </div>


      <div className="info-box">
        <p>
          Scale Readiness masoara daca business-ul tau e pregatit sa creasca. Scorul 0-100 analizeaza 9 factori: crestere venit, repeat rate, marja bruta, sanatate stoc, calitate catalog, baza clienti, consistenta venit zilnic, mix segmente RFM si calitate date. Grad A = gata de scalare. Grad D/F = rezolva fundamentele inainte.
        </p>
      </div>

      {/* Big score circle */}
      <div className="card" style={{ textAlign: 'center', marginBottom: 'var(--space-xl)', padding: 'var(--space-2xl)' }}>
        <div style={{
          width: 160,
          height: 160,
          borderRadius: '50%',
          border: `6px solid ${gradeColor}`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto var(--space-md)',
          background: `${gradeColor}11`,
        }}>
          <div style={{ fontSize: '3rem', fontWeight: 800, color: gradeColor, lineHeight: 1 }}>
            {scale.overallScore}
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: gradeColor }}>
            {scale.grade}
          </div>
        </div>
        <div style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-xs)' }}>
          {scale.verdict}
        </div>
      </div>

      {/* Factor cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
        {scale.factors.map((f) => {
          const statusColor = STATUS_COLORS[f.status] || '#f39c12';
          return (
            <div key={f.name} className="card" style={{ borderLeft: `3px solid ${statusColor}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-sm)' }}>
                <span style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--color-text-heading)' }}>
                  {f.name}
                </span>
                <span style={{ fontWeight: 700, fontSize: '1.25rem', color: statusColor }}>
                  {f.score}
                </span>
              </div>
              {/* Progress bar */}
              <div style={{
                width: '100%',
                height: 8,
                background: 'var(--color-bg)',
                borderRadius: 'var(--radius-sm)',
                overflow: 'hidden',
                marginBottom: 'var(--space-sm)',
              }}>
                <div style={{
                  width: `${f.score}%`,
                  height: '100%',
                  background: statusColor,
                  borderRadius: 'var(--radius-sm)',
                  transition: 'width 0.3s ease',
                }} />
              </div>
              <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 2 }}>
                {f.insight}
              </div>
              {(f as any).details && (
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>
                  {(f as any).details}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'inline-block', fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', color: statusColor, background: `${statusColor}15`, padding: '2px 8px', borderRadius: 'var(--radius-sm)' }}>
                  {f.status}
                </span>
                <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>pondere {f.weight}%</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Recommendations */}
      {scale.recommendations.length > 0 && (
        <div className="card">
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>
            Recomandari
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {scale.recommendations.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'flex-start' }}>
                <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--color-primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, flexShrink: 0 }}>
                  {i + 1}
                </span>
                <span style={{ fontSize: '0.9375rem', color: 'var(--color-text)', lineHeight: 1.5 }}>
                  {r}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
