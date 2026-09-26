// app/lib/integrations/shopify/token-refresh.server.ts
// Handles Shopify expiring offline access tokens (required for public apps since Apr 2026)

import { db } from '~/lib/db.server';
import { encrypt, decrypt } from '~/lib/auth/crypto.server';

const TOKEN_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 min before expiry

/**
 * Get a valid access token for a store, refreshing if expired.
 * Returns the decrypted access token ready for API calls.
 */
export async function getValidAccessToken(storeId: string): Promise<string> {
  const store = await db.storeConnection.findUnique({
    where: { id: storeId },
    select: {
      shopifyAccessToken: true,
      shopifyRefreshToken: true,
      shopifyTokenExpiresAt: true,
      domain: true,
    },
  });

  if (!store?.shopifyAccessToken) {
    throw new Error('No access token found for store');
  }

  const accessToken = decrypt(store.shopifyAccessToken);

  // If no expiry set (legacy non-expiring token), return as-is
  if (!store.shopifyTokenExpiresAt) {
    return accessToken;
  }

  // If token is still valid, return it
  const now = new Date();
  if (store.shopifyTokenExpiresAt.getTime() > now.getTime() + TOKEN_BUFFER_MS) {
    return accessToken;
  }

  // Token expired or about to expire — refresh it
  if (!store.shopifyRefreshToken) {
    throw new Error('Token expired but no refresh token available. Store needs to re-authorize.');
  }

  console.log(`[token-refresh] Refreshing token for store ${storeId} (${store.domain})`);

  const refreshToken = decrypt(store.shopifyRefreshToken);
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('SHOPIFY_CLIENT_ID or SHOPIFY_CLIENT_SECRET not configured');
  }

  const res = await fetch(`https://${store.domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[token-refresh] Failed for ${store.domain}: ${res.status} ${errText}`);
    throw new Error(`Token refresh failed: ${res.status}`);
  }

  const data = await res.json();
  const newAccessToken = data.access_token;
  const newRefreshToken = data.refresh_token;
  const expiresIn = data.expires_in; // seconds

  if (!newAccessToken) {
    throw new Error('No access token in refresh response');
  }

  // Save new tokens
  const updateData: any = {
    shopifyAccessToken: encrypt(newAccessToken),
  };

  if (newRefreshToken) {
    updateData.shopifyRefreshToken = encrypt(newRefreshToken);
  }

  if (expiresIn) {
    updateData.shopifyTokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
  }

  await db.storeConnection.update({
    where: { id: storeId },
    data: updateData,
  });

  console.log(`[token-refresh] Token refreshed for ${store.domain}, expires in ${expiresIn}s`);

  return newAccessToken;
}
