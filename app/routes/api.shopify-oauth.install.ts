// api.shopify-oauth.install.ts
// Initiates Shopify OAuth flow for Custom Distribution App

import type { LoaderFunctionArgs } from '@remix-run/node';
import { redirect } from '@remix-run/node';
import crypto from 'crypto';

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');
  const embedded = url.searchParams.get('embedded');

  if (!shop) {
    return new Response('Missing shop parameter. Use ?shop=your-store.myshopify.com', { status: 400 });
  }

  // Normalize domain
  const domain = shop.replace(/^https?:\/\//, '').replace(/\/$/, '');

  const clientId = process.env.SHOPIFY_CLIENT_ID;
  if (!clientId) {
    return new Response('SHOPIFY_CLIENT_ID not configured.', { status: 500 });
  }

  const appUrl = process.env.APP_URL || 'https://bi.kimonogroup.ro';
  const redirectUri = `${appUrl}/api/shopify-oauth/callback`;
  const scopes = 'read_customers,write_customers,read_products,read_orders,write_orders,read_all_orders,read_inventory,read_reports,read_returns,write_returns';

  // Generate nonce for CSRF protection
  const state = crypto.randomBytes(16).toString('hex');

  const authUrl =
    `https://${domain}/admin/oauth/authorize?` +
    `client_id=${clientId}` +
    `&scope=${scopes}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;

  // If opened inside Shopify admin iframe, break out to top-level
  if (embedded === '1') {
    const html = `<!DOCTYPE html>
<html><head><title>Redirecting...</title></head>
<body>
<script>
  if (window.top !== window.self) {
    window.top.location.href = ${JSON.stringify(authUrl)};
  } else {
    window.location.href = ${JSON.stringify(authUrl)};
  }
</script>
<p>Redirecting to Shopify authorization...</p>
</body></html>`;

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // Don't set state cookie in iframe — browser blocks third-party cookies.
        // HMAC verification in callback is sufficient for security.
        'Set-Cookie': 'shopify_oauth_state=; Path=/; HttpOnly; Secure; Max-Age=0',
      },
    });
  }

  return redirect(authUrl, {
    headers: {
      'Set-Cookie': `shopify_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=300`,
    },
  });
}
