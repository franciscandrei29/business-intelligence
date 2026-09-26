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

interface WooConfig {
  apiUrl: string;       // e.g. https://site.com
  consumerKey: string;
  consumerSecret: string;
  storeConnectionId: string;
}

export class WooCommerceConnector implements CommerceProvider {
  platform = 'WOOCOMMERCE' as const;
  storeConnectionId: string;
  private baseUrl: string;
  private auth: string;

  constructor(config: WooConfig) {
    this.storeConnectionId = config.storeConnectionId;
    // Ensure no trailing slash
    this.baseUrl = config.apiUrl.replace(/\/$/, '') + '/wp-json/wc/v3';
    // HTTP Basic Auth
    this.auth = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64');
  }

  // ---- REST helper with pagination ----
  private async request<T = any>(
    endpoint: string,
    params?: Record<string, string | number>,
    method: 'GET' | 'POST' | 'PUT' = 'GET',
    body?: any
  ): Promise<{ data: T; totalPages: number; total: number }> {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, String(v));
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Basic ${this.auth}`,
      'Content-Type': 'application/json',
    };

    const res = await fetch(url.toString(), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`WooCommerce API error ${res.status}: ${text}`);
    }

    const totalPages = parseInt(res.headers.get('x-wp-totalpages') || '1', 10);
    const total = parseInt(res.headers.get('x-wp-total') || '0', 10);
    const data = await res.json();

    return { data: data as T, totalPages, total };
  }

  // ---- Test connection ----
  async testConnection(): Promise<ConnectionResult> {
    try {
      // WooCommerce system status endpoint
      const { data } = await this.request<any>('/system_status');
      const shopName = data?.settings?.blogname || data?.environment?.site_url || 'WooCommerce Store';
      return { success: true, shopName };
    } catch (err: any) {
      // Fallback: try a simple products request
      try {
        await this.request<any[]>('/products', { per_page: 1 });
        return { success: true, shopName: 'WooCommerce Store' };
      } catch (err2: any) {
        return { success: false, error: err2.message };
      }
    }
  }

  // ---- Products ----
  async fetchProducts(opts?: PaginationOpts): Promise<PaginatedResult<NormalizedProduct>> {
    const page = opts?.cursor ? parseInt(opts.cursor, 10) : 1;
    const perPage = opts?.limit || 100;

    const { data: raw, totalPages } = await this.request<any[]>('/products', {
      per_page: perPage,
      page,
      orderby: 'id',
      order: 'asc',
    });

    const products: NormalizedProduct[] = raw.map((p) => ({
      externalId: String(p.id),
      title: p.name || '',
      sku: p.sku || null,
      price: parseFloat(p.price || '0'),
      compareAtPrice: p.regular_price && p.sale_price
        ? parseFloat(p.regular_price)
        : null,
      costPerUnit: null, // WooCommerce doesn't have cost natively
      inventory: p.stock_quantity || 0,
      vendor: null, // Not standard in WooCommerce
      productType: p.type || null,
      tags: (p.tags || []).map((t: any) => t.name),
      imageUrl: p.images?.[0]?.src || null,
      handle: p.slug || null,
      status: p.status || 'publish',
    }));

    const hasNextPage = page < totalPages;
    return {
      data: products,
      hasNextPage,
      cursor: hasNextPage ? String(page + 1) : undefined,
    };
  }

  async fetchProductById(id: string): Promise<NormalizedProduct | null> {
    try {
      const { data: p } = await this.request<any>(`/products/${id}`);
      return {
        externalId: String(p.id),
        title: p.name || '',
        sku: p.sku || null,
        price: parseFloat(p.price || '0'),
        compareAtPrice: p.regular_price && p.sale_price
          ? parseFloat(p.regular_price)
          : null,
        costPerUnit: null,
        inventory: p.stock_quantity || 0,
        vendor: null,
        productType: p.type || null,
        tags: (p.tags || []).map((t: any) => t.name),
        imageUrl: p.images?.[0]?.src || null,
        handle: p.slug || null,
        status: p.status || 'publish',
      };
    } catch {
      return null;
    }
  }

  async updateProductTags(id: string, tags: string[]): Promise<void> {
    // WooCommerce tags need to be existing tag objects or created
    // We'll send tag names and WooCommerce will match/create them
    const tagObjects = tags.map((name) => ({ name }));
    await this.request(`/products/${id}`, undefined, 'PUT', { tags: tagObjects });
  }

  async updateProductSeo(id: string, seo: SeoPayload): Promise<void> {
    const update: any = {};
    // WooCommerce uses Yoast SEO meta fields if available
    if (seo.handle) update.slug = seo.handle;
    // Meta title and description require Yoast SEO plugin
    // Store in meta_data as fallback
    const metaData: any[] = [];
    if (seo.metaTitle) metaData.push({ key: '_yoast_wpseo_title', value: seo.metaTitle });
    if (seo.metaDescription) metaData.push({ key: '_yoast_wpseo_metadesc', value: seo.metaDescription });
    if (metaData.length > 0) update.meta_data = metaData;

    if (Object.keys(update).length > 0) {
      await this.request(`/products/${id}`, undefined, 'PUT', update);
    }
  }

  // ---- Orders ----
  async fetchOrders(from: Date, to: Date, opts?: PaginationOpts): Promise<PaginatedResult<NormalizedOrder>> {
    const page = opts?.cursor ? parseInt(opts.cursor, 10) : 1;
    const perPage = opts?.limit || 100;

    const { data: raw, totalPages } = await this.request<any[]>('/orders', {
      per_page: perPage,
      page,
      after: from.toISOString(),
      before: to.toISOString(),
      orderby: 'date',
      order: 'asc',
    });

    const orders: NormalizedOrder[] = raw.map((o) => {
      const lineItems = (o.line_items || []).map((li: any) => ({
        title: li.name,
        quantity: li.quantity,
        price: parseFloat(li.price || '0'),
        sku: li.sku || null,
        productId: li.product_id ? String(li.product_id) : null,
      }));

      return {
        externalId: String(o.id),
        orderNumber: o.number ? `#${o.number}` : null,
        customerExternalId: o.customer_id ? String(o.customer_id) : null,
        total: parseFloat(o.total || '0'),
        subtotal: o.line_items
          ? o.line_items.reduce((sum: number, li: any) => sum + parseFloat(li.subtotal || '0'), 0)
          : null,
        totalRefunded: parseFloat(o.total_refunded || '0') || null,
        discountTotal: parseFloat(o.discount_total || '0') || null,
        currency: o.currency || 'RON',
        status: o.status || 'unknown',
        financialStatus: o.status || null,
        fulfillmentStatus: o.status === 'completed' ? 'fulfilled' : null,
        itemsCount: lineItems.reduce((sum: number, li: any) => sum + li.quantity, 0),
        lineItems: JSON.stringify(lineItems),
        placedAt: new Date(o.date_created),
      };
    });

    const hasNextPage = page < totalPages;
    return {
      data: orders,
      hasNextPage,
      cursor: hasNextPage ? String(page + 1) : undefined,
    };
  }

  // ---- Customers ----
  async fetchCustomers(opts?: PaginationOpts): Promise<PaginatedResult<NormalizedCustomer>> {
    const page = opts?.cursor ? parseInt(opts.cursor, 10) : 1;
    const perPage = opts?.limit || 100;

    const { data: raw, totalPages } = await this.request<any[]>('/customers', {
      per_page: perPage,
      page,
      orderby: 'id',
      order: 'asc',
    });

    const customers: NormalizedCustomer[] = raw.map((c) => ({
      externalId: String(c.id),
      email: c.email || null,
      firstName: c.first_name || null,
      lastName: c.last_name || null,
      phone: c.billing?.phone || null,
      totalSpent: parseFloat(c.total_spent || '0'),
      ordersCount: c.orders_count || 0,
      firstOrderAt: null, // WooCommerce doesn't provide this directly
      lastOrderAt: c.date_last_active ? new Date(c.date_last_active) : null,
      tags: [], // WooCommerce doesn't have customer tags natively
    }));

    const hasNextPage = page < totalPages;
    return {
      data: customers,
      hasNextPage,
      cursor: hasNextPage ? String(page + 1) : undefined,
    };
  }

  // ---- Inventory ----
  async fetchInventoryLevels(): Promise<NormalizedInventory[]> {
    const inventories: NormalizedInventory[] = [];
    let page = 1;

    do {
      const { data: products, totalPages } = await this.request<any[]>('/products', {
        per_page: 100,
        page,
      });

      for (const p of products) {
        inventories.push({
          externalProductId: String(p.id),
          quantity: p.stock_quantity || 0,
        });
      }

      if (page >= totalPages) break;
      page++;
    } while (true);

    return inventories;
  }

  // ---- Collections (WooCommerce categories) ----
  async createCollection(payload: CollectionPayload): Promise<string> {
    const { data: cat } = await this.request<any>('/products/categories', undefined, 'POST', {
      name: payload.title,
    });

    const categoryId = cat.id;

    // Assign products to category
    for (const productId of payload.productIds) {
      try {
        const { data: product } = await this.request<any>(`/products/${productId}`);
        const existingCats = (product.categories || []).map((c: any) => ({ id: c.id }));
        existingCats.push({ id: categoryId });
        await this.request(`/products/${productId}`, undefined, 'PUT', {
          categories: existingCats,
        });
      } catch (err) {
        console.error(`Failed to assign product ${productId} to category ${categoryId}:`, err);
      }
    }

    return String(categoryId);
  }

  async listCollections(): Promise<NormalizedCollection[]> {
    const { data: categories } = await this.request<any[]>('/products/categories', {
      per_page: 100,
    });

    return categories.map((c) => ({
      externalId: String(c.id),
      title: c.name,
      handle: c.slug,
      productsCount: c.count || 0,
    }));
  }

  // ---- Webhooks ----
  async registerWebhooks(): Promise<void> {
    const topics = [
      'product.updated',
      'order.created',
      'order.updated',
      'customer.created',
    ];

    const deliveryUrl = process.env.APP_URL || 'https://bi.kimonogroup.ro';

    for (const topic of topics) {
      const eventSlug = topic.replace('.', '/');
      try {
        await this.request('/webhooks', undefined, 'POST', {
          name: `Kimono BI - ${topic}`,
          topic,
          delivery_url: `${deliveryUrl}/api/webhooks/woo/${eventSlug}`,
          status: 'active',
        });
      } catch (err) {
        console.error(`Failed to register webhook ${topic}:`, err);
      }
    }
  }

  async unregisterWebhooks(): Promise<void> {
    try {
      const { data: webhooks } = await this.request<any[]>('/webhooks', { per_page: 100 });
      for (const wh of webhooks) {
        if (wh.name?.startsWith('Kimono BI')) {
          await this.request(`/webhooks/${wh.id}`, { force: 'true' }, 'PUT', { status: 'disabled' });
        }
      }
    } catch (err) {
      console.error('Failed to unregister webhooks:', err);
    }
  }
}
