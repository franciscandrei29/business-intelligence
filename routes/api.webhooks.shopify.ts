import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import crypto from 'crypto';
import { db } from '~/lib/db.server';

export async function action({ request }: ActionFunctionArgs) {
  const hmacHeader = request.headers.get('x-shopify-hmac-sha256') || '';
  const shopDomain = request.headers.get('x-shopify-shop-domain') || '';
  const topic = request.headers.get('x-shopify-topic') || '';

  const rawBody = await request.text();

  // Find store by domain
  const store = await db.storeConnection.findFirst({
    where: {
      domain: shopDomain,
      platform: 'SHOPIFY',
      isActive: true,
    },
  });

  if (!store) {
    console.warn(`Shopify webhook: no store found for ${shopDomain}`);
    return json({ error: 'Store not found' }, { status: 404 });
  }

  const payload = JSON.parse(rawBody);

  try {
    switch (topic) {
      case 'products/update':
      case 'products/create':
        await handleProductUpdate(store.id, payload);
        break;
      case 'orders/create':
      case 'orders/updated':
        await handleOrderUpdate(store.id, payload);
        break;
      case 'customers/create':
      case 'customers/update':
        await handleCustomerUpdate(store.id, payload);
        break;
      case 'inventory_levels/update':
        await handleInventoryUpdate(store.id, payload);
        break;
      default:
        console.log(`Shopify webhook: unhandled topic ${topic}`);
    }
  } catch (err) {
    console.error(`Shopify webhook processing error (${topic}):`, err);
  }

  return json({ ok: true });
}

async function handleProductUpdate(storeId: string, p: any) {
  const externalId = `gid://shopify/Product/${p.id}`;
  const variant = p.variants?.[0];
  await db.product.upsert({
    where: {
      storeConnectionId_externalId: { storeConnectionId: storeId, externalId },
    },
    create: {
      storeConnectionId: storeId,
      externalId,
      title: p.title || '',
      sku: variant?.sku || null,
      price: parseFloat(variant?.price || '0'),
      compareAtPrice: variant?.compare_at_price ? parseFloat(variant.compare_at_price) : null,
      inventory: variant?.inventory_quantity || 0,
      vendor: p.vendor || null,
      productType: p.product_type || null,
      tags: p.tags ? p.tags.split(', ') : [],
      imageUrl: p.image?.src || null,
      handle: p.handle || null,
      status: p.status || 'active',
    },
    update: {
      title: p.title || '',
      sku: variant?.sku || null,
      price: parseFloat(variant?.price || '0'),
      compareAtPrice: variant?.compare_at_price ? parseFloat(variant.compare_at_price) : null,
      inventory: variant?.inventory_quantity || 0,
      vendor: p.vendor || null,
      productType: p.product_type || null,
      tags: p.tags ? p.tags.split(', ') : [],
      imageUrl: p.image?.src || null,
      status: p.status || 'active',
    },
  });
}

async function handleOrderUpdate(storeId: string, o: any) {
  const externalId = `gid://shopify/Order/${o.id}`;
  const lineItems = (o.line_items || []).map((li: any) => ({
    title: li.title,
    quantity: li.quantity,
    price: parseFloat(li.price || '0'),
    sku: li.sku || null,
    productId: li.product_id ? `gid://shopify/Product/${li.product_id}` : null,
  }));

  let customerId: string | null = null;
  if (o.customer?.id) {
    const customer = await db.customer.findUnique({
      where: { storeConnectionId_externalId: { storeConnectionId: storeId, externalId: `gid://shopify/Customer/${o.customer.id}` } },
      select: { id: true },
    });
    customerId = customer?.id ?? null;
  }

  await db.order.upsert({
    where: {
      storeConnectionId_externalId: { storeConnectionId: storeId, externalId },
    },
    create: {
      storeConnectionId: storeId,
      externalId,
      orderNumber: o.name || null,
      customerId,
      total: parseFloat(o.total_price || '0'),
      subtotal: o.subtotal_price ? parseFloat(o.subtotal_price) : null,
      totalRefunded: o.total_refunded ? parseFloat(o.total_refunded) : null,
      discountTotal: o.total_discounts ? parseFloat(o.total_discounts) : null,
      currency: o.currency || 'RON',
      status: o.financial_status || 'unknown',
      financialStatus: o.financial_status || null,
      fulfillmentStatus: o.fulfillment_status || null,
      itemsCount: lineItems.reduce((sum: number, li: any) => sum + li.quantity, 0),
      lineItems: JSON.stringify(lineItems),
      placedAt: new Date(o.created_at),
    },
    update: {
      customerId,
      total: parseFloat(o.total_price || '0'),
      totalRefunded: o.total_refunded ? parseFloat(o.total_refunded) : null,
      discountTotal: o.total_discounts ? parseFloat(o.total_discounts) : null,
      status: o.financial_status || 'unknown',
      financialStatus: o.financial_status || null,
      fulfillmentStatus: o.fulfillment_status || null,
      lineItems: JSON.stringify(lineItems),
    },
  });
}

async function handleCustomerUpdate(storeId: string, c: any) {
  const externalId = `gid://shopify/Customer/${c.id}`;
  await db.customer.upsert({
    where: {
      storeConnectionId_externalId: { storeConnectionId: storeId, externalId },
    },
    create: {
      storeConnectionId: storeId,
      externalId,
      email: c.email || null,
      firstName: c.first_name || null,
      lastName: c.last_name || null,
      phone: c.phone || null,
      totalSpent: parseFloat(c.total_spent || '0'),
      ordersCount: c.orders_count || 0,
    },
    update: {
      email: c.email || null,
      firstName: c.first_name || null,
      lastName: c.last_name || null,
      phone: c.phone || null,
      totalSpent: parseFloat(c.total_spent || '0'),
      ordersCount: c.orders_count || 0,
    },
  });
}

async function handleInventoryUpdate(storeId: string, payload: any) {
  // inventory_levels/update sends inventory_item_id and available
  // We need to find the product by inventory item — simplified approach
  // This would require storing inventory_item_id mapping
  console.log(`Inventory update for store ${storeId}:`, payload);
}

export async function loader() {
  return json({ error: 'Method not allowed' }, { status: 405 });
}
