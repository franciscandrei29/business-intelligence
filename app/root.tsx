import { useState, useEffect } from 'react';
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from '@remix-run/react';
import type { LinksFunction, MetaFunction } from '@remix-run/node';
import globalStyles from '~/styles/global.css?url';
import designTokens from '~/styles/design-tokens.css?url';

export const links: LinksFunction = () => [
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
  { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500&display=swap' },
  { rel: 'stylesheet', href: designTokens },
  { rel: 'stylesheet', href: globalStyles },
  { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg?v=1777334648' },
];

export const meta: MetaFunction = () => [
  { title: 'Kimono BI - Business Intelligence Platform' },
  { name: 'description', content: 'Platforma de Business Intelligence pentru magazine eCommerce' },
];

function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && !localStorage.getItem('cookie_consent')) {
      setVisible(true);
    }
  }, []);

  const saveConsent = (type: string, analyticsOn: boolean, marketingOn: boolean) => {
    localStorage.setItem('cookie_consent', JSON.stringify({
      type, essential: true, analytics: analyticsOn, marketing: marketingOn,
      timestamp: new Date().toISOString(), version: '1.0',
    }));
    setVisible(false);
    setShowSettings(false);
  };

  if (!visible) return null;

  const overlay: React.CSSProperties = {
    position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9999,
    background: 'white', borderTop: '0.5px solid var(--border-default)',
    boxShadow: '0 -8px 32px rgba(0,0,0,0.08)',
    fontFamily: 'var(--font-sans)',
  };

  const btnBase: React.CSSProperties = {
    padding: '10px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
    cursor: 'pointer', border: '0.5px solid transparent', transition: 'all 0.15s',
    whiteSpace: 'nowrap' as const,
  };

  const Toggle = ({ on, onClick }: { on: boolean; onClick: () => void }) => (
    <button
      onClick={onClick}
      aria-pressed={on}
      style={{
        width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
        background: on ? 'var(--kimono-orange)' : 'var(--border-strong)',
        position: 'relative' as const, transition: 'background 0.2s',
        flexShrink: 0,
      }}
    >
      <div style={{
        width: 16, height: 16, borderRadius: '50%', background: 'white',
        position: 'absolute' as const, top: 3,
        left: on ? 21 : 3,
        transition: 'left 0.2s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
      }} />
    </button>
  );

  if (showSettings) {
    return (
      <div style={overlay}>
        <div style={{ maxWidth: 640, margin: '0 auto', padding: 'clamp(24px, 4vw, 32px) clamp(16px, 4vw, 28px)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>Preferințe cookie-uri</h3>
            <button onClick={() => setShowSettings(false)} aria-label="Închide" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--text-tertiary)', padding: 4, lineHeight: 1 }}>&times;</button>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 22px', lineHeight: 1.55 }}>
            Alege ce tipuri de cookie-uri accepți. Cele esențiale sunt necesare pentru funcționarea site-ului.
          </p>

          <div style={{ padding: '16px 0', borderTop: '0.5px solid var(--border-default)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>Esențiale</div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>Autentificare, securitate, preferințe de bază</div>
              </div>
              <div style={{ background: 'var(--success-bg)', color: 'var(--success-text)', padding: '4px 10px', borderRadius: 99, fontSize: 10, fontWeight: 700, letterSpacing: '0.5px', flexShrink: 0 }}>NECESARE</div>
            </div>
          </div>

          <div style={{ padding: '16px 0', borderTop: '0.5px solid var(--border-default)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>Analitice</div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>Google Analytics, statistici de utilizare</div>
              </div>
              <Toggle on={analytics} onClick={() => setAnalytics(!analytics)} />
            </div>
          </div>

          <div style={{ padding: '16px 0', borderTop: '0.5px solid var(--border-default)', borderBottom: '0.5px solid var(--border-default)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>Marketing</div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>Remarketing, personalizare reclame, tracking conversii</div>
              </div>
              <Toggle on={marketing} onClick={() => setMarketing(!marketing)} />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 22, flexWrap: 'wrap' as const }}>
            <button onClick={() => setShowSettings(false)} style={{ ...btnBase, background: 'transparent', color: 'var(--text-secondary)' }}>
              Anulează
            </button>
            <button onClick={() => saveConsent('custom', analytics, marketing)} style={{ ...btnBase, background: 'var(--kimono-orange)', color: 'white', borderColor: 'var(--kimono-orange)' }}>
              Salvează preferințele
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={overlay}>
      <div className="kbi-cookie-bar">
        <div style={{ flex: '1 1 280px', minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4, letterSpacing: '-0.1px' }}>Acest site folosește cookie-uri</div>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
            Esențiale pentru funcționare. Cu acordul tău: analitice și marketing.{' '}
            <a href="/cookies" style={{ color: 'var(--kimono-orange-text)', textDecoration: 'underline' }}>Politica de cookie-uri</a>
          </p>
        </div>
        <div className="kbi-cookie-buttons">
          <button onClick={() => saveConsent('essential', false, false)} style={{ ...btnBase, background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>
            Doar esențiale
          </button>
          <button onClick={() => setShowSettings(true)} style={{ ...btnBase, background: 'transparent', color: 'var(--text-primary)', border: '0.5px solid var(--border-strong)' }}>
            Personalizează
          </button>
          <button onClick={() => saveConsent('all', true, true)} style={{ ...btnBase, background: 'var(--kimono-orange)', color: 'white', borderColor: 'var(--kimono-orange)' }}>
            Acceptă toate
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <html lang="ro">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <CookieConsent />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
