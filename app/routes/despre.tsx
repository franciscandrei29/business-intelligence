import type { MetaFunction } from '@remix-run/node';
import { Link } from '@remix-run/react';
import { PublicNav, PublicFooter } from '~/components/PublicLayout';

export const meta: MetaFunction = () => [
  { title: 'Despre noi — Kimono BI' },
  { name: 'description', content: 'Kimono Group — echipă de management și marketing strategic pentru afaceri digitale.' },
];

const VALUES = [
  { title: 'Date, nu opinii', desc: 'Fiecare funcționalitate pe care o construim pleacă de la date reale și feedback direct de la utilizatori.' },
  { title: 'Simplitate radicală', desc: 'BI-ul nu trebuie să fie complicat. Dacă nu poți înțelege un grafic în 5 secunde, l-am construit greșit.' },
  { title: 'Construit pentru România', desc: 'Calendarul fiscal românesc, eMag, plăți în RON/EUR — construim pentru piața locală, nu portăm un produs american.' },
  { title: 'Transparent by default', desc: 'Roadmap public, prețuri clare, fără contracte ascunse. Trustul se construiește prin transparență.' },
];

export default function DesprePage() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-page)', fontFamily: 'Inter, sans-serif' }}>
      <PublicNav />

      {/* Hero */}
      <div style={{ padding: 'clamp(56px, 8vw, 80px) clamp(20px, 5vw, 32px) clamp(48px, 7vw, 64px)', textAlign: 'center', background: 'linear-gradient(180deg, #FFF5F0 0%, var(--bg-page) 100%)' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', background: 'white', border: '0.5px solid rgba(216,90,48,0.3)', borderRadius: 999, fontSize: 11, color: 'var(--kimono-orange)', fontWeight: 600, marginBottom: 20, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Cine suntem
        </div>
        <h1 style={{ fontSize: 'clamp(28px,4vw,44px)', fontWeight: 500, letterSpacing: '-1px', color: 'var(--text-primary)', margin: '0 auto 20px', maxWidth: 640 }}>
          Management și marketing strategic pentru <span style={{ color: 'var(--kimono-orange)' }}>afaceri digitale</span>
        </h1>
        <p style={{ fontSize: 16, color: 'var(--text-secondary)', margin: '0 auto', maxWidth: 560, lineHeight: 1.7 }}>
          Operăm din București ca partener extern de management pentru eCommerce și lead generation. Kimono BI este produsul nostru de Business Intelligence pentru magazine online.
        </p>
      </div>

      <div style={{ maxWidth: 860, margin: '0 auto', padding: '0 clamp(20px, 5vw, 32px) clamp(48px, 8vw, 80px)' }}>

        {/* Story */}
        <div style={{ background: 'white', border: '0.5px solid var(--border-default)', borderRadius: 12, padding: '32px', marginBottom: 40 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 16, letterSpacing: '-0.3px' }}>Povestea noastră</h2>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: 14 }}>
            Cu peste 10 ani de experiență în marketing digital și management eCommerce, am coordonat afaceri cu peste 300 de milioane de lei în vânzări anual. Am văzut din interior cât de greu este să iei decizii bazate pe date reale când folosești Google Sheets, exportări manuale și rapoarte care vin mereu cu o săptămână în urmă.
          </p>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: 14 }}>
            Tool-urile de BI existente — Looker, Tableau, Power BI — erau fie prea complexe, fie prea scumpe, fie ambele. Cele gândite pentru eCommerce ignorau complet specificul pieței românești: eMag, carduri locale, TVA de 19%, calendar fiscal diferit.
          </p>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
            Kimono BI s-a născut din Kimono Framework — arhitectura noastră operațională standardizată cu patru piloni: Marketing, Automatizare, Business Intelligence și Internalizare.
          </p>
        </div>

        {/* What we do */}
        <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 20, letterSpacing: '-0.3px' }}>Ce facem</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14, marginBottom: 48 }}>
          <div style={{ background: 'white', border: '0.5px solid var(--border-default)', borderRadius: 10, padding: '20px 22px', borderLeft: '3px solid var(--kimono-orange)' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>B2C — eCommerce Management</div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
              Gestionăm magazine online ca o echipă internă de management: campanii plătite, automatizare operațională, business intelligence și scalare internațională.
            </p>
          </div>
          <div style={{ background: 'white', border: '0.5px solid var(--border-default)', borderRadius: 10, padding: '20px 22px', borderLeft: '3px solid #7c3aed' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>B2B — Lead Generation</div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
              Sistem end-to-end de generare clienți potențiali: Lead Ads, demand generation, automatizări AI, integrare CRM și raportare pe cost per lead.
            </p>
          </div>
        </div>

        {/* Values */}
        <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 20, letterSpacing: '-0.3px' }}>Valorile noastre</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14, marginBottom: 48 }}>
          {VALUES.map((v) => (
            <div key={v.title} style={{ background: 'white', border: '0.5px solid var(--border-default)', borderRadius: 10, padding: '20px 22px', borderLeft: '3px solid var(--kimono-orange)' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>{v.title}</div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>{v.desc}</p>
            </div>
          ))}
        </div>

        {/* Founder */}
        <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 20, letterSpacing: '-0.3px' }}>Fondator</h2>
        <div style={{ background: 'white', border: '0.5px solid var(--border-default)', borderRadius: 12, padding: '24px', marginBottom: 48 }}>
          <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(216,90,48,0.1)', border: '2px solid rgba(216,90,48,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700, color: 'var(--kimono-orange)', flexShrink: 0 }}>
              DB
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>Daniel Birtas</div>
              <div style={{ fontSize: 12, color: 'var(--kimono-orange)', fontWeight: 500, marginBottom: 6 }}>Co-Fondator</div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
                Peste 10 ani de experiență în marketing digital. Fost Director Marketing la Atu Tech (lider de piață), a coordonat afaceri cu peste 300 de milioane de lei în vânzări anual.
              </p>
            </div>
          </div>
        </div>

        {/* Kimono Framework */}
        <div style={{ background: 'white', border: '0.5px solid var(--border-default)', borderRadius: 12, padding: '24px 28px', marginBottom: 40 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 16 }}>Kimono Framework</h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 16 }}>
            Arhitectură operațională standardizată cu patru piloni:
          </p>
          <div className="kbi-grid-4">
            {[
              { name: 'Marketing', color: '#D85A30' },
              { name: 'Automatizare', color: '#0F6E56' },
              { name: 'Business Intelligence', color: '#185FA5' },
              { name: 'Internalizare', color: '#7c3aed' },
            ].map((p) => (
              <div key={p.name} style={{ textAlign: 'center', padding: '14px 8px', background: p.color + '0A', borderRadius: 8, border: '0.5px solid ' + p.color + '20' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: p.color }}>{p.name}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Company info */}
        <div style={{ background: 'white', border: '0.5px solid var(--border-default)', borderRadius: 12, padding: '24px 28px', marginBottom: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 16 }}>Informații legale</h2>
          {[
            ['Denumire', 'GLOBAL DISTRIBUTION CENTER SRL'],
            ['Nume comercial', 'Kimono BI'],
            ['CUI', '50169414'],
            ['Nr. Reg. Com.', 'J2024010966408'],
            ['EUID', 'ROONRC.J2024010966408'],
            ['Sediu social', 'Str. Bibescu Vodă nr. 1, Bl. P4, Sc. 1, Et. 7, Ap. 19, Sector 4, București, cod 040151'],
            ['Data înființării', '31 mai 2024'],
            ['Email', 'office@kimonogroup.ro'],
            ['Telefon', '+40 761 176 970'],
          ].map(([label, value]) => (
            <div key={label} className="kbi-info-row">
              <div className="kbi-info-label">{label}</div>
              <div className="kbi-info-value">{value}</div>
            </div>
          ))}
        </div>

        {/* Stats */}
        <div className="kbi-grid-3" style={{ marginBottom: 40 }}>
          {[
            { num: '10+', label: 'Ani experiență' },
            { num: '300M+', label: 'Lei vânzări gestionate' },
            { num: '2024', label: 'Anul fondării' },
          ].map((s) => (
            <div key={s.label} style={{ background: 'white', border: '0.5px solid var(--border-default)', borderRadius: 10, padding: '20px', textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--kimono-orange)', letterSpacing: '-1px' }}>{s.num}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{s.label}</div>
            </div>
          ))}
        </div>

        <div style={{ textAlign: 'center', padding: '24px' }}>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16 }}>Vrei să discutăm despre cum Kimono BI poate ajuta magazinul tău?</p>
          <Link to="/contact" style={{ display: 'inline-block', padding: '10px 22px', background: 'var(--kimono-orange)', color: 'white', borderRadius: 8, fontSize: 13, fontWeight: 500, textDecoration: 'none' }}>
            Contactează-ne →
          </Link>
        </div>
      </div>

      <PublicFooter />
    </div>
  );
}
