// api.shopify-oauth.callback.ts
// Handles Shopify OAuth callback — exchanges code for access_token, creates StoreConnection

import type { LoaderFunctionArgs } from '@remix-run/node';
import { redirect } from '@remix-run/node';
import crypto from 'crypto';
import { db } from '~/lib/db.server';
import { encrypt } from '~/lib/auth/crypto.server';
import { getSessionFromCookie } from '~/lib/auth/session.server';

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const hmac = url.searchParams.get('hmac');

  if (!shop || !code || !state) {
    return new Response('Missing required parameters (shop, code, state).', { status: 400 });
  }

  // ── Verify HMAC (primary security check) ──────────────────────────────────
  const secret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!secret) {
    return new Response('SHOPIFY_CLIENT_SECRET not configured.', { status: 500 });
  }

  if (!hmac) {
    return new Response('Missing HMAC parameter.', { status: 403 });
  }

  const params = new URLSearchParams(url.search);
  params.delete('hmac');
  params.sort();
  const message = params.toString();
  const digest = crypto.createHmac('sha256', secret).update(message).digest('hex');
  if (digest !== hmac) {
    return new Response('HMAC validation failed.', { status: 403 });
  }

  // ── Verify state (CSRF) — only when we initiated the flow ourselves ─────
  const cookies = request.headers.get('cookie') || '';
  const stateMatch = cookies.match(/shopify_oauth_state=([a-f0-9]+)/);
  const savedState = stateMatch?.[1];

  // If we have a state cookie (our OAuth flow), verify it matches.
  // If no cookie (Shopify Partners install link), HMAC is sufficient.
  if (savedState && savedState !== state) {
    return new Response('Invalid state parameter.', { status: 403 });
  }

  // ── Exchange code for permanent access token ─────────────────────────────
  const domain = shop.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const tokenRes = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: secret,
      code,
    }),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    console.error('[shopify-oauth] Token exchange failed:', errText);
    return new Response(`Token exchange failed: ${tokenRes.status}`, { status: 502 });
  }

  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;
  const refreshToken = tokenData.refresh_token || null;
  const expiresIn = tokenData.expires_in || null; // seconds

  if (!accessToken) {
    return new Response('No access token received from Shopify.', { status: 502 });
  }

  // ── Verify token works — get shop name ───────────────────────────────────
  let shopName = domain;
  try {
    const testRes = await fetch(`https://${domain}/admin/api/2025-01/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({ query: '{ shop { name } }' }),
    });
    const testData = await testRes.json();
    if (testData.data?.shop?.name) {
      shopName = testData.data.shop.name;
    }
  } catch (e) {
    console.error('[shopify-oauth] Shop name fetch failed:', e);
  }

  // ── Check if user is logged in ───────────────────────────────────────────
  let userId: string | null = null;
  try {
    const session = await getSessionFromCookie(request);
    if (session && session.expiresAt > new Date()) {
      userId = session.user.id;
    }
  } catch {}

  const appUrl = process.env.APP_URL || 'https://bi.kimonogroup.ro';

  if (userId) {
    // ── Encrypt and create StoreConnection ─────────────────────────────────
    const encryptedToken = encrypt(accessToken);
    const encryptedRefresh = refreshToken ? encrypt(refreshToken) : null;
    const tokenExpiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;

    // Check if connection already exists
    const existing = await db.storeConnection.findFirst({
      where: { userId, domain, platform: 'SHOPIFY' },
    });

    if (existing) {
      await db.storeConnection.update({
        where: { id: existing.id },
        data: {
          shopifyAccessToken: encryptedToken,
          shopifyRefreshToken: encryptedRefresh,
          shopifyTokenExpiresAt: tokenExpiresAt,
          isActive: true,
          name: shopName,
          syncStatus: 'PENDING',
        },
      });
    } else {
      const newStore = await db.storeConnection.create({
        data: {
          userId,
          platform: 'SHOPIFY',
          name: shopName,
          domain,
          shopifyAccessToken: encryptedToken,
          shopifyRefreshToken: encryptedRefresh,
          shopifyTokenExpiresAt: tokenExpiresAt,
          syncStatus: 'PENDING',
        },
      });

      // Trigger initial sync (fire-and-forget)
      try {
        const { spawn } = await import('child_process');
        spawn('node', ['scripts/cron-sync.mjs', '--force', `--store=${newStore.id}`], {
          cwd: process.cwd(),
          detached: true,
          stdio: 'ignore',
        }).unref();
      } catch {}
    }

    // Clear state cookie and redirect to stores page
    return redirect('/stores?oauth=success&shop=' + encodeURIComponent(shopName), {
      headers: {
        'Set-Cookie': 'shopify_oauth_state=; Path=/; HttpOnly; Secure; Max-Age=0',
      },
    });
  }

  // ── Not logged in — store token temporarily in cookie, redirect to login ─
  const pending = Buffer.from(JSON.stringify({
    shop: domain,
    shopName,
    token: accessToken,
  })).toString('base64');

  return redirect('/login?oauth_pending=1', {
    headers: {
      'Set-Cookie': [
        'shopify_oauth_state=; Path=/; HttpOnly; Secure; Max-Age=0',
        `shopify_pending=${pending}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
      ].join(', '),
    },
  });
}
