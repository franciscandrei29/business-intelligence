import type { StoreConnection } from '@prisma/client';
import type { CommerceProvider } from './types';
import { ShopifyConnector } from './shopify/index';
import { WooCommerceConnector } from './woocommerce/index';
import { EmagConnector } from './emag/index';
import { decrypt } from '~/lib/auth/crypto.server';

export async function getProvider(
  storeConnection: StoreConnection
): Promise<CommerceProvider> {
  if (storeConnection.platform === 'SHOPIFY') {
    if (!storeConnection.shopifyAccessToken) {
      throw new Error('Shopify access token missing');
    }

    const accessToken = decrypt(storeConnection.shopifyAccessToken);

    return new ShopifyConnector({
      shop: storeConnection.domain,
      accessToken,
      storeConnectionId: storeConnection.id,
    });
  }

  if (storeConnection.platform === 'WOOCOMMERCE') {
    if (!storeConnection.wooConsumerKey || !storeConnection.wooConsumerSecret) {
      throw new Error('WooCommerce consumer key/secret missing');
    }

    const consumerKey = decrypt(storeConnection.wooConsumerKey);
    const consumerSecret = decrypt(storeConnection.wooConsumerSecret);
    const apiUrl = storeConnection.wooApiUrl || `https://${storeConnection.domain}`;

    return new WooCommerceConnector({
      apiUrl,
      consumerKey,
      consumerSecret,
      storeConnectionId: storeConnection.id,
    });
  }

  if (storeConnection.platform === 'EMAG') {
    if (!storeConnection.wooConsumerKey || !storeConnection.wooConsumerSecret) {
      throw new Error('eMag API credentials missing');
    }

    const apiKey = decrypt(storeConnection.wooConsumerKey);
    const apiSecret = decrypt(storeConnection.wooConsumerSecret);

    return new EmagConnector({
      apiKey,
      apiSecret,
      storeConnectionId: storeConnection.id,
    });
  }

  throw new Error(`Unsupported platform: ${storeConnection.platform}`);
}
