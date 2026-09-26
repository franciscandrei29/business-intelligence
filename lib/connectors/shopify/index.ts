import type {
  CommerceProvider,
  ConnectionResult,
  PaginationOpts,
  PaginatedResult,
  NormalizedProduct,
  NormalizedOrder,
  NormalizedCustomer,
  NormalizedInventory,
  NormalizedCollection,
  SeoPayload,
  CollectionPayload,
} from '../types';
import { decrypt } from '~/lib/auth/crypto.server';

const API_VERSION = '2025-04';

interface ShopifyConfig {
  shop: string;
  accessToken: string;
  storeConnectionId: string;
}

export class ShopifyConnector implements CommerceProvider {
  platform = 'SHOPIFY' as const;
  storeConnectionId: string;
  private shop: string;
  private accessToken: string;
  private requestCount = 0;
  private lastRequestTime = 0;

  constructor(config: ShopifyConfig) {
    this.shop = config.shop;
    this.accessToken = config.accessToken;
    this.storeConnectionId = config.storeConnectionId;
  }

  // ---- Rate limiter (max 2 requests/second for safety, Shopify allows ~2/sec for GraphQL) ----
  private async throttle() {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < 500) {
      await new Promise((r) => setTimeout(r, 500 - elapsed));
    }
    this.lastRequestTime = Date.now();
    this.requestCount++;
  }

  // ---- GraphQL helper ----
  private async graphql<T = any>(query: string, variables?: Record<string, any>): Promise<T> {
    await this.throttle();

    const url = `https://${this.shop}/admin/api/${API_VERSION}/graphql.json`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': this.accessToken,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Shopify API error ${res.status}: ${text}`);
    }

    const json = await res.json();

    if (json.errors?.length) {
      // Check for throttling
      const throttled = json.errors.find((e: any) => e.extensions?.code === 'THROTTLED');
      if (throttled) {
        const retryAfter = 2000;
        await new Promise((r) => setTimeout(r, retryAfter));
        return this.graphql(query, variables);
      }
      // If we have partial data with ACCESS_DENIED errors, return the data anyway
      if (json.data) {
        console.warn(`Shopify GraphQL partial errors (continuing with data): ${json.errors.length} errors`);
        return json.data as T;
      }
      throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
    }

    return json.data as T;
  }

  // ---- Test connection ----
  async testConnection(): Promise<ConnectionResult> {
    try {
      const data = await this.graphql<{ shop: { name: string } }>(`{ shop { name } }`);
      return { success: true, shopName: data.shop.name };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  // ---- Products ----
  async fetchProducts(opts?: PaginationOpts): Promise<PaginatedResult<NormalizedProduct>> {
    const limit = opts?.limit || 50;
    const afterClause = opts?.cursor ? `, after: "${opts.cursor}"` : '';

    const data = await this.graphql(`{
      products(first: ${limit}${afterClause}) {
        edges {
          cursor
          node {
            id
            title
            handle
            status
            vendor
            productType
            tags
            featuredImage { url }
            variants(first: 1) {
              edges {
                node {
                  sku
                  price
                  compareAtPrice
                  inventoryQuantity
                  inventoryItem {
                    unitCost { amount }
                  }
                }
              }
            }
          }
        }
        pageInfo { hasNextPage }
      }
    }`);

    const edges = data.products.edges;
    const products: NormalizedProduct[] = edges.map((e: any) => {
      const n = e.node;
      const v = n.variants.edges[0]?.node;
      return {
        externalId: n.id,
        title: n.title,
        sku: v?.sku || null,
        price: parseFloat(v?.price || '0'),
        compareAtPrice: v?.compareAtPrice ? parseFloat(v.compareAtPrice) : null,
        costPerUnit: v?.inventoryItem?.unitCost?.amount
          ? parseFloat(v.inventoryItem.unitCost.amount)
          : null,
        inventory: v?.inventoryQuantity || 0,
        vendor: n.vendor || null,
        productType: n.productType || null,
        tags: n.tags || [],
        imageUrl: n.featuredImage?.url || null,
        handle: n.handle || null,
        status: n.status?.toLowerCase() || 'active',
      };
    });

    return {
      data: products,
      hasNextPage: data.products.pageInfo.hasNextPage,
      cursor: edges.length > 0 ? edges[edges.length - 1].cursor : undefined,
    };
  }

  async fetchProductById(id: string): Promise<NormalizedProduct | null> {
    const data = await this.graphql(`{
      product(id: "${id}") {
        id title handle status vendor productType tags
        featuredImage { url }
        variants(first: 1) {
          edges {
            node {
              sku price compareAtPrice inventoryQuantity
              inventoryItem { unitCost { amount } }
            }
          }
        }
      }
    }`);

    if (!data.product) return null;
    const n = data.product;
    const v = n.variants.edges[0]?.node;

    return {
      externalId: n.id,
      title: n.title,
      sku: v?.sku || null,
      price: parseFloat(v?.price || '0'),
      compareAtPrice: v?.compareAtPrice ? parseFloat(v.compareAtPrice) : null,
      costPerUnit: v?.inventoryItem?.unitCost?.amount
        ? parseFloat(v.inventoryItem.unitCost.amount)
        : null,
      inventory: v?.inventoryQuantity || 0,
      vendor: n.vendor || null,
      productType: n.productType || null,
      tags: n.tags || [],
      imageUrl: n.featuredImage?.url || null,
      handle: n.handle || null,
      status: n.status?.toLowerCase() || 'active',
    };
  }

  async updateProductTags(id: string, tags: string[]): Promise<void> {
    await this.graphql(`mutation {
      productUpdate(input: { id: "${id}", tags: ${JSON.stringify(tags)} }) {
        userErrors { field message }
      }
    }`);
  }

  async updateProductSeo(id: string, seo: SeoPayload): Promise<void> {
    const seoInput: string[] = [];
    if (seo.metaTitle) seoInput.push(`title: "${seo.metaTitle}"`);
    if (seo.metaDescription) seoInput.push(`description: "${seo.metaDescription}"`);

    const mutations: string[] = [];
    if (seoInput.length > 0) {
      mutations.push(`productUpdate(input: { id: "${id}", seo: { ${seoInput.join(', ')} } }) {
        userErrors { field message }
      }`);
    }
    if (seo.handle) {
      mutations.push(`productUpdate(input: { id: "${id}", handle: "${seo.handle}" }) {
        userErrors { field message }
      }`);
    }

    if (mutations.length > 0) {
      await this.graphql(`mutation { ${mutations.join('\n')} }`);
    }
  }

  // ---- Orders ----
  async fetchOrders(from: Date, to: Date, opts?: PaginationOpts): Promise<PaginatedResult<NormalizedOrder>> {
    const limit = opts?.limit || 50;
    const afterClause = opts?.cursor ? `, after: "${opts.cursor}"` : '';
    const fromStr = from.toISOString();
    const toStr = to.toISOString();

    const data = await this.graphql(`{
      orders(first: ${limit}, query: "created_at:>='${fromStr}' AND created_at:<='${toStr}'"${afterClause}) {
        edges {
          cursor
          node {
            id
            name
            createdAt
            displayFinancialStatus
            displayFulfillmentStatus
            totalPriceSet { shopMoney { amount currencyCode } }
            subtotalPriceSet { shopMoney { amount } }
            totalRefundedSet { shopMoney { amount } }
            totalDiscountsSet { shopMoney { amount } }
            customer { id }
            fulfillments(first: 1) { createdAt }
            lineItems(first: 50) {
              edges {
                node {
                  title
                  quantity
                  originalUnitPriceSet { shopMoney { amount } }
                  product { id }
                  sku
                  product { id }
                }
              }
            }
          }
        }
        pageInfo { hasNextPage }
      }
    }`);

    const edges = data.orders.edges;
    const orders: NormalizedOrder[] = edges.map((e: any) => {
      const n = e.node;
      const lineItems = n.lineItems.edges.map((li: any) => ({
        title: li.node.title,
        quantity: li.node.quantity,
        price: parseFloat(li.node.originalUnitPriceSet?.shopMoney?.amount || '0'),
        sku: li.node.sku,
        productId: li.node.product?.id,
        productId: li.node.product?.id,
      }));

      return {
        externalId: n.id,
        orderNumber: n.name || null,
        customerExternalId: n.customer?.id || null,
        total: parseFloat(n.totalPriceSet?.shopMoney?.amount || '0'),
        subtotal: n.subtotalPriceSet?.shopMoney?.amount
          ? parseFloat(n.subtotalPriceSet.shopMoney.amount)
          : null,
        totalRefunded: n.totalRefundedSet?.shopMoney?.amount
          ? parseFloat(n.totalRefundedSet.shopMoney.amount)
          : null,
        discountTotal: n.totalDiscountsSet?.shopMoney?.amount
          ? parseFloat(n.totalDiscountsSet.shopMoney.amount)
          : null,
        currency: n.totalPriceSet?.shopMoney?.currencyCode || 'RON',
        status: n.displayFinancialStatus || 'UNKNOWN',
        financialStatus: n.displayFinancialStatus || null,
        fulfillmentStatus: n.displayFulfillmentStatus || null,
        itemsCount: lineItems.reduce((sum: number, li: any) => sum + li.quantity, 0),
        lineItems: JSON.stringify(lineItems),
        placedAt: new Date(n.createdAt),
        fulfilledAt: n.fulfillments?.[0]?.createdAt ? new Date(n.fulfillments[0].createdAt) : null,
      };
    });

    return {
      data: orders,
      hasNextPage: data.orders.pageInfo.hasNextPage,
      cursor: edges.length > 0 ? edges[edges.length - 1].cursor : undefined,
    };
  }

  // ---- Customers ----
  async fetchCustomers(opts?: PaginationOpts): Promise<PaginatedResult<NormalizedCustomer>> {
    const limit = opts?.limit || 50;
    const afterClause = opts?.cursor ? `, after: "${opts.cursor}"` : '';

    const data = await this.graphql(`{
      customers(first: ${limit}${afterClause}) {
        edges {
          cursor
          node {
            id
            email
            firstName
            lastName
            phone
            amountSpent { amount }
            numberOfOrders
            firstOrder: orders(first: 1, sortKey: CREATED_AT) {
              edges { node { createdAt } }
            }
            lastOrder: orders(first: 1, sortKey: CREATED_AT, reverse: true) {
              edges { node { createdAt } }
            }
            tags
          }
        }
        pageInfo { hasNextPage }
      }
    }`);

    const edges = data.customers.edges;
    const customers: NormalizedCustomer[] = edges.map((e: any) => {
      const n = e.node;
      const firstOrderDate = n.firstOrder?.edges[0]?.node?.createdAt;
      const lastOrderDate = n.lastOrder?.edges[0]?.node?.createdAt;

      return {
        externalId: n.id,
        email: n.email || null,
        firstName: n.firstName || null,
        lastName: n.lastName || null,
        phone: n.phone || null,
        totalSpent: parseFloat(n.amountSpent?.amount || '0'),
        ordersCount: parseInt(n.numberOfOrders || '0', 10),
        firstOrderAt: firstOrderDate ? new Date(firstOrderDate) : null,
        lastOrderAt: lastOrderDate ? new Date(lastOrderDate) : null,
        tags: n.tags || [],
      };
    });

    return {
      data: customers,
      hasNextPage: data.customers.pageInfo.hasNextPage,
      cursor: edges.length > 0 ? edges[edges.length - 1].cursor : undefined,
    };
  }

  // ---- Inventory ----
  async fetchInventoryLevels(): Promise<NormalizedInventory[]> {
    const inventories: NormalizedInventory[] = [];
    let cursor: string | undefined;

    do {
      const afterClause = cursor ? `, after: "${cursor}"` : '';
      const data = await this.graphql(`{
        products(first: 50${afterClause}) {
          edges {
            cursor
            node {
              id
              variants(first: 1) {
                edges { node { inventoryQuantity } }
              }
            }
          }
          pageInfo { hasNextPage }
        }
      }`);

      for (const edge of data.products.edges) {
        const qty = edge.node.variants.edges[0]?.node?.inventoryQuantity || 0;
        inventories.push({
          externalProductId: edge.node.id,
          quantity: qty,
        });
        cursor = edge.cursor;
      }

      if (!data.products.pageInfo.hasNextPage) break;
    } while (true);

    return inventories;
  }

  // ---- Collections ----
  async createCollection(payload: CollectionPayload): Promise<string> {
    const data = await this.graphql(`mutation {
      collectionCreate(input: {
        title: "${payload.title}",
        ruleSet: null
      }) {
        collection { id }
        userErrors { field message }
      }
    }`);

    const collectionId = data.collectionCreate.collection?.id;
    if (!collectionId) {
      throw new Error('Failed to create collection');
    }

    // Add products to collection
    if (payload.productIds.length > 0) {
      const productIds = payload.productIds.map((id) => `"${id}"`).join(', ');
      await this.graphql(`mutation {
        collectionAddProducts(id: "${collectionId}", productIds: [${productIds}]) {
          userErrors { field message }
        }
      }`);
    }

    return collectionId;
  }

  async listCollections(): Promise<NormalizedCollection[]> {
    const data = await this.graphql(`{
      collections(first: 100) {
        edges {
          node {
            id title handle
            productsCount { count }
          }
        }
      }
    }`);

    return data.collections.edges.map((e: any) => ({
      externalId: e.node.id,
      title: e.node.title,
      handle: e.node.handle,
      productsCount: e.node.productsCount?.count || 0,
    }));
  }

  // ---- Webhooks ----
  async registerWebhooks(): Promise<void> {
    const topics = [
      'PRODUCTS_UPDATE',
      'ORDERS_CREATE',
      'ORDERS_UPDATED',
      'CUSTOMERS_CREATE',
      'INVENTORY_LEVELS_UPDATE',
    ];

    const callbackBase = `${process.env.APP_URL}/api/webhooks/shopify`;

    for (const topic of topics) {
      const topicSlug = topic.toLowerCase().replace('_', '/');
      await this.graphql(`mutation {
        webhookSubscriptionCreate(
          topic: ${topic},
          webhookSubscription: {
            callbackUrl: "${callbackBase}/${topicSlug}",
            format: JSON
          }
        ) {
          userErrors { field message }
        }
      }`);
    }
  }

  async unregisterWebhooks(): Promise<void> {
    const data = await this.graphql(`{
      webhookSubscriptions(first: 50) {
        edges { node { id } }
      }
    }`);

    for (const edge of data.webhookSubscriptions.edges) {
      await this.graphql(`mutation {
        webhookSubscriptionDelete(id: "${edge.node.id}") {
          userErrors { field message }
        }
      }`);
    }
  }
}
