// api.auth.meta.callback.ts — Handles Meta OAuth callback
import type { LoaderFunctionArgs } from '@remix-run/node';
import { redirect, json } from '@remix-run/node';
import { db } from '~/lib/db.server';
import { encrypt } from '~/lib/auth/crypto.server';

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    const desc = url.searchParams.get('error_description') || error;
    return redirect(`/ads?meta_error=${encodeURIComponent(desc)}`);
  }

  if (!code || !state) {
    return new Response('Missing code or state parameter', { status: 400 });
  }

  const storeId = state.split(':')[1];
  if (!storeId) return new Response('Invalid state parameter', { status: 400 });

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const redirectUri = process.env.META_REDIRECT_URI || 'https://bi.kimonogroup.ro/api/auth/meta/callback';

  if (!appId || !appSecret) return new Response('Meta credentials not configured', { status: 500 });

  // ── Step 1: Exchange code for short-lived token ──────────────────────────
  const tokenRes = await fetch(
    `https://graph.facebook.com/v21.0/oauth/access_token?` +
    `client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`
  );

  if (!tokenRes.ok) {
    console.error('[meta-oauth] Token exchange failed:', await tokenRes.text());
    return redirect(`/ads?meta_error=${encodeURIComponent('Token exchange failed')}`);
  }

  const tokenData = await tokenRes.json();
  const shortLivedToken = tokenData.access_token;
  if (!shortLivedToken) return redirect(`/ads?meta_error=${encodeURIComponent('No access token received')}`);

  // ── Step 2: Exchange for long-lived token (~60 days) ─────────────────────
  let accessToken = shortLivedToken;
  let expiresIn = 3600;

  const longRes = await fetch(
    `https://graph.facebook.com/v21.0/oauth/access_token?` +
    `grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortLivedToken}`
  );
  if (longRes.ok) {
    const longData = await longRes.json();
    if (longData.access_token) {
      accessToken = longData.access_token;
      expiresIn = longData.expires_in || 5184000;
    }
  }

  // ── Step 3: Get all ad accounts ──────────────────────────────────────────
  const meRes = await fetch(
    `https://graph.facebook.com/v21.0/me/adaccounts?fields=name,account_id,account_status,currency,timezone_name,amount_spent&access_token=${accessToken}`
  );
  const meData = await meRes.json();
  const accounts = (meData.data || []).filter((a: any) => a.account_status === 1);

  // Save token temporarily so we can use it after account selection
  const encryptedToken = encrypt(accessToken);
  const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

  await db.storeSettings.upsert({
    where: { storeConnectionId: storeId },
    create: { storeConnectionId: storeId, metaAccessToken: encryptedToken, metaTokenExpiresAt: tokenExpiresAt },
    update: { metaAccessToken: encryptedToken, metaTokenExpiresAt: tokenExpiresAt },
  });

  if (accounts.length === 0) {
    return redirect(`/ads?meta_error=${encodeURIComponent('Nu s-a gasit niciun cont de publicitate activ.')}`);
  }

  if (accounts.length === 1) {
    // Single account — connect directly
    await db.storeSettings.update({
      where: { storeConnectionId: storeId },
      data: { metaAdAccountId: accounts[0].id },
    });
    console.log(`[meta-oauth] Auto-connected ${accounts[0].name} (${accounts[0].id})`);
    return redirect(`/ads?meta_success=1&store=${storeId}`);
  }

  // Multiple accounts — redirect to selection page
  const accountList = accounts.map((a: any) => ({
    id: a.id,
    name: a.name,
    currency: a.currency,
    spent: a.amount_spent ? (parseInt(a.amount_spent) / 100).toLocaleString('ro-RO') : '0',
  }));

  return redirect(`/ads?meta_select=1&store=${storeId}&accounts=${encodeURIComponent(JSON.stringify(accountList))}`);
}
