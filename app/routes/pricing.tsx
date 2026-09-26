import type { MetaFunction } from '@remix-run/node';
import { Link } from '@remix-run/react';
import { PublicNav, PublicFooter } from '~/components/PublicLayout';

export const meta: MetaFunction = () => [
  { title: 'Abonamente — Kimono BI' },
  { name: 'description', content: 'Patru abonamente Kimono BI. Începi gratuit. Faci upgrade când îți trebuie. Trial 14 zile, fără card.' },
];

const numberFont = { fontFeatureSettings: '"tnum" 1, "lnum" 1' } as React.CSSProperties;

// Sincronizat cu app/lib/plans.ts
const PLANS = [
  {
    name: 'Free',
    tagline: 'Pentru când vrei să vezi cu ochii tăi.',
    price: '0',
    period: 'pentru totdeauna',
    desc: 'Conectezi un magazin și explorezi platforma fără card, fără limită de timp.',
    color: '#5F5E5A',
    highlight: false,
    cta: 'Creează cont gratuit',
    ctaHref: '/register',
    headlineFeatures: [
      '1 magazin (Shopify · eMag · GA4)',
      'Dashboard live + Peak Hours',
      'Ask AI — 3 întrebări / lună',
      'Sync incremental la 30 minute',
    ],
    modulesNew: ['Dashboard', 'Ask AI', 'GA4 Analytics', 'Peak Hours'],
    missing: ['RFM, Cohorts, LTV', 'Revenue Forecast', 'Stock & Inventory', 'AI Narrative & Audit'],
  },
  {
    name: 'Starter',
    tagline: 'Pentru când ai trecut de prima sută de comenzi.',
    price: '49',
    period: '/ lună',
    desc: 'Inteligență clienți + forecast + stock alerts. Pentru magazine în creștere reală.',
    color: '#0369a1',
    highlight: false,
    cta: 'Începe trial 14 zile',
    ctaHref: '/register',
    headlineFeatures: [
      'Tot ce e în Free',
      'Inteligență clienți (RFM · Cohorts · LTV)',
      'Revenue Forecast cu sezonalitate RO',
      'Stock alerts',
      'Ask AI — 50 întrebări / lună',
      'Suport email',
    ],
    modulesNew: ['Stock', 'RFM Segmentation', 'Cohort Analysis', 'LTV Analytics', 'Revenue Forecast', 'Period Compare'],
    missing: ['Profit & Margin', 'AI Narrative & Audit', 'Membri echipă'],
  },
  {
    name: 'Growth',
    tagline: 'Pentru când profitul devine mai important decât cifra.',
    price: '129',
    period: '/ lună',
    desc: 'Toate modulele platformei. Pentru echipe care iau decizii în fiecare luni dimineață.',
    color: 'var(--kimono-orange)',
    highlight: true,
    badge: 'Cel mai ales',
    cta: 'Începe trial 14 zile',
    ctaHref: '/register',
    headlineFeatures: [
      'Toate cele 29 module ale platformei',
      'Ask AI nelimitat · AI Advisor · AI Narrative',
      'BI Audit pe 8 domenii (PDF brandat)',
      'Email Digest săptămânal automat',
      'Data Health & Annotations',
      '3 magazine · 3 membri echipă',
      'Suport prioritar email + chat',
    ],
    modulesNew: [
      'Churn Risk', 'BCG Matrix', 'Basket Analysis', 'Discount Impact', 'Refunds',
      'Inventory Turnover', 'Time to Fulfilment', 'Anomaly Detection', 'Goal Tracker',
      'AI Narrative', 'Shareable Reports', 'Profitability', 'Contribution Margin',
      'Scale recommendations', 'Repeat Purchase', 'Stockout Loss',
      'BI Audit', 'Data Health', 'Annotations', 'Email Digest', 'Action Queue',
    ],
    missing: [],
  },
  {
    name: 'Scale',
    tagline: 'Pentru când platforma trebuie să se mulează pe operațiunea ta.',
    price: 'Custom',
    period: 'ofertă personalizată',
    desc: 'Toate modulele Growth + funcții custom dezvoltate pentru tine, integrări custom (ERP, WMS, BI intern), multi-store nelimitat și manager de cont dedicat.',
    color: '#7c3aed',
    highlight: false,
    cta: 'Cere ofertă',
    ctaHref: '/contact?subject=oferta-scale',
    headlineFeatures: [
      'Tot ce e în Growth',
      'Funcții custom dezvoltate pentru tine',
      'Integrări custom (ERP · WMS · BI intern · API)',
      'Multi-store nelimitat',
      'Membri echipă nelimitați',
      'Onboarding dedicat (2h+) cu manager de cont',
      'SLA 99.9% uptime garantat',
      'Suport telefon prioritar',
    ],
    modulesNew: ['Custom development', 'Custom integrations', 'White-label opțional', 'Dedicated infrastructure'],
    missing: [],
  },
];

