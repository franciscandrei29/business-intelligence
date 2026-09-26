import type { StoreConnection } from '@prisma/client';

// ============================================
// Pagination
// ============================================
export interface PaginationOpts {
  cursor?: string;
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  hasNextPage: boolean;
  cursor?: string;
}

// ============================================
// Connection test result
// ============================================
export interface ConnectionResult {
  success: boolean;
  shopName?: string;
  error?: string;
}

// ============================================
// Normalized types (platform-agnostic)
// ============================================
export interface NormalizedProduct {
  externalId: string;
  title: string;
  sku: string | null;
  price: number;
  compareAtPrice: number | null;
  costPerUnit: number | null;
  inventory: number;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  imageUrl: string | null;
  handle: string | null;
  status: string;
}

export interface NormalizedOrder {
  externalId: string;
  orderNumber: string | null;
  customerExternalId: string | null;
  total: number;
  subtotal: number | null;
  totalRefunded: number | null;
  discountTotal: number | null;
  currency: string;
  status: string;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  itemsCount: number;
  lineItems: string | null;
  placedAt: Date;
  fulfilledAt?: Date | null;
}

export interface NormalizedCustomer {
  externalId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  totalSpent: number;
  ordersCount: number;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
  tags: string[];
}

export interface NormalizedInventory {
  externalProductId: string;
  quantity: number;
}

export interface NormalizedCollection {
  externalId: string;
  title: string;
  handle: string;
  productsCount: number;
}

export interface SeoPayload {
  metaTitle?: string;
  metaDescription?: string;
  handle?: string;
}

export interface CollectionPayload {
  title: string;
  productIds: string[];
}

// ============================================
// CommerceProvider interface
// ============================================
export interface CommerceProvider {
  platform: 'SHOPIFY' | 'WOOCOMMERCE' | 'EMAG';
  storeConnectionId: string;

  testConnection(): Promise<ConnectionResult>;

  fetchProducts(opts?: PaginationOpts): Promise<PaginatedResult<NormalizedProduct>>;
  fetchProductById(id: string): Promise<NormalizedProduct | null>;
  updateProductTags(id: string, tags: string[]): Promise<void>;
  updateProductSeo(id: string, seo: SeoPayload): Promise<void>;

  fetchOrders(from: Date, to: Date, opts?: PaginationOpts): Promise<PaginatedResult<NormalizedOrder>>;
  fetchCustomers(opts?: PaginationOpts): Promise<PaginatedResult<NormalizedCustomer>>;
  fetchInventoryLevels(): Promise<NormalizedInventory[]>;

  createCollection(payload: CollectionPayload): Promise<string>;
  listCollections(): Promise<NormalizedCollection[]>;

  registerWebhooks(): Promise<void>;
  unregisterWebhooks(): Promise<void>;
}
