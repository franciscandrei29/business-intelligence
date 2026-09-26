// api.auth.meta.install.ts — Initiates Meta OAuth flow for Marketing API
import type { LoaderFunctionArgs } from '@remix-run/node';
import { redirect } from '@remix-run/node';
import crypto from 'crypto';

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');

  if (!storeId) {
    return new Response('Missing store parameter', { status: 400 });
  }

  const appId = process.env.META_APP_ID;
  const redirectUri = process.env.META_REDIRECT_URI || 'https://bi.kimonogroup.ro/api/auth/meta/callback';

  if (!appId) {
    return new Response('META_APP_ID not configured', { status: 500 });
  }

  const state = crypto.randomBytes(16).toString('hex') + ':' + storeId;
  const scopes = 'ads_read,ads_management,business_management';

  const authUrl =
    `https://www.facebook.com/v21.0/dialog/oauth?` +
    `client_id=${appId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${scopes}` +
    `&state=${encodeURIComponent(state)}` +
    `&response_type=code`;

  return redirect(authUrl, {
    headers: {
      'Set-Cookie': `meta_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}
