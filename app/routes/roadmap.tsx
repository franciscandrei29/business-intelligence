import type { MetaFunction } from '@remix-run/node';
import { Link } from '@remix-run/react';
import { PublicNav, PublicFooter } from '~/components/PublicLayout';

export const meta: MetaFunction = () => [
  { title: 'Roadmap — Kimono BI' },
  { name: 'description', content: 'Ce urmează la Kimono BI. Funcționalitățile planificate pentru 2026.' },
];

const ROADMAP = [
  {
    quarter: 'Q2 2026 — Acum',
    status: 'live',
    statusLabel: 'Live',
    statusColor: '#0F6E56',
    statusBg: '#E1F5EE',
    items: [
      { done: true, text: 'Dashboard live cu KPI-uri în timp real' },
      { done: true, text: 'RFM Segmentation automată (8 segmente)' },
      { done: true, text: 'Churn Prediction cu scor 0-100' },
      { done: true, text: 'Smart Stock Alerts (3 niveluri severitate)' },
      { done: true, text: 'Ask AI — chat cu datele magazinului' },
      { done: true, text: 'Revenue Forecast (ensemble 4 modele)' },
      { done: true, text: 'Cohort Analysis (matrice retenție)' },
      { done: true, text: 'BCG Product Matrix' },
      { done: true, text: 'LTV Analytics' },
      { done: true, text: 'Profit Margin Calculator' },
      { done: true, text: 'Conectori Shopify + WooCommerce + eMag' },
      { done: true, text: 'AI Narrative Reports cu export PDF' },
      { done: true, text: 'Anomaly Detection' },
      { done: true, text: 'Goal Tracker cu targeturi automate' },
      { done: true, text: 'Comparative Analysis (perioadă vs perioadă)' },
    ],
  },
  {
    quarter: 'Q3 2026 — Urmează',
    status: 'planned',
    statusLabel: 'Planificat',
    statusColor: '#0369a1',
    statusBg: 'rgba(3,105,161,0.1)',
    items: [
      { done: false, text: 'Mobile app (iOS & Android) — Dashboard + Alerte' },
      { done: false, text: 'Notificări Slack și WhatsApp Business' },
      { done: false, text: 'Integrare Google Analytics 4 (surse trafic + conversii)' },
      { done: false, text: 'Meta Ads Integration (ROAS, cost per client nou)' },
      { done: false, text: 'Email automations bazate pe segmente RFM' },
      { done: false, text: 'Custom Dashboard Builder (drag & drop widgets)' },
      { done: false, text: 'AI Actions — recomandări cu un singur click (export segment → Klaviyo)' },
      { done: false, text: 'Competitor Price Tracking (monitorizare prețuri concurență)' },
      { done: false, text: 'Multi-currency support' },
    ],
  },
  {
    quarter: 'Q4 2026 — Viitor',
    status: 'future',
    statusLabel: 'Viitor',
    statusColor: '#854F0B',
    statusBg: 'rgba(133,79,11,0.08)',
    items: [
      { done: false, text: 'TikTok Ads & Pinterest Ads Integration' },
      { done: false, text: 'Predictive Reordering — sugestii automate de reaprovizionare' },
      { done: false, text: 'Customer Journey Mapping (vizualizare touchpoints)' },
      { done: false, text: 'B2B Analytics (comenzi wholesale, clienți B2B)' },
      { done: false, text: 'Subscription Commerce Analytics (abonamente recurente)' },
      { done: false, text: 'White-label pentru agenții eCommerce' },
      { done: false, text: 'API publică completă (GraphQL + REST)' },
      { done: false, text: 'Marketplace propriu de rapoarte (template-uri comunitate)' },
    ],
  },
];

export default function RoadmapPage() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-page)', fontFamily: 'Inter, sans-serif' }}>
      <PublicNav />

      <div style={{ padding: 'clamp(48px, 7vw, 72px) clamp(20px, 5vw, 32px) clamp(40px, 6vw, 56px)', textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', background: 'white', border: '0.5px solid rgba(216,90,48,0.3)', borderRadius: 999, fontSize: 11, color: 'var(--kimono-orange)', fontWeight: 600, marginBottom: 20, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Transparent by default
        </div>
        <h1 style={{ fontSize: 'clamp(28px,4vw,42px)', fontWeight: 500, letterSpacing: '-1px', color: 'var(--text-primary)', margin: '0 auto 16px' }}>
          Ce construim în <span style={{ color: 'var(--kimono-orange)' }}>2026</span>
        </h1>
        <p style={{ fontSize: 16, color: 'var(--text-secondary)', margin: '0 auto', maxWidth: 520, lineHeight: 1.6 }}>
          Roadmap-ul nostru este public. Ai o sugestie sau o funcționalitate critică?{' '}
          <Link to="/contact" style={{ color: 'var(--kimono-orange)', fontWeight: 500 }}>Scrie-ne</Link>.
        </p>
      </div>

      <div style={{ maxWidth: 820, margin: '0 auto', padding: '0 clamp(20px, 5vw, 32px) clamp(48px, 8vw, 80px)' }}>
        {ROADMAP.map((quarter, qi) => (
          <div key={qi} style={{ marginBottom: 48 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>{quarter.quarter}</h2>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 99, background: quarter.statusBg, color: quarter.statusColor }}>
                {quarter.statusLabel}
              </span>
            </div>
            <div style={{ background: 'white', border: '0.5px solid var(--border-default)', borderRadius: 12, overflow: 'hidden' }}>
              {quarter.items.map((item, ii) => (
                <div key={ii} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderBottom: ii < quarter.items.length - 1 ? '0.5px solid var(--border-default)' : undefined }}>
                  <div style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: item.done ? quarter.statusBg : 'var(--bg-tertiary)' }}>
                    {item.done
                      ? <svg width="11" height="11" viewBox="0 0 12 12"><path d="M2 6l3 3 5-5" stroke={quarter.statusColor} strokeWidth="1.5" strokeLinecap="round" fill="none"/></svg>
                      : <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--border-default)' }} />
                    }
                  </div>
                  <span style={{ fontSize: 13, color: item.done ? 'var(--text-primary)' : 'var(--text-secondary)', textDecoration: item.done ? undefined : undefined }}>
                    {item.text}
                  </span>
                  {item.done && (
                    <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 600, color: quarter.statusColor, flexShrink: 0 }}>✓ Disponibil</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        <div style={{ background: 'white', border: '0.5px solid var(--border-default)', borderRadius: 12, padding: '24px', textAlign: 'center' }}>
          <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 8 }}>Ai o idee sau o funcționalitate care ți-ar schimba afacerea?</p>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>Construim Kimono BI împreună cu utilizatorii noștri. Votul tău contează.</p>
          <Link to="/contact" style={{ display: 'inline-block', padding: '9px 20px', background: 'var(--kimono-orange)', color: 'white', borderRadius: 8, fontSize: 13, fontWeight: 500, textDecoration: 'none' }}>
            Trimite o sugestie →
          </Link>
        </div>
      </div>

      <PublicFooter />
    </div>
  );
}