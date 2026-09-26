import type { MetaFunction } from '@remix-run/node';
import { Link } from '@remix-run/react';
import { PublicNav, PublicFooter } from '~/components/PublicLayout';

export const meta: MetaFunction = () => [
  { title: 'Documentație — Kimono BI' },
  { name: 'description', content: 'Ghiduri de utilizare, integrări și documentație tehnică pentru Kimono BI.' },
];

const SECTIONS = [
  {
    category: 'Primii pași',
    color: '#D85A30',
    icon: '🚀',
    articles: [
      { title: 'Creează-ți primul cont', desc: 'Proces de înregistrare, verificare email și activare cont.' },
      { title: 'Conectează primul magazin', desc: 'Cum să legi Shopify, WooCommerce sau eMag la Kimono BI.' },
      { title: 'Prima sincronizare de date', desc: 'Ce se întâmplă după conectare: ce date sunt importate și în cât timp.' },
      { title: 'Navighează prin Dashboard', desc: 'Prezentare generală a interfeței și a modulelor disponibile.' },
    ],
  },
  {
    category: 'Integrări',
    color: '#0369a1',
    icon: '🔌',
    articles: [
      { title: 'Integrare Shopify', desc: 'Conectare via Admin API, permisiuni necesare, sincronizare în timp real.' },
      { title: 'Integrare WooCommerce', desc: 'Conectare OAuth sau Consumer Key/Secret. Cerințe minime versiune.' },
      { title: 'Integrare eMag Marketplace', desc: 'Import comenzi și produse din contul eMag. Multi-cont support.' },
      { title: 'Integrare Google Analytics 4', desc: 'Conectare GA4, date de trafic și corelare cu vânzările.' },
    ],
  },
  {
    category: 'Module de analiză',
    color: '#7c3aed',
    icon: '📊',
    articles: [
      { title: 'Dashboard live — ghid complet', desc: 'Explicarea fiecărui KPI, perioadele de comparație, grafice sparkline.' },
      { title: 'RFM Segmentation — cum funcționează', desc: 'Algoritmul RFM, cele 8 segmente, cum să acționezi pe fiecare.' },
      { title: 'Revenue Forecast — metodologie', desc: 'Ensemble de 4 modele: baseline, day-of-week, calendar RO, YoY.' },
      { title: 'Churn Prediction — interpretare scoruri', desc: 'Scorul 0-100, praguri de risc, acțiuni recomandate.' },
      { title: 'Cohort Analysis — citirea matricei', desc: 'Cum se construiesc cohortele și cum interpretezi retenția.' },
      { title: 'BCG Product Matrix', desc: 'Clasificarea Stars, Cash Cows, Question Marks, Dogs.' },
    ],
  },
  {
    category: 'AI & Rapoarte',
    color: '#854F0B',
    icon: '🤖',
    articles: [
      { title: 'Ask AI — cum să formulezi întrebări', desc: 'Tipuri de întrebări suportate, exemple, limitări.' },
      { title: 'AI Narrative Reports — configurare', desc: 'Frecvență, format, export PDF, disponibil în română și engleză.' },
      { title: 'Anomaly Detection — praguri și alerte', desc: 'Cum sunt detectate anomaliile, sensibilitate, notificări.' },
    ],
  },
  {
    category: 'Cont & Facturare',
    color: '#0F6E56',
    icon: '⚙️',
    articles: [
      { title: 'Gestionarea planului', desc: 'Upgrade, downgrade, plată anuală, facturi.' },
      { title: 'Membri echipă și roluri', desc: 'Roluri disponibile, permisiuni, invitare utilizatori noi.' },
      { title: 'Export și backup date', desc: 'Export CSV, descărcare date, ștergere cont.' },
      { title: 'Securitate și GDPR', desc: 'Criptare date, localizare servere, conformitate GDPR.' },
    ],
  },
];

export default function DocumentatiePage() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-page)', fontFamily: 'Inter, sans-serif' }}>
      <PublicNav />

      {/* Hero */}
      <div style={{ padding: 'clamp(48px, 7vw, 72px) clamp(20px, 5vw, 32px) clamp(36px, 6vw, 48px)', textAlign: 'center', background: 'linear-gradient(180deg, #F5F5FF 0%, var(--bg-page) 100%)' }}>
        <h1 style={{ fontSize: 'clamp(28px,4vw,40px)', fontWeight: 500, letterSpacing: '-1px', color: 'var(--text-primary)', margin: '0 auto 14px' }}>
          <span style={{ color: 'var(--kimono-orange)' }}>Documentație</span> Kimono BI
        </h1>
        <p style={{ fontSize: 16, color: 'var(--text-secondary)', margin: '0 auto 24px', maxWidth: 480 }}>
          Ghiduri pas cu pas, referințe tehnice și resurse pentru a scoate tot ce e mai bun din platformă.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', maxWidth: 400, margin: '0 auto' }}>
          <input type="search" placeholder="Caută în documentație..." className="form-input" style={{ flex: 1 }} />
          <button className="btn btn-primary">Caută</button>
        </div>
      </div>

      <div style={{ maxWidth: 960, margin: '0 auto', padding: '0 clamp(20px, 5vw, 32px) clamp(48px, 8vw, 80px)' }}>

        {/* Quick links */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 48 }}>
          {[
            { label: 'Conectare magazin', icon: '🔌', href: '#integrations' },
            { label: 'Ask AI', icon: '🤖', href: '#ai' },
            { label: 'Contact suport', href: '/contact', icon: '💬' },
          ].map((link) => (
            <Link key={link.label} to={link.href} style={{ background: 'white', border: '0.5px solid var(--border-default)', borderRadius: 10, padding: '14px 18px', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18 }}>{link.icon}</span>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{link.label}</span>
            </Link>
          ))}
        </div>

        {/* Sections */}
        {SECTIONS.map((section) => (
          <div key={section.category} style={{ marginBottom: 40 }} id={section.category.toLowerCase().replace(/\s+/g, '-')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 18 }}>{section.icon}</span>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>{section.category}</h2>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
              {section.articles.map((article) => (
                <div key={article.title} style={{ background: 'white', border: '0.5px solid var(--border-default)', borderRadius: 9, padding: '14px 16px', borderLeft: `3px solid ${section.color}`, cursor: 'pointer' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>{article.title}</div>
                  <p style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>{article.desc}</p>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Help CTA */}
        <div style={{ background: 'white', border: '0.5px solid var(--border-default)', borderRadius: 12, padding: '24px', textAlign: 'center' }}>
          <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 6 }}>Nu găsești ce cauți?</p>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>Echipa noastră răspunde în maxim 24h.</p>
          <Link to="/contact" style={{ display: 'inline-block', padding: '9px 20px', background: 'var(--kimono-orange)', color: 'white', borderRadius: 8, fontSize: 13, fontWeight: 500, textDecoration: 'none' }}>
            Contactează suportul →
          </Link>
        </div>
      </div>

      <PublicFooter />
    </div>
  );
}