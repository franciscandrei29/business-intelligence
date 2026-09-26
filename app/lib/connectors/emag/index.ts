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

export class EmagConnector implements CommerceProvider {
  platform = 'EMAG' as const;
  storeConnectionId: string;
  private baseUrl = 'https://marketplace-api.emag.ro/api-3';
  private auth: string;

  constructor(config: { apiKey: string; apiSecret: string; storeConnectionId: string }) {
    this.auth = Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString('base64');
    this.storeConnectionId = config.storeConnectionId;
  }

  private async request(endpoint: string, method = 'POST', body?: any) {
    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      method,
      headers: {
        'Authorization': `Basic ${this.auth}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`eMag API error ${res.status}: ${text}`);
    }
    return res.json();
  }

  async testConnection(): Promise<ConnectionResult> {
    try {
      await this.request('/product_offer/count', 'POST', {});
      return { success: true, shopName: 'eMag Marketplace' };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async fetchProducts(opts?: PaginationOpts): Promise<PaginatedResult<NormalizedProduct>> {
    const page = opts?.cursor ? parseInt(opts.cursor) : 1;
    const limit = opts?.limit || 100;
    try {
      const data = await this.request('/product_offer/read', 'POST', {
        currentPage: page,
        itemsPerPage: limit,
      });
      const results = data.results || [];
      const products: NormalizedProduct[] = results.map((p: any) => ({
        externalId: String(p.id || p.product_id || ''),
        title: p.name || p.product_name || 'Produs eMag',
        sku: p.ean?.[0] || p.part_number_key || null,
        price: parseFloat(p.sale_price || p.recommended_price || '0'),
        compareAtPrice: p.recommended_price ? parseFloat(p.recommended_price) : null,
        costPerUnit: null,
        inventory: parseInt(p.stock?.[0]?.value || '0', 10),
        vendor: p.brand?.name || null,
        productType: p.category_id ? String(p.category_id) : null,
        tags: [],
        imageUrl: p.images?.[0]?.url || null,
        handle: p.part_number_key || null,
        status: p.status === 1 ? 'active' : 'inactive',
      }));
      const hasNextPage = results.length >= limit;
      return {
        data: products,
        hasNextPage,
        cursor: hasNextPage ? String(page + 1) : undefined,
      };
    } catch (err) {
      return { data: [], hasNextPage: false };
    }
  }

  async fetchProductById(id: string): Promise<NormalizedProduct | null> {
    try {
      const data = await this.request('/product_offer/read', 'POST', {
        id: parseInt(id),
      });
      const p = data.results?.[0];
      if (!p) return null;
      return {
        externalId: String(p.id || p.product_id),
        title: p.name || p.product_name || '',
        sku: p.ean?.[0] || p.part_number_key || null,
        price: parseFloat(p.sale_price || '0'),
        compareAtPrice: p.recommended_price ? parseFloat(p.recommended_price) : null,
        costPerUnit: null,
        inventory: parseInt(p.stock?.[0]?.value || '0', 10),
        vendor: p.brand?.name || null,
        productType: p.category_id ? String(p.category_id) : null,
        tags: [],
        imageUrl: p.images?.[0]?.url || null,
        handle: p.part_number_key || null,
        status: p.status === 1 ? 'active' : 'inactive',
      };
    } catch {
      return null;
    }
  }

  async updateProductTags(_id: string, _tags: string[]): Promise<void> {
    // eMag does not support tags
  }

  async updateProductSeo(_id: string, _seo: SeoPayload): Promise<void> {
    // eMag does not support SEO updates
  }

  async fetchOrders(from: Date, to: Date, opts?: PaginationOpts): Promise<PaginatedResult<NormalizedOrder>> {
    const page = opts?.cursor ? parseInt(opts.cursor) : 1;
    const limit = opts?.limit || 100;
    try {
      const data = await this.request('/order/read', 'POST', {
        currentPage: page,
        itemsPerPage: limit,
        createdAfter: from.toISOString().split('T')[0],
        createdBefore: to.toISOString().split('T')[0],
      });
      const results = data.results || [];
      const orders: NormalizedOrder[] = results.map((o: any) => ({
        externalId: String(o.id || o.order_id),
        orderNumber: String(o.id || o.order_id),
        customerExternalId: o.customer?.id ? String(o.customer.id) : null,
        total: parseFloat(o.cashed_co || o.payment_mode_id || '0'),
        subtotal: null,
        totalRefunded: null,
        discountTotal: o.vouchers?.length ? parseFloat(o.vouchers[0]?.sale_price || '0') : null,
        currency: 'RON',
        status: String(o.status || 'unknown'),
        financialStatus: o.payment_status ? String(o.payment_status) : null,
        fulfillmentStatus: o.status ? String(o.status) : null,
        itemsCount: o.products?.length || 0,
        lineItems: o.products ? JSON.stringify(o.products) : null,
        placedAt: new Date(o.date || o.created),
      }));
      const hasNextPage = results.length >= limit;
      return {
        data: orders,
        hasNextPage,
        cursor: hasNextPage ? String(page + 1) : undefined,
      };
    } catch {
      return { data: [], hasNextPage: false };
    }
  }

  async fetchCustomers(_opts?: PaginationOpts): Promise<PaginatedResult<NormalizedCustomer>> {
    // eMag does not have a dedicated customers endpoint
    // Customers are extracted from orders
    return { data: [], hasNextPage: false };
  }

  async fetchInventoryLevels(): Promise<NormalizedInventory[]> {
    // Inventory is fetched via product offers
    try {
      const { data: products } = await this.fetchProducts({ limit: 100 });
      return products.map((p) => ({
        externalProductId: p.externalId,
        quantity: p.inventory,
      }));
    } catch {
      return [];
    }
  }

  async createCollection(_payload: CollectionPayload): Promise<string> {
    throw new Error('eMag does not support collections');
  }

  async listCollections(): Promise<NormalizedCollection[]> {
    return [];
  }

  async registerWebhooks(): Promise<void> {
    // eMag does not support webhooks
  }

  async unregisterWebhooks(): Promise<void> {
    // eMag does not support webhooks
  }
}
