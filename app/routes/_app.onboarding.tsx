import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Link, useLoaderData } from '@remix-run/react';
import { requireUser, requireUserContext } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import { ShoppingBag, TrendingUp, Users, Zap, ArrowRight, CheckCircle, BarChart3 } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Bun venit — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await requireUserContext(request);
  const user = ctx.user;
  const storeCount = await db.storeConnection.count({ where: { userId: ctx.effectiveOwnerId } });
  const sub = await db.subscription.findUnique({ where: { userId: ctx.effectiveOwnerId } });

  // Has the team connected GA4? Tokens are stored in data/ga-tokens.json keyed by ownerId.
  let gaConnected = false;
  try {
    const { getTokens } = await import('~/lib/ga/index');
    const tokens = getTokens(ctx.effectiveOwnerId);
    gaConnected = Boolean(tokens && tokens.propertyId);
  } catch {}

  return json({
    userName: user.fullName || user.email,
    storeCount,
    plan: sub?.plan || 'FREE',
    gaConnected,
  });
}

interface Step {
  step: number;
  title: string;
  desc: string;
  href: string;
  cta: string;
  optional?: boolean;
}

const STEPS: Step[] = [
  {
    step: 1,
    title: 'Conectează primul magazin',
    desc: 'Adaugă magazinul tău Shopify sau eMag Marketplace pentru a importa datele.',
    href: '/stores/new',
    cta: 'Adaugă magazin',
  },
  {
    step: 2,
    title: 'Conectează Google Analytics 4',
    desc: 'Opțional — pentru sessions, conversion rate și revenue per channel direct în Kimono BI.',
    href: '/analytics',
    cta: 'Conectează GA4',
    optional: true,
  },
  {
    step: 3,
    title: 'Sincronizează datele',
    desc: 'Comenzile, clienții și produsele se importă automat. Primul sync durează 5–15 minute.',
    href: '/stores',
    cta: 'Vezi magazine',
  },
  {
    step: 4,
    title: 'Explorează rapoartele',
    desc: 'Dashboard, RFM, Churn Prediction, Smart Alerts — toate datele afacerii tale la un loc.',
    href: '/dashboard',
    cta: 'Mergi la dashboard',
  },
];

const MODULES = [
  { icon: TrendingUp, color: '#16a34a', bg: 'rgba(22,163,74,0.1)', name: 'Dashboard', desc: 'KPI-uri în timp real' },
  { icon: Users, color: '#7c3aed', bg: 'rgba(124,58,237,0.1)', name: 'RFM Segments', desc: 'Segmentare clienți' },
  { icon: Zap, color: '#D85A30', bg: 'rgba(216,90,48,0.1)', name: 'Churn Prediction', desc: 'Predicție abandon' },
  { icon: ShoppingBag, color: '#0369a1', bg: 'rgba(3,105,161,0.1)', name: 'Smart Alerts', desc: 'Alerte stoc' },
];

export default function OnboardingPage() {
  const { userName, storeCount, gaConnected } = useLoaderData<typeof loader>();
  const firstName = userName.split(' ')[0];

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      {/* Hero */}
      <div style={{ marginBottom: 36 }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '4px 12px', borderRadius: 99,
          background: 'rgba(216,90,48,0.08)', border: '0.5px solid rgba(216,90,48,0.25)',
          marginBottom: 16,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--kimono-orange)' }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--kimono-orange)' }}>Cont activat</span>
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.5px', marginBottom: 10 }}>
          Bun venit, {firstName}! 👋
        </h1>
        <p style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          Kimono BI transformă datele din magazinul tău în decizii clare. Urmează pașii de mai jos pentru a te configura.
        </p>
      </div>

      {/* Steps */}
      <div className="card" style={{ padding: 0, marginBottom: 24, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '0.5px solid var(--border-default)' }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>Pași de configurare</span>
        </div>
        {STEPS.map((s, i) => {
          // Determine done state per step
          let isDone = false;
          if (s.step === 1) isDone = storeCount > 0;
          else if (s.step === 2) isDone = gaConnected;
          else if (s.step === 3) isDone = false; // sync is continuous, not "done"

          // Active step: first non-done step (skipping optional ones that aren't done)
          const isActive =
            (s.step === 1 && storeCount === 0) ||
            (s.step === 2 && storeCount > 0 && !gaConnected) ||
            (s.step === 3 && storeCount > 0) ||
            (s.step === 4 && storeCount > 0);
          const showCta = !isDone || s.step === 3 || s.step === 4;

          return (
            <div
              key={s.step}
              style={{
                display: 'flex', gap: 16, padding: '20px 20px',
                borderBottom: i < STEPS.length - 1 ? '0.5px solid var(--border-default)' : undefined,
                opacity: isDone && s.step < 3 ? 0.65 : 1,
              }}
            >
              <div style={{
                width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: isDone
                  ? 'var(--success-bg)'
                  : isActive
                    ? 'var(--kimono-orange)'
                    : 'var(--bg-tertiary)',
              }}>
                {isDone
                  ? <CheckCircle size={18} color="var(--success-text)" />
                  : <span style={{ fontSize: 14, fontWeight: 700, color: isActive ? '#fff' : 'var(--text-secondary)' }}>{s.step}</span>
                }
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
                  {isDone ? <s>{s.title}</s> : s.title}
                  {s.optional && !isDone && (
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Opțional
                    </span>
                  )}
                </div>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 12 }}>{s.desc}</p>
                {showCta && (
                  <Link
                    to={s.href}
                    className={isActive && !isDone ? 'btn btn-primary' : 'btn btn-secondary'}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}
                  >
                    {s.cta} <ArrowRight size={12} />
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modules preview */}
      <div style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>
          Ce vei accesa după configurare
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          {MODULES.map((m) => {
            const Icon = m.icon;
            return (
              <div key={m.name} className="card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: m.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon size={16} color={m.color} />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{m.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{m.desc}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ textAlign: 'center' }}>
        <Link to="/dashboard" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          Sari peste → mergi direct la dashboard
        </Link>
      </div>
    </div>
  );
}
