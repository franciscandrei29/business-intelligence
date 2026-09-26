import { useState, useEffect } from 'react';
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from '@remix-run/react';
import type { LinksFunction, MetaFunction } from '@remix-run/node';
import styles from '~/styles/global.css?url';

export const links: LinksFunction = () => [
  { rel: 'stylesheet', href: styles },
  { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
];

export const meta: MetaFunction = () => [
  { title: 'Kimono BI — Business Intelligence Platform' },
  { name: 'description', content: 'Platforma de Business Intelligence pentru Shopify si WooCommerce' },
];

function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && !localStorage.getItem('cookie_consent')) {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9999,
      background: '#1a1a2e', borderTop: '1px solid #2d2d44',
      padding: '14px 24px', display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', gap: '16px',
      fontSize: '0.875rem', color: '#b0b0c0',
    }}>
      <span>Acest site foloseste cookie-uri pentru functionare.</span>
      <button
        onClick={() => { localStorage.setItem('cookie_consent', '1'); setVisible(false); }}
        style={{
          background: '#6c5ce7', color: '#fff', border: 'none', borderRadius: '6px',
          padding: '8px 20px', cursor: 'pointer', fontWeight: 600, fontSize: '0.8125rem',
          whiteSpace: 'nowrap',
        }}
      >
        Accept
      </button>
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