const FAQ = [
  { q: 'Pot anula oricând?', a: 'Da. Anulezi din Setări → Plan, fără penalități, fără perioadă minimă. Datele rămân acolo dacă te răzgândești.' },
  { q: 'Ce se întâmplă după trial-ul de 14 zile?', a: 'Dacă nu adaugi card, contul trece automat pe Free. Datele rămân intacte — le revezi când vrei să faci upgrade.' },
  { q: 'Acceptați carduri românești?', a: 'Da, toate cardurile Visa și Mastercard emise în România. Plăți procesate securizat prin Stripe.' },
  { q: 'Există reducere pentru plata anuală?', a: 'Da — 2 luni gratuite la plata anuală (echivalent 17%). Scrie-ne la office@kimonogroup.ro pentru factură.' },
  { q: 'Pot schimba abonamentul oricând?', a: 'Da. Upgrade-ul intră imediat, cu proratare pentru zilele rămase. Downgrade-ul intră la finalul perioadei curente.' },
  { q: 'Datele mele sunt în siguranță?', a: 'Tokens criptați AES-256-GCM. Baze de date în Europa, GDPR compliant. Poți exporta sau șterge totul oricând, dintr-un singur click.' },
  { q: 'Pot conecta mai multe magazine pe Free?', a: 'Free permite 1 magazin. Starter — 1, Growth — 3, Scale — 10. Pentru mai mult, scrie-ne pentru o ofertă custom.' },
  { q: 'Ask AI consumă quota dacă AI-ul nu răspunde?', a: 'Nu. Mesajele care eșuează tehnic nu îți consumă quota lunară.' },
];

const ALWAYS_INCLUDED = [
  { title: 'Setup în 2 minute', sub: 'OAuth Shopify · eMag · GA4. Tokens criptați end-to-end.' },
  { title: 'Backup automat zilnic', sub: 'Datele tale, în siguranță — peste tot, mereu.' },
  { title: 'Hosting în Europa', sub: 'GDPR compliant. Date never leave EU.' },
  { title: 'Update-uri continue', sub: 'Module noi, fără cost suplimentar. Niciun upsell.' },
  { title: 'Suport în română', sub: 'Echipă în București. Răspundem în 24h.' },
  { title: 'Anulezi oricând', sub: 'Fără penalități. Fără perioadă minimă. Fără discuție.' },
];

