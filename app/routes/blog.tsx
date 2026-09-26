import type { MetaFunction } from '@remix-run/node';
import { Link } from '@remix-run/react';
import { PublicNav, PublicFooter } from '~/components/PublicLayout';

export const meta: MetaFunction = () => [
  { title: 'Blog — Kimono BI' },
  { name: 'description', content: 'Resurse, ghiduri și studii de caz pentru magazine eCommerce din România.' },
];

const POSTS = [
  {
    slug: 'rfm-segmentation-guide',
    category: 'Ghid',
    categoryColor: '#D85A30',
    date: '22 Apr 2026',
    title: 'RFM Segmentation: ghid complet pentru magazine românești',
    excerpt: 'Cum să folosești segmentarea RFM pentru a identifica cei mai valoroși clienți și pentru a preveni churul — cu exemple reale din eCommerce-ul românesc.',
    readTime: '8 min',
  },
  {
    slug: 'churn-prediction-emag',
    category: 'Studiu de caz',
    categoryColor: '#7c3aed',
    date: '15 Apr 2026',
    title: 'Cum un magazin de pe eMag a redus churul cu 23% în 3 luni',
    excerpt: 'Un retailer de electronice din Cluj a folosit Churn Prediction din Kimono BI pentru a identifica clienții la risc și a lansa campanii personalizate.',
    readTime: '5 min',
  },
  {
    slug: 'revenue-forecast-model',
    category: 'Tehnic',
    categoryColor: '#0369a1',
    date: '8 Apr 2026',
    title: 'Cum funcționează modelul nostru de Revenue Forecast',
    excerpt: 'Explicăm în detaliu ensemble-ul de 4 modele folosit de Kimono BI: baseline, day-of-week, calendar RO și Year-over-Year — și de ce combinate dau rezultate mai bune.',
    readTime: '10 min',
  },
  {
    slug: 'stock-alerts-guide',
    category: 'Ghid',
    categoryColor: '#D85A30',
    date: '1 Apr 2026',
    title: 'Smart Stock Alerts: cum să nu rămâi fără stoc niciodată',
    excerpt: 'Cele 3 niveluri de alertă de stoc din Kimono BI și cum să le configurezi pentru a evita pierderile de venituri în sezonul de vârf.',
    readTime: '6 min',
  },
  {
    slug: 'ai-advisor-use-cases',
    category: 'Produs',
    categoryColor: '#0F6E56',
    date: '25 Mar 2026',
    title: '10 întrebări pe care poți să le pui Ask AI-ului despre magazinul tău',
    excerpt: 'De la "care sunt produsele cu cea mai mare marjă" la "ce clienți nu au mai cumpărat de 3 luni" — exemple concrete de cum să folosești Ask AI.',
    readTime: '4 min',
  },
  {
    slug: 'cohort-analysis-retention',
    category: 'Tehnic',
    categoryColor: '#0369a1',
    date: '18 Mar 2026',
    title: 'Cohort Analysis: cum să citești matricea de retenție',
    excerpt: 'Ghid pas cu pas pentru interpretarea graficului cohort din Kimono BI și acțiunile concrete pe care le poți lua pe baza datelor.',
    readTime: '7 min',
  },
];

const CATEGORIES = ['Toate', 'Ghid', 'Studiu de caz', 'Tehnic', 'Produs'];

export default function BlogPage() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-page)', fontFamily: 'Inter, sans-serif' }}>
      <PublicNav />

      {/* Hero */}
      <div style={{ padding: 'clamp(48px, 7vw, 72px) clamp(20px, 5vw, 32px) clamp(36px, 6vw, 48px)', textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', background: 'white', border: '0.5px solid rgba(216,90,48,0.3)', borderRadius: 999, fontSize: 11, color: 'var(--kimono-orange)', fontWeight: 600, marginBottom: 20, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Resurse & Ghiduri
        </div>
        <h1 style={{ fontSize: 'clamp(28px,4vw,40px)', fontWeight: 500, letterSpacing: '-1px', color: 'var(--text-primary)', margin: '0 auto 14px' }}>
          Blog <span style={{ color: 'var(--kimono-orange)' }}>Kimono BI</span>
        </h1>
        <p style={{ fontSize: 16, color: 'var(--text-secondary)', margin: '0 auto', maxWidth: 480 }}>
          Ghiduri practice, studii de caz și articole tehnice pentru antreprenorii din eCommerce.
        </p>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 clamp(20px, 5vw, 32px) clamp(48px, 8vw, 80px)' }}>

        {/* Category filter */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 32, flexWrap: 'wrap' }}>
          {CATEGORIES.map((cat, i) => (
            <button key={cat} style={{
              padding: '5px 14px', borderRadius: 99, fontSize: 12, fontWeight: 500, cursor: 'pointer', border: '0.5px solid var(--border-default)',
              background: i === 0 ? 'var(--kimono-orange)' : 'white',
              color: i === 0 ? 'white' : 'var(--text-secondary)',
            }}>
              {cat}
            </button>
          ))}
        </div>

        {/* Posts grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 20, marginBottom: 48 }}>
          {POSTS.map((post) => (
            <article key={post.slug} style={{ background: 'white', border: '0.5px solid var(--border-default)', borderRadius: 12, overflow: 'hidden', transition: 'box-shadow 0.15s' }}>
              {/* Placeholder image area */}
              <div style={{ height: 160, background: `linear-gradient(135deg, ${post.categoryColor}15, ${post.categoryColor}05)`, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '0.5px solid var(--border-default)' }}>
                <div style={{ width: 48, height: 48, borderRadius: 12, background: `${post.categoryColor}20`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                    <path d="M4 6h16M4 10h16M4 14h10" stroke={post.categoryColor} strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </div>
              </div>

              <div style={{ padding: '18px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: `${post.categoryColor}15`, color: post.categoryColor }}>
                    {post.category}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{post.date}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 'auto' }}>{post.readTime} citit</span>
                </div>
                <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8, lineHeight: 1.4 }}>{post.title}</h2>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 14 }}>{post.excerpt}</p>
                <Link to={`/blog/${post.slug}`} style={{ fontSize: 12, fontWeight: 600, color: 'var(--kimono-orange)', textDecoration: 'none' }}>
                  Citește articolul →
                </Link>
              </div>
            </article>
          ))}
        </div>

        {/* Newsletter CTA */}
        <div style={{ background: 'white', border: '0.5px solid var(--border-default)', borderRadius: 12, padding: '28px', textAlign: 'center' }}>
          <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 6 }}>Primește articolele direct în inbox</p>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 18 }}>Un email pe lună. Fără spam. Dezabonare cu un click.</p>
          <div style={{ display: 'flex', gap: 8, maxWidth: 380, margin: '0 auto' }}>
            <input type="email" placeholder="email@magazin.ro" className="form-input" style={{ flex: 1 }} />
            <button className="btn btn-primary" style={{ whiteSpace: 'nowrap' as const }}>Abonează-te</button>
          </div>
        </div>
      </div>

      <PublicFooter />
    </div>
  );
}