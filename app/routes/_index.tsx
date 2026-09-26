import { useState } from 'react';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { Link } from '@remix-run/react';
import { getUserFromRequest } from '~/lib/auth/session.server';
import { PublicFooter } from '~/components/PublicLayout';

export const meta: MetaFunction = () => [
  { title: 'Kimono BI — Business Intelligence pentru magazine eCommerce' },
  { name: 'description', content: 'Conectezi Shopify, eMag și GA4. Primești 29 module de analiză și AI care îți recomandă acțiuni săptămânale. Cere acces și încearcă cu codul de invitație — 14 zile trial pe Growth.' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (user) return redirect('/dashboard');
  return json({});
}

const TOTAL_MODULES = 29;

// KPI cards reale din pagina Today (dashboard)
const KPI_PREVIEW = [
  { label: 'Venit azi', value: '12.480', unit: 'RON', delta: '+18%', deltaColor: 'var(--success-text)', sub: '10.580 RON ieri' },
  { label: 'Comenzi azi', value: '47', unit: '', delta: '+12%', deltaColor: 'var(--success-text)', sub: '42 ieri' },
  { label: 'Valoare medie comandă', value: '265', unit: 'RON', delta: '−5%', deltaColor: 'var(--warning-text)', sub: '252 RON ieri' },
  { label: 'Health Score', value: '78', unit: '/100', delta: 'Magazin sănătos', deltaColor: 'var(--success-text)', sub: '4 segmente verzi' },
];

const FEATURED = [
  { cat: 'AI', title: 'Ask AI', promise: 'Întrebi în limba ta. Primești cifre din magazinul tău.', sample: '„Cine sunt champions inactivi de 60+ zile?" → 47 clienți, LTV cumulat €38.420.' },
  { cat: 'AI', title: 'AI Advisor săptămânal', promise: 'Luni dimineața în inbox: top 3 mișcări pentru săptămâna asta.', sample: 'Prioritizate după impact estimat. Nu liste de 30 de „things to consider".' },
  { cat: 'Clienți', title: 'RFM Segmentation', promise: 'Champions, At Risk, Lost. Lista exportabilă, gata de campanie.', sample: '8 segmente cu strategie pre-formulată. Fără tabele Excel.' },
  { cat: 'Clienți', title: 'LTV Analytics', promise: 'Cât poți cheltui pe achiziție și să rămâi profitabil.', sample: 'LTV per segment, calibrat pe istoricul tău — nu media industriei.' },
  { cat: 'Vânzări', title: 'Revenue Forecast', promise: 'Unde aterizezi luna asta — cu sezonalitate românească inclusă.', sample: 'Black Friday, vară, Crăciun: nu mai prezici „pe simțit".' },
  { cat: 'Stoc', title: 'Stockout Loss', promise: 'Cifra exactă pe care o pierzi azi din rafturi goale.', sample: 'De obicei: surpriză. Apoi: cash recuperat în 30 de zile.' },
  { cat: 'Profit', title: 'Contribution Margin', promise: 'Profit real pe comandă — cu COGS, transport, procesare incluse.', sample: 'Comanda de 1.200 lei pe care o credeai bună poate fi pe minus 40.' },
  { cat: 'AI', title: 'BI Audit', promise: '8 domenii ale magazinului, cu scoruri și PDF brandat.', sample: 'Îl trimiți investitorilor ca atare. Sau îl folosești pentru board.' },
];

const CATEGORIES_SUMMARY = [
  { label: 'Analiză vânzări', count: 7, sample: 'Dashboard · Forecast · Period Compare · Anomalies · Goal Tracker · Peak Hours · GA4' },
  { label: 'Inteligență clienți', count: 6, sample: 'RFM · Cohorts · LTV · Churn Risk · Repeat Purchase · Basket Analysis' },
  { label: 'Stoc & inventar', count: 5, sample: 'Stock · Stockout · Turnover · BCG Matrix · Scale recommendations' },
  { label: 'Profit & operațional', count: 6, sample: 'Margin · Profitability · Pricing · Discount Impact · Refunds · Fulfilment' },
  { label: 'AI & rapoarte', count: 5, sample: 'Ask AI · AI Advisor · Narrative · Audit · Digest · Annotations' },
];

const SITUATIONS = [
  { when: 'Vineri, 18:30', line: 'Vânzările s-au oprit acum o oră.', why: 'Top-seller-ul a ieșit din stoc joi seara, dar nimeni n-a apucat să sune furnizorul. Stockout Loss ți-ar fi sunat alarma joi la 17:30 — încă era timp pentru o comandă urgentă.' },
  { when: 'Luni dimineață', line: 'Cifra de afaceri arată bine. Față de ce?', why: 'Față de aceeași zi din săptămâna trecută? De luna trecută? De ce ar fi trebuit? Period Compare îți răspunde în 3 secunde, în formatul în care îl și citești.' },
  { when: 'Săptămâna asta', line: 'Comanda de 1.200 lei părea bună.', why: 'Cu transportul gratuit, returul parțial și procesarea cardului — ai pierdut 40 lei pe ea. Câte comenzi din săptămâna asta sunt așa? Contribution Margin face socoteala.' },
  { when: 'În baza ta de date', line: '30.000 de emailuri.', why: 'Care 200 merită campania de win-back de săptămâna asta? Care 50 sunt la o comandă de a deveni Champions? RFM + Churn Risk îți dau listele exportate, gata de copy-paste în Mailchimp.' },
];

const STEPS = [
  { num: '01', badge: '2 minute', title: 'Conectezi magazinul', desc: 'OAuth Shopify, eMag sau GA4. Tokens criptați AES-256-GCM. Nu copiezi niciun API key în clipboard.' },
  { num: '02', badge: 'Automat, în background', title: 'Sincronizăm tot istoricul', desc: 'Comenzi, produse, clienți, refunds, fulfilments. Apoi sync incremental la fiecare 30 de minute. Nu te deranjăm.' },
  { num: '03', badge: 'În fiecare luni', title: 'Primești recomandări', desc: 'AI Advisor cu top 3 acțiuni pentru săptămână. Email digest cu cifrele. Alerte Slack/email când ceva se rupe.' },
];

const PERSONAS = [
  { role: 'Founder', headline: 'Vrei să dormi liniștit știind că nu pierzi din mână.', body: 'BI Audit lunar pe 8 domenii. AI Narrative pentru board. Forecast cu sezonalitate RO. Shareable reports pentru investitori — link, nu PowerPoint.' },
  { role: 'Marketing director', headline: 'Vrei să trimiți mai puține emailuri. Și să convertească mai mult.', body: 'RFM cu strategie pe fiecare din cele 8 segmente. Champions care n-au mai cumpărat de 60 de zile, izolați automat. Discount Impact: cât canibalizezi, cât adaugi.' },
  { role: 'Operations', headline: 'Vrei să nu mai cumperi prea mult, prea puțin sau prea târziu.', body: 'Stockout Loss pe produs/zi. Turnover + dead stock identificat înainte să-ți blocheze cash. Time to Fulfilment cu bottleneck-urile evidențiate.' },
];

const numberFont = { fontFeatureSettings: '"tnum" 1, "lnum" 1' } as React.CSSProperties;

export default function LandingPage() {
  const [navOpen, setNavOpen] = useState(false);
  const NAV_ITEMS = [
    { href: '#platforma', label: 'Platforma' },
    { href: '#ai', label: 'AI' },
    { href: '#cum-functioneaza', label: 'Cum funcționează' },
    { href: '#pentru-cine', label: 'Pentru cine' },
    { href: '/pricing', label: 'Abonamente' },
  ];
  return (
    <div style={{ background: 'white', color: 'var(--text-primary)', minHeight: '100vh', fontFamily: 'var(--font-sans)' }}>

      {/* ---------- Nav ---------- */}
      <nav className="kbi-pub-nav" style={{
        borderBottom: '0.5px solid var(--border-default)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'rgba(255,255,255,0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit' }}>
            <img src="/logo-kimono-bi.svg" alt="Kimono BI" style={{ height: 28, width: 'auto' }} />
          </Link>
          <div className="kbi-pub-nav-links" style={{ color: 'var(--text-secondary)' }}>
            {NAV_ITEMS.map((it) => it.href.startsWith('/')
              ? <Link key={it.href} to={it.href} style={{ color: 'inherit', textDecoration: 'none' }}>{it.label}</Link>
              : <a key={it.href} href={it.href} style={{ color: 'inherit', textDecoration: 'none' }}>{it.label}</a>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link to="/login" className="kbi-pub-nav-cta-text" style={{ fontSize: 13, color: 'var(--text-secondary)', textDecoration: 'none' }}>Conectează-te</Link>
          <Link to="/register" style={{ padding: '8px 16px', background: 'var(--kimono-orange)', color: 'white', borderRadius: 7, fontSize: 13, fontWeight: 600, textDecoration: 'none', display: 'inline-block', whiteSpace: 'nowrap' }}>
            Începe gratuit
          </Link>
          <button className="kbi-hamburger" onClick={() => setNavOpen(!navOpen)} aria-label={navOpen ? 'Închide meniul' : 'Deschide meniul'} aria-expanded={navOpen}>
            {navOpen ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            )}
          </button>
        </div>
      </nav>
      {navOpen && (
        <div className="kbi-mobile-menu">
          {NAV_ITEMS.map((it) => it.href.startsWith('/')
            ? <Link key={it.href} to={it.href} onClick={() => setNavOpen(false)}>{it.label}</Link>
            : <a key={it.href} href={it.href} onClick={() => setNavOpen(false)}>{it.label}</a>
          )}
          <Link to="/login" onClick={() => setNavOpen(false)}>Conectează-te</Link>
          <Link to="/register" className="kbi-mm-cta" onClick={() => setNavOpen(false)}>Începe gratuit</Link>
        </div>
      )}

      {/* ---------- Hero — concret cu KPI preview ---------- */}
      <div style={{ background: 'linear-gradient(180deg, var(--kimono-orange-bg) 0%, white 80%)', borderBottom: '0.5px solid var(--border-default)' }}>
        <div className="kbi-hero-wrap" style={{ maxWidth: 1180, margin: '0 auto' }}>

          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px', background: 'white', border: '0.5px solid var(--kimono-orange-border)', borderRadius: 999, fontSize: 11, color: 'var(--kimono-orange-text)', marginBottom: 28, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
              <span style={{ width: 6, height: 6, background: 'var(--kimono-orange)', borderRadius: '50%' }} />
              Business Intelligence pentru eCommerce
            </div>

            <h1 style={{
              margin: '0 auto 24px',
              maxWidth: 920,
              fontSize: 'clamp(34px, 6vw, 64px)',
              fontWeight: 500,
              letterSpacing: 'clamp(-1.2px, -0.25vw, -2.5px)',
              lineHeight: 1.05,
              color: 'var(--text-primary)',
            }}>
              Toate cifrele magazinului tău. <br/>
              <span style={{ color: 'var(--kimono-orange)' }}>Plus AI-ul care îți spune ce să faci cu ele.</span>
            </h1>

            <p style={{ margin: '0 auto 36px', maxWidth: 620, fontSize: 'clamp(15px, 1.7vw, 18px)', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              Conectezi Shopify, eMag sau GA4 în 2 minute. Primești <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{TOTAL_MODULES} module de analiză</strong> și <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>3 layere de AI</strong> care îți recomandă acțiuni săptămânale — în limba ta, cu sume și nume din magazinul tău.
            </p>

            <div className="kbi-cta-group" style={{ justifyContent: 'center' }}>
              <Link to="/register" style={{ padding: '14px 28px', background: 'var(--kimono-orange)', color: 'white', borderRadius: 8, fontSize: 14.5, fontWeight: 600, textDecoration: 'none', display: 'inline-block' }}>
                Începe acum →
              </Link>
              <a href="#platforma" style={{ padding: '14px 28px', background: 'white', color: 'var(--text-primary)', border: '0.5px solid var(--border-strong)', borderRadius: 8, fontSize: 14.5, fontWeight: 500, textDecoration: 'none', display: 'inline-block' }}>
                Vezi platforma
              </a>
              <span className="kbi-cta-microcopy" style={{ fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 8 }}>
14 zile trial cu cod · setup în 2 minute
              </span>
            </div>
          </div>

          {/* KPI preview — arată concret ce vede utilizatorul */}
          <div style={{ marginTop: 24, background: 'white', border: '0.5px solid var(--border-default)', borderRadius: 14, overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,0.06), 0 1px 0 rgba(216,90,48,0.04)' }}>
            <div style={{ padding: '14px 22px', borderBottom: '0.5px solid var(--border-default)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-page)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--text-tertiary)' }}>
                <div style={{ width: 8, height: 8, background: 'var(--success-bg-strong)', borderRadius: '50%' }} />
                <span style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>magazinul-tau.ro</span>
                <span style={{ color: 'var(--text-muted)' }}>· Live · sync acum 4 minute</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase' as const, letterSpacing: '1px', fontWeight: 600 }}>Today · azi</div>
            </div>
            <div className="kbi-kpi-grid">
              {KPI_PREVIEW.map((k, i) => (
                <div key={k.label} className="kbi-kpi-cell" style={{ padding: '24px 22px', borderRight: i < 3 ? '0.5px solid var(--border-default)' : undefined }}>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase' as const, letterSpacing: '0.8px', fontWeight: 600, marginBottom: 10 }}>{k.label}</div>
                  <div style={{ ...numberFont, display: 'flex', alignItems: 'baseline', gap: 4 }}>
                    <span style={{ fontSize: 28, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.8px', lineHeight: 1 }}>{k.value}</span>
                    {k.unit && <span style={{ fontSize: 13, color: 'var(--text-tertiary)', fontWeight: 500 }}>{k.unit}</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 8 }}>
                    <span style={{ ...numberFont, fontSize: 12, fontWeight: 600, color: k.deltaColor }}>{k.delta}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{k.sub}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>

      {/* ---------- Integrat cu ---------- */}
      <div style={{ padding: 'clamp(40px, 6vw, 64px) clamp(20px, 5vw, 40px)', background: 'var(--bg-page)', borderTop: '0.5px solid var(--border-default)', borderBottom: '0.5px solid var(--border-default)' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontSize: 'clamp(22px, 3vw, 30px)', fontWeight: 500, letterSpacing: '-0.5px', color: 'var(--text-primary)', margin: '0 0 6px' }}>
            Integrare cu platformele tale
          </h2>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '0 0 36px', maxWidth: 520, marginLeft: 'auto', marginRight: 'auto' }}>
            Conectezi magazinul in cateva minute. Datele se sincronizeaza automat.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, maxWidth: 720, margin: '0 auto' }}>

            <div style={{ background: 'white', border: '0.5px solid var(--border-default)', borderRadius: 14, padding: 'clamp(20px, 3vw, 28px)', textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
              <div style={{ width: 56, height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                <img src="/shopify-icon.svg" alt="Shopify" style={{ width: 48, height: 48 }} />
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>Shopify</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>Admin API cu token dedicat</div>
              <div style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, background: 'rgba(90,138,0,0.1)', color: '#5a8a00', fontSize: 11, fontWeight: 600 }}>Disponibil</div>
            </div>

            <div style={{ background: 'white', border: '0.5px solid var(--border-default)', borderRadius: 14, padding: 'clamp(20px, 3vw, 28px)', textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
              <div style={{ width: 56, height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                <img src="/woocommerce-icon.svg" alt="WooCommerce" style={{ width: 48, height: 48 }} />
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>WooCommerce</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>Plugin lightweight dedicat</div>
              <div style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, background: 'rgba(90,138,0,0.1)', color: '#5a8a00', fontSize: 11, fontWeight: 600 }}>Disponibil</div>
            </div>

            <div style={{ background: 'white', border: '0.5px solid var(--border-default)', borderRadius: 14, padding: 'clamp(20px, 3vw, 28px)', textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
              <div style={{ width: 56, height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                <img src="/emag-icon.png" alt="eMag" style={{ height: 32, width: 'auto' }} />
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>eMag Marketplace</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>API marketplace oficial</div>
              <div style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, background: 'rgba(255,90,31,0.08)', color: 'var(--kimono-orange)', fontSize: 11, fontWeight: 600 }}>In dezvoltare</div>
            </div>

          </div>
        </div>
      </div>

      {/* ---------- Situații ---------- */}
      <div className="kbi-pub-section" style={{ background: 'white' }}>
        <div style={{ maxWidth: 980, margin: '0 auto' }}>
          <div style={{ marginBottom: 56, maxWidth: 720 }}>
            <div className="kbi-eyebrow"><span className="kbi-eyebrow-line" /> Patru momente. Patru răspunsuri.</div>
            <h2 style={{ fontSize: 'clamp(28px, 4.5vw, 44px)', fontWeight: 500, letterSpacing: 'clamp(-0.8px, -0.15vw, -1.5px)', lineHeight: 1.1, color: 'var(--text-primary)', margin: 0 }}>
              Astea sunt întrebările pe care ți le pui oricum.<br/>
              <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>Acum ai și răspunsurile.</span>
            </h2>
          </div>

          <div>
            {SITUATIONS.map((sit, i) => (
              <div key={i} className="kbi-situation-row" style={{ borderBottom: i === SITUATIONS.length - 1 ? '0.5px solid var(--border-default)' : undefined }}>
                <div>
                  <div style={{ ...numberFont, fontSize: 13, fontWeight: 600, color: 'var(--kimono-orange)', letterSpacing: '0.5px' }}>0{i + 1}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4, fontWeight: 500 }}>{sit.when}</div>
                </div>
                <div>
                  <div style={{ fontSize: 'clamp(18px, 2.4vw, 22px)', fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '-0.4px', lineHeight: 1.3, marginBottom: 12 }}>{sit.line}</div>
                  <p style={{ fontSize: 14.5, color: 'var(--text-secondary)', lineHeight: 1.65, margin: 0, maxWidth: 680 }}>{sit.why}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ---------- Featured modules ---------- */}
      <div id="platforma" className="kbi-pub-section" style={{ background: 'var(--bg-page)' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto' }}>

          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <div className="kbi-eyebrow" style={{ justifyContent: 'center' }}>
              <span className="kbi-eyebrow-line" /> Platforma <span className="kbi-eyebrow-line" />
            </div>
            <h2 style={{ fontSize: 'clamp(28px, 4.5vw, 44px)', fontWeight: 500, letterSpacing: 'clamp(-0.8px, -0.15vw, -1.5px)', lineHeight: 1.1, color: 'var(--text-primary)', margin: 0 }}>
              Opt module pe care le folosești săptămânal.<br/>
              <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}>Și încă {TOTAL_MODULES - 8} pentru când îți trebuie.</span>
            </h2>
          </div>

          <div className="kbi-modules-grid">
            {FEATURED.map((m) => (
              <div key={m.title} className="kbi-mod-card">
                <div style={{ fontSize: 10, color: 'var(--kimono-orange-text)', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '1.2px', marginBottom: 16 }}>{m.cat}</div>
                <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 10, letterSpacing: '-0.3px', color: 'var(--text-primary)' }}>{m.title}</div>
                <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.55, margin: '0 0 14px', fontWeight: 400 }}>{m.promise}</p>
                <div style={{ paddingTop: 14, borderTop: '0.5px dashed var(--border-default)', fontSize: 12.5, color: 'var(--text-tertiary)', lineHeight: 1.55, fontStyle: 'italic' }}>
                  {m.sample}
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 32, padding: 'clamp(24px, 4vw, 36px)', background: 'white', border: '0.5px solid var(--border-default)', borderRadius: 14 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap' as const, gap: 12, marginBottom: 24, paddingBottom: 20, borderBottom: '0.5px solid var(--border-default)' }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.3px', color: 'var(--text-primary)' }}>+ încă {TOTAL_MODULES - 8} module disponibile</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4, fontWeight: 400 }}>Grupate în 5 categorii care vorbesc între ele.</div>
              </div>
              <Link to="/functionalitati" style={{ fontSize: 13, color: 'var(--text-primary)', textDecoration: 'none', fontWeight: 500, borderBottom: '1px solid var(--text-primary)', paddingBottom: 2 }}>Vezi toate funcționalitățile →</Link>
            </div>
            <div className="kbi-cat-grid">
              {CATEGORIES_SUMMARY.map((c) => (
                <div key={c.label}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text-primary)' }}>{c.label}</div>
                    <div style={{ ...numberFont, fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600 }}>{c.count}</div>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>{c.sample}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ---------- AI showcase ---------- */}
      <div id="ai" className="kbi-pub-section" style={{ background: 'var(--bg-darkest)', color: 'white', overflow: 'hidden' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto' }}>
          <div className="kbi-ai-grid">

            <div>
              <div style={{ fontSize: 11, color: '#FFB590', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '1.5px', marginBottom: 22, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ display: 'inline-block', width: 18, height: 1, background: 'var(--kimono-orange)' }} />
                Trei layere de AI
              </div>
              <h2 style={{ fontSize: 'clamp(28px, 4.5vw, 44px)', fontWeight: 500, letterSpacing: 'clamp(-0.8px, -0.15vw, -1.5px)', lineHeight: 1.1, color: 'white', margin: '0 0 24px' }}>
                Nu mai trebuie să întrebi <em style={{ color: 'var(--kimono-orange)', fontWeight: 400 }}>„și ce înseamnă asta?"</em>
              </h2>
              <p style={{ fontSize: 16, color: '#B4B2A9', lineHeight: 1.65, margin: '0 0 28px', fontWeight: 400, maxWidth: 460 }}>
                <strong style={{ color: 'white', fontWeight: 600 }}>Ask AI</strong> răspunde la întrebări în limba ta. <strong style={{ color: 'white', fontWeight: 600 }}>AI Advisor</strong> îți dă top 3 acțiuni săptămânale. <strong style={{ color: 'white', fontWeight: 600 }}>AI Narrative</strong> îți scrie raportul ca un memo de board.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 12 }}>
                {[
                  'Răspunsuri cu sume și nume din magazinul tău',
                  'Prompts calibrate pentru context eCommerce românesc',
                  'Recomandări prioritizate după impact estimat',
                  'PDF brandat — îl trimiți investitorilor ca atare',
                ].map((b) => (
                  <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13.5, color: '#E5E5E5' }}>
                    <span style={{ display: 'inline-block', width: 14, height: 1, background: 'var(--kimono-orange)', flexShrink: 0 }} />
                    {b}
                  </div>
                ))}
              </div>
            </div>

            {/* Terminal mock */}
            <div style={{ background: '#0A0A0A', border: '1px solid #1F1F1F', borderRadius: 14, padding: 'clamp(20px, 3vw, 28px)', fontFamily: 'ui-monospace, SF Mono, Monaco, monospace', boxShadow: '0 20px 60px rgba(216,90,48,0.08)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#FF5F57' }} />
                  <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#FEBC2E' }} />
                  <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#28C840' }} />
                </div>
                <div style={{ fontSize: 10.5, color: '#5F5E5A', letterSpacing: '0.5px' }}>ask-ai · magazinul-tau.ro</div>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.85 }}>
                <div style={{ color: '#5F5E5A', fontSize: 11 }}>// Întreabă orice. În limba ta.</div>
                <div style={{ color: '#FFB590', marginTop: 14, fontWeight: 500 }}>
                  <span style={{ color: '#5F5E5A' }}>{'>'}</span> care sunt champions inactivi de 60+ zile?
                </div>
                <div style={{ color: '#5DCAA5', marginTop: 18 }}>47 clienți Champions inactivi de 60+ zile.</div>
                <div style={{ color: '#E5E5E5', marginTop: 8, ...numberFont }}>LTV cumulat: <strong style={{ color: 'white' }}>€38.420</strong></div>
                <div style={{ color: '#E5E5E5', ...numberFont }}>Comandă medie: <strong style={{ color: 'white' }}>€127</strong></div>
                <div style={{ color: '#E5E5E5' }}>Top 5: Maria P. <span style={numberFont}>(€1.890)</span>, Andrei C. <span style={numberFont}>(€1.640)</span>...</div>
                <div style={{ marginTop: 18, padding: '14px 16px', background: 'rgba(216,90,48,0.08)', border: '1px solid rgba(216,90,48,0.2)', borderRadius: 6, color: '#FFB590', fontSize: 12, lineHeight: 1.55 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Recomandare</div>
                  Campanie email cu cod 15% pe categoria preferată per client. Estimat ROI: <strong style={{ color: 'white' }}>€8.200</strong> recovered revenue în 14 zile.
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* ---------- How it works ---------- */}
      <div id="cum-functioneaza" className="kbi-pub-section" style={{ background: 'white' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto' }}>

          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <div className="kbi-eyebrow" style={{ justifyContent: 'center' }}>
              <span className="kbi-eyebrow-line" /> Cum funcționează <span className="kbi-eyebrow-line" />
            </div>
            <h2 style={{ fontSize: 'clamp(28px, 4.5vw, 44px)', fontWeight: 500, letterSpacing: 'clamp(-0.8px, -0.15vw, -1.5px)', lineHeight: 1.1, color: 'var(--text-primary)', margin: 0 }}>
              De la zero la primul insight.<br/>
              <span style={{ ...numberFont, fontWeight: 400, color: 'var(--text-secondary)' }}>Cinci minute.</span>
            </h2>
          </div>

          <div className="kbi-steps-grid">
            {STEPS.map((step) => (
              <div key={step.num} className="kbi-step-cell">
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 18 }}>
                  <div style={{ ...numberFont, fontSize: 14, fontWeight: 600, color: 'var(--kimono-orange)', letterSpacing: '0.5px' }}>{step.num}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase' as const, letterSpacing: '1px', fontWeight: 500 }}>{step.badge}</div>
                </div>
                <div style={{ fontSize: 'clamp(18px, 2.2vw, 22px)', fontWeight: 500, marginBottom: 10, letterSpacing: '-0.4px', color: 'var(--text-primary)', lineHeight: 1.2 }}>{step.title}</div>
                <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.65, margin: 0, fontWeight: 400 }}>{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ---------- Pentru cine ---------- */}
      <div id="pentru-cine" className="kbi-pub-section" style={{ background: 'var(--bg-page)' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <div className="kbi-eyebrow" style={{ justifyContent: 'center' }}>
              <span className="kbi-eyebrow-line" /> Pentru cine <span className="kbi-eyebrow-line" />
            </div>
            <h2 style={{ fontSize: 'clamp(28px, 4.5vw, 44px)', fontWeight: 500, letterSpacing: 'clamp(-0.8px, -0.15vw, -1.5px)', lineHeight: 1.1, color: 'var(--text-primary)', margin: 0 }}>
              Aceeași platformă.<br/>
              <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}>Trei perspective.</span>
            </h2>
          </div>

          <div className="kbi-personas-grid">
            {PERSONAS.map((p) => (
              <div key={p.role} style={{ background: 'white', border: '0.5px solid var(--border-default)', borderRadius: 14, padding: 'clamp(24px, 3.5vw, 36px)' }}>
                <div style={{ fontSize: 11, color: 'var(--kimono-orange-text)', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '1.2px', marginBottom: 18, paddingBottom: 18, borderBottom: '0.5px solid var(--border-default)' }}>{p.role}</div>
                <div style={{ fontSize: 'clamp(18px, 2.2vw, 22px)', fontWeight: 500, lineHeight: 1.25, letterSpacing: '-0.4px', marginBottom: 16, color: 'var(--text-primary)' }}>{p.headline}</div>
                <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.65, margin: 0, fontWeight: 400 }}>{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ---------- Comparison ---------- */}
      <div className="kbi-pub-section" style={{ background: 'white' }}>
        <div style={{ maxWidth: 880, margin: '0 auto' }}>

          <div style={{ marginBottom: 48, maxWidth: 660 }}>
            <div className="kbi-eyebrow"><span className="kbi-eyebrow-line" /> Valoare</div>
            <h2 style={{ fontSize: 'clamp(28px, 4.5vw, 44px)', fontWeight: 500, letterSpacing: 'clamp(-0.8px, -0.15vw, -1.5px)', lineHeight: 1.1, color: 'var(--text-primary)', margin: 0 }}>
              Ce-ar costa să refaci asta cu oameni?
            </h2>
          </div>

          <div>
            {[
              { who: 'Un analist BI part-time', cost: '€1.500', period: '/ lună', note: 'Și aștepți rapoartele luni dimineața.' },
              { who: 'Looker / Power BI custom + integrator', cost: '€3.000', period: 'setup + €400/lună', note: '3 luni de implementare. Apoi îl întreții singur.' },
              { who: 'Tool dedicat pentru inventory', cost: '€150', period: '/ lună', note: 'Alt SaaS, alt login, alt set de credențiale.' },
              { who: 'AI consultant pe insights eCommerce', cost: '€100', period: '/ oră', note: 'Și nu cunoaște magazinul tău.' },
            ].map((row, i) => (
              <div key={row.who} className="kbi-cmp-row" style={{ borderBottom: i === 3 ? '0.5px solid var(--border-default)' : undefined }}>
                <div>
                  <div style={{ fontSize: 15.5, fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '-0.2px' }}>{row.who}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 4, fontStyle: 'italic' }}>{row.note}</div>
                </div>
                <div className="kbi-cmp-cost" style={{ ...numberFont, textAlign: 'right' as const, whiteSpace: 'nowrap' as const }}>
                  <span style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '-0.5px' }}>{row.cost}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 4 }}>{row.period}</span>
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 36, padding: 'clamp(24px, 4vw, 36px)', background: 'var(--bg-darkest)', borderRadius: 14, color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' as const, gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, color: '#FFB590', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '1.2px', marginBottom: 8 }}>Tu plătești</div>
              <div style={{ ...numberFont, fontSize: 'clamp(28px, 4vw, 36px)', fontWeight: 500, letterSpacing: '-1.2px', color: 'white', lineHeight: 1 }}>
                de la €49 <span style={{ fontSize: 16, fontWeight: 400, color: '#888780' }}>/ lună</span>
              </div>
              <div style={{ fontSize: 13, color: '#888780', marginTop: 8 }}>Și totul e gata vineri dimineață.</div>
            </div>
            <Link to="/pricing" style={{ padding: '12px 22px', background: 'var(--kimono-orange)', color: 'white', borderRadius: 8, fontSize: 13.5, fontWeight: 600, textDecoration: 'none' }}>Vezi abonamentele →</Link>
          </div>
        </div>
      </div>

      {/* ---------- Trust strip ---------- */}
      <div style={{ padding: 'clamp(40px, 6vw, 56px) clamp(20px, 5vw, 40px)', background: 'var(--bg-page)', borderTop: '0.5px solid var(--border-default)', borderBottom: '0.5px solid var(--border-default)' }}>
        <div className="kbi-trust-grid" style={{ maxWidth: 1080, margin: '0 auto' }}>
          {[
            { title: 'GDPR compliant', sub: 'Date stocate în Europa, criptate la rest.' },
            { title: 'AES-256-GCM', sub: 'Tokens criptați end-to-end. Nicio terță parte.' },
            { title: 'Anulezi oricând', sub: 'Fără penalități. Fără perioadă minimă.' },
            { title: 'Suport în română', sub: 'Echipă în București.' },
          ].map((t) => (
            <div key={t.title} className="kbi-trust-cell">
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6, letterSpacing: '-0.1px' }}>{t.title}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>{t.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ---------- Final CTA ---------- */}
      <div style={{ padding: 'clamp(72px, 10vw, 120px) clamp(20px, 5vw, 40px)', background: 'var(--bg-darkest)', color: 'white', textAlign: 'center' as const }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div style={{ fontSize: 11, color: '#FFB590', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '1.5px', marginBottom: 28, display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center', flexWrap: 'wrap' as const }}>
            <span style={{ display: 'inline-block', width: 18, height: 1, background: 'var(--kimono-orange)' }} />
            14 zile trial · cu card · anulezi oricând
            <span style={{ display: 'inline-block', width: 18, height: 1, background: 'var(--kimono-orange)' }} />
          </div>
          <h2 style={{ margin: '0 auto 22px', fontSize: 'clamp(28px, 5vw, 48px)', fontWeight: 500, letterSpacing: 'clamp(-1px, -0.2vw, -1.8px)', lineHeight: 1.1, color: 'white' }}>
            Săptămâna viitoare poți deschide luni dimineață<br/>
            <em style={{ color: 'var(--kimono-orange)', fontWeight: 400 }}>un email cu top 3 acțiuni.</em>
          </h2>
          <p style={{ margin: '0 auto 36px', maxWidth: 480, fontSize: 15, color: '#B4B2A9', lineHeight: 1.6 }}>
            Sau poți continua să sapi prin export-uri CSV duminică seara. Alegerea ta.
          </p>
          <div className="kbi-cta-group" style={{ justifyContent: 'center' }}>
            <Link to="/register" style={{ padding: '15px 30px', background: 'var(--kimono-orange)', color: 'white', borderRadius: 8, fontSize: 15, fontWeight: 600, textDecoration: 'none', display: 'inline-block' }}>
              Începe gratuit →
            </Link>
            <Link to="/pricing" style={{ padding: '15px 30px', background: 'transparent', color: 'white', border: '0.5px solid #3A3A3A', borderRadius: 8, fontSize: 15, fontWeight: 500, textDecoration: 'none', display: 'inline-block' }}>
              Vezi abonamentele
            </Link>
          </div>
        </div>
      </div>

      <PublicFooter />
    </div>
  );
}