export default function AbonamentePage() {
  const eyebrow = {
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: '1.5px',
    textTransform: 'uppercase' as const,
    color: 'var(--kimono-orange-text)',
    marginBottom: 22,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    justifyContent: 'center',
  } as React.CSSProperties;

  return (
    <div style={{ minHeight: '100vh', background: 'white', fontFamily: 'var(--font-sans)' }}>
      <PublicNav />

      {/* ---------- Hero ---------- */}
      <div style={{ background: 'linear-gradient(180deg, var(--kimono-orange-bg) 0%, white 90%)', borderBottom: '0.5px solid var(--border-default)' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: 'clamp(56px, 8vw, 88px) clamp(20px, 5vw, 32px) clamp(48px, 7vw, 64px)', textAlign: 'center' as const }}>
          <div style={eyebrow}>
            <span style={{ display: 'inline-block', width: 18, height: 1, background: 'var(--kimono-orange)' }} />
            Abonamente
            <span style={{ display: 'inline-block', width: 18, height: 1, background: 'var(--kimono-orange)' }} />
          </div>
          <h1 style={{ fontSize: 'clamp(40px, 6vw, 72px)', fontWeight: 400, letterSpacing: 'clamp(-1.5px, -0.3vw, -2.8px)', color: 'var(--text-primary)', margin: '0 auto 24px', maxWidth: 820, lineHeight: 1.02 }}>
            Patru planuri.<br/>
            <em style={{ color: 'var(--kimono-orange)', fontWeight: 300 }}>Începi unde ești.</em>
          </h1>
          <p style={{ fontSize: 17, color: 'var(--text-secondary)', margin: '0 auto 12px', maxWidth: 540, lineHeight: 1.55 }}>
            Începi gratuit. Faci upgrade când îți trebuie mai mult. Nu te ținem la discuție pentru fiecare feature.
          </p>
          <p style={{ fontSize: 12.5, color: 'var(--text-tertiary)', marginBottom: 0, ...numberFont }}>
            Prețuri în EUR, fără TVA · Trial 14 zile pe orice plan plătit · Plată lunară sau anuală (−17%)
          </p>
        </div>
      </div>

      {/* ---------- Plans ---------- */}
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: 'clamp(48px, 6vw, 64px) clamp(16px, 4vw, 24px) 0' }}>
        <div className="kbi-carousel-hint">← Glisează pentru a vedea toate planurile →</div>
      </div>
      <div className="kbi-pricing-grid" style={{ maxWidth: 1240, margin: '0 auto', padding: '0 clamp(16px, 4vw, 24px) clamp(48px, 6vw, 64px)' }}>
        {PLANS.map((plan) => (
          <div key={plan.name} style={{
            background: 'white',
            border: plan.highlight ? `2px solid var(--kimono-orange)` : '0.5px solid var(--border-default)',
            borderRadius: 16,
            padding: '32px 26px',
            position: 'relative' as const,
            boxShadow: plan.highlight ? '0 16px 48px rgba(216,90,48,0.16)' : '0 1px 0 rgba(0,0,0,0.02)',
          }}>
            {plan.badge && (
              <div style={{ position: 'absolute', top: -13, left: '50%', transform: 'translateX(-50%)', background: 'var(--kimono-orange)', color: 'white', fontSize: 10.5, fontWeight: 700, padding: '5px 14px', borderRadius: 99, whiteSpace: 'nowrap' as const, letterSpacing: '0.8px', textTransform: 'uppercase' as const }}>
                {plan.badge}
              </div>
            )}

            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: plan.color, marginBottom: 14, textTransform: 'uppercase', letterSpacing: '1.2px' }}>{plan.name}</div>

              <div style={{ fontSize: 14.5, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.35, letterSpacing: '-0.2px', marginBottom: 18, minHeight: 38 }}>
                {plan.tagline}
              </div>

              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8, ...numberFont, flexWrap: 'wrap' as const }}>
                {plan.price === 'Custom' ? (
                  <span style={{ fontSize: 36, fontWeight: 400, color: 'var(--text-primary)', letterSpacing: '-1.5px', lineHeight: 1 }}>Custom</span>
                ) : (
                  <span style={{ fontSize: 48, fontWeight: 400, color: 'var(--text-primary)', letterSpacing: '-2px', lineHeight: 1 }}>€{plan.price}</span>
                )}
                <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{plan.period}</span>
              </div>
              <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5, minHeight: 36 }}>{plan.desc}</p>
            </div>

            <Link to={plan.ctaHref} style={{
              display: 'block', textAlign: 'center', padding: '12px 0', borderRadius: 8, fontSize: 13.5, fontWeight: 600,
              textDecoration: 'none', marginBottom: 26,
              background: plan.highlight ? 'var(--kimono-orange)' : 'white',
              color: plan.highlight ? 'white' : 'var(--text-primary)',
              border: plan.highlight ? '1px solid var(--kimono-orange)' : '0.5px solid var(--border-strong)',
              letterSpacing: '0.1px',
            }}>
              {plan.cta}
            </Link>

            <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '1.2px', marginBottom: 14 }}>Include</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
              {plan.headlineFeatures.map((f) => (
                <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{ display: 'inline-block', width: 10, height: 1, background: plan.color, flexShrink: 0, marginTop: 8 }} />
                  <span style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5, fontWeight: 400 }}>{f}</span>
                </div>
              ))}
            </div>

            {plan.modulesNew.length > 0 && (
              <details style={{ marginBottom: 14 }}>
                <summary style={{ fontSize: 10.5, color: 'var(--text-tertiary)', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '1.2px', fontWeight: 700, marginBottom: 8, userSelect: 'none' as const }}>
                  Module în {plan.name}
                </summary>
                <div style={{ marginTop: 12, fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                  {plan.modulesNew.join(' · ')}
                </div>
              </details>
            )}

            {plan.missing.length > 0 && (
              <div style={{ paddingTop: 16, borderTop: '0.5px dashed var(--border-default)' }}>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '1.2px', fontWeight: 700 }}>Nu include</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.65, fontStyle: 'italic' }}>{plan.missing.join(' · ')}</div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ---------- Inclus în toate ---------- */}
      <div style={{ maxWidth: 1080, margin: '0 auto clamp(64px, 10vw, 96px)', padding: '0 clamp(20px, 5vw, 32px)' }}>
        <div style={{ background: 'var(--bg-page)', border: '0.5px solid var(--border-default)', borderRadius: 16, padding: 'clamp(28px, 5vw, 48px)' }}>
          <div style={{ textAlign: 'center', marginBottom: 36 }}>
            <div style={{ fontSize: 11, color: 'var(--kimono-orange-text)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 14 }}>Inclus în toate planurile</div>
            <div style={{ fontSize: 'clamp(20px, 3vw, 26px)', fontWeight: 500, letterSpacing: '-0.6px', color: 'var(--text-primary)', lineHeight: 1.25 }}>
              Lucruri pe care nu trebuie să te încarci.
            </div>
          </div>
          <div className="kbi-included-grid">
            {ALWAYS_INCLUDED.map((item) => (
              <div key={item.title}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6, letterSpacing: '-0.1px' }}>{item.title}</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', lineHeight: 1.55 }}>{item.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ---------- FAQ ---------- */}
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '0 clamp(20px, 5vw, 32px) clamp(64px, 10vw, 96px)' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{ ...eyebrow, marginBottom: 18 }}>
            <span style={{ display: 'inline-block', width: 18, height: 1, background: 'var(--kimono-orange)' }} />
            Întrebări frecvente
            <span style={{ display: 'inline-block', width: 18, height: 1, background: 'var(--kimono-orange)' }} />
          </div>
          <h2 style={{ fontSize: 'clamp(28px, 4vw, 40px)', fontWeight: 400, color: 'var(--text-primary)', letterSpacing: '-1.2px', textAlign: 'center', margin: 0, lineHeight: 1.1 }}>
            Astea sunt întrebările pe care<br/>
            <span style={{ fontWeight: 300, color: 'var(--text-secondary)' }}>le-am primit cel mai des.</span>
          </h2>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' as const }}>
          {FAQ.map((item, i) => (
            <div key={i} style={{ padding: '24px 0', borderTop: '0.5px solid var(--border-default)', borderBottom: i === FAQ.length - 1 ? '0.5px solid var(--border-default)' : undefined }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 10, letterSpacing: '-0.2px' }}>{item.q}</div>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.65, fontWeight: 400 }}>{item.a}</p>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 56, padding: '40px 36px', background: 'var(--bg-darkest)', borderRadius: 16, color: 'white', textAlign: 'center' as const }}>
          <div style={{ fontSize: 11, color: '#FFB590', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '1.5px', marginBottom: 14 }}>Volum mare sau nevoi specifice?</div>
          <div style={{ fontSize: 22, fontWeight: 400, color: 'white', marginBottom: 14, letterSpacing: '-0.5px', lineHeight: 1.25 }}>
            Pentru peste 10 magazine, white-label sau integrări custom — facem o ofertă pe nevoile tale.
          </div>
          <p style={{ fontSize: 13.5, color: '#888780', marginBottom: 24, margin: '0 0 24px' }}>
            Răspundem în 24h, în limba română.
          </p>
          <Link to="/contact" style={{ display: 'inline-block', padding: '13px 28px', background: 'var(--kimono-orange)', color: 'white', borderRadius: 8, fontSize: 13.5, fontWeight: 600, textDecoration: 'none' }}>
            Cere ofertă personalizată →
          </Link>
        </div>
      </div>

      <PublicFooter />
    </div>
  );
}
