import { useState } from 'react';
import { Link } from '@remix-run/react';

const NAV_LINKS = [
  { to: '/functionalitati', label: 'Funcționalități' },
  { to: '/pricing', label: 'Abonamente' },
  { to: '/roadmap', label: 'Roadmap' },
  { to: '/blog', label: 'Blog' },
  { to: '/despre', label: 'Despre' },
  { to: '/contact', label: 'Contact' },
];

function HamburgerIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
    </svg>
  );
}

export function PublicNav() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <nav className="kbi-pub-nav" style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        background: 'rgba(250,250,249,0.92)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        borderBottom: '0.5px solid var(--border-default)',
        height: 56,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <img src="/logo-kimono-bi.svg" alt="Kimono BI" style={{ height: 28, width: 'auto' }} />
        </Link>
        <div className="kbi-pub-nav-links" style={{ color: 'var(--text-secondary)' }}>
          {NAV_LINKS.map((l) => (
            <Link key={l.to} to={l.to} style={{ color: 'inherit', textDecoration: 'none' }}>{l.label}</Link>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Link to="/login" className="kbi-pub-nav-cta-text" style={{ fontSize: 13, color: 'var(--text-secondary)', textDecoration: 'none', padding: '6px 10px' }}>Conectează-te</Link>
          <Link to="/register" style={{ fontSize: 13, fontWeight: 600, color: 'white', background: 'var(--kimono-orange)', borderRadius: 7, padding: '7px 14px', textDecoration: 'none', whiteSpace: 'nowrap' }}>Începe gratuit</Link>
          <button className="kbi-hamburger" onClick={() => setOpen(!open)} aria-label={open ? 'Închide meniul' : 'Deschide meniul'} aria-expanded={open}>
            <HamburgerIcon open={open} />
          </button>
        </div>
      </nav>
      {open && (
        <div className="kbi-mobile-menu">
          {NAV_LINKS.map((l) => (
            <Link key={l.to} to={l.to} onClick={() => setOpen(false)}>{l.label}</Link>
          ))}
          <Link to="/login" onClick={() => setOpen(false)}>Conectează-te</Link>
          <Link to="/register" className="kbi-mm-cta" onClick={() => setOpen(false)}>Începe gratuit</Link>
        </div>
      )}
    </>
  );
}

export function PublicFooter() {
  return (
    <div style={{ padding: 'clamp(32px, 5vw, 48px) clamp(20px, 5vw, 40px)', background: 'white', borderTop: '0.5px solid var(--border-default)' }}>
      <div className="kbi-footer-grid">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
            <img src="/logo-kimono-bi.svg" alt="Kimono BI" style={{ height: 24, width: 'auto' }} />
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.6, margin: 0, maxWidth: 320 }}>
            Business Intelligence pentru magazine eCommerce care vor să crească cu decizii bazate pe date.
          </p>
        </div>
        {[
          { title: 'Produs', links: [['Funcționalități', '/functionalitati'], ['Abonamente', '/pricing'], ['Roadmap', '/roadmap'], ['Blog', '/blog']] },
          { title: 'Companie', links: [['Despre noi', '/despre'], ['Contact', '/contact'], ['Documentație', '/documentatie']] },
          { title: 'Legal', links: [['Privacy', '/politica-confidentialitate'], ['Termeni', '/termeni'], ['GDPR', '/gdpr'], ['Cookie-uri', '/cookies']] },
        ].map((col) => (
          <div key={col.title}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '1px', color: 'var(--text-secondary)', marginBottom: 12 }}>{col.title}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5, color: 'var(--text-secondary)' }}>
              {col.links.map((l: any) => (
                <Link key={l[0]} to={l[1]} style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>{l[0]}</Link>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="kbi-footer-bottom" style={{ maxWidth: 1080, margin: '32px auto 0', paddingTop: 20, borderTop: '0.5px solid var(--border-default)', fontSize: 11, color: 'var(--text-tertiary)' }}>
        <div>© 2026 GLOBAL DISTRIBUTION CENTER SRL · CUI 50169414 · J2024010966408</div>
        <div>Made in Romania</div>
      </div>
    </div>
  );
}
