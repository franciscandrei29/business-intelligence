import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import crypto from 'crypto';
import { db } from '~/lib/db.server';

export async function action({ request, params }: ActionFunctionArgs) {
  // WooCommerce sends webhooks as POST with JSON body
  const signature = request.headers.get('x-wc-webhook-signature') || '';
  const source = request.headers.get('x-wc-webhook-source') || '';
  const topic = request.headers.get('x-wc-webhook-topic') || '';
  const webhookId = request.headers.get('x-wc-webhook-id') || '';

  const rawBody = await request.text();

  // Find the store connection by source domain
  const sourceDomain = source.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const store = await db.storeConnection.findFirst({
    where: {
      domain: sourceDomain,
      platform: 'WOOCOMMERCE',
      isActive: true,
    },
  });

  if (!store) {
    console.warn(`WooCommerce webhook: no store found for domain ${sourceDomain}`);
    return json({ error: 'Store not found' }, { status: 404 });
  }

  // Verify HMAC signature using consumer secret
  // WooCommerce signs with the webhook secret (which is the consumer secret by default)
  if (signature && store.wooConsumerSecret) {
    try {
      const { decrypt } = await import('~/lib/auth/crypto.server');
      const secret = decrypt(store.wooConsumerSecret);
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(rawBody)
        .digest('base64');

      if (signature !== expectedSignature) {
        console.warn(`WooCommerce webhook: HMAC mismatch for store ${store.id}`);
        return json({ error: 'Invalid signature' }, { status: 401 });
      }
    } catch (err) {
      console.error('HMAC verification error:', err);
    }
  }

  const payload = JSON.parse(rawBody);

  // Process by topic
  try {
    switch (topic) {
      case 'product.updated':
      case 'product.created':
        await handleProductUpdate(store.id, payload);
        break;
      case 'order.created':
      case 'order.updated':
        await handleOrderUpdate(store.id, payload);
        break;
      case 'customer.created':
      case 'customer.updated':
        await handleCustomerUpdate(store.id, payload);
        break;
      default:
        console.log(`WooCommerce webhook: unhandled topic ${topic}`);
    }
  } catch (err) {
    console.error(`WooCommerce webhook processing error (${topic}):`, err);
  }

  return json({ ok: true });
}

async function handleProductUpdate(storeId: string, p: any) {
  if (!p.id) return;
  await db.product.upsert({
    where: {
      storeConnectionId_externalId: {
        storeConnectionId: storeId,
        externalId: String(p.id),
      },
    },
    create: {
      storeConnectionId: storeId,
      externalId: String(p.id),
      title: p.name || '',
      sku: p.sku || null,
      price: parseFloat(p.price || '0'),
      compareAtPrice: p.regular_price && p.sale_price ? parseFloat(p.regular_price) : null,
      inventory: p.stock_quantity || 0,
      productType: p.type || null,
      tags: (p.tags || []).map((t: any) => t.name),
      imageUrl: p.images?.[0]?.src || null,
      handle: p.slug || null,
      status: p.status || 'publish',
    },
    update: {
      title: p.name || '',
      sku: p.sku || null,
      price: parseFloat(p.price || '0'),
      compareAtPrice: p.regular_price && p.sale_price ? parseFloat(p.regular_price) : null,
      inventory: p.stock_quantity || 0,
      tags: (p.tags || []).map((t: any) => t.name),
      imageUrl: p.images?.[0]?.src || null,
      status: p.status || 'publish',
    },
  });
}

async function handleOrderUpdate(storeId: string, o: any) {
  if (!o.id) return;
  const lineItems = (o.line_items || []).map((li: any) => ({
    title: li.name,
    quantity: li.quantity,
    price: parseFloat(li.price || '0'),
    sku: li.sku || null,
    productId: li.product_id ? String(li.product_id) : null,
  }));

  let customerId: string | null = null;
  if (o.customer_id) {
    const customer = await db.customer.findUnique({
      where: { storeConnectionId_externalId: { storeConnectionId: storeId, externalId: String(o.customer_id) } },
      select: { id: true },
    });
    customerId = customer?.id ?? null;
  }

  await db.order.upsert({
    where: {
      storeConnectionId_externalId: {
        storeConnectionId: storeId,
        externalId: String(o.id),
      },
    },
    create: {
      storeConnectionId: storeId,
      externalId: String(o.id),
      orderNumber: o.number ? `#${o.number}` : null,
      customerId,
      total: parseFloat(o.total || '0'),
      subtotal: o.line_items
        ? o.line_items.reduce((sum: number, li: any) => sum + parseFloat(li.subtotal || '0'), 0)
        : null,
      discountTotal: parseFloat(o.discount_total || '0') || null,
      currency: o.currency || 'RON',
      status: o.status || 'unknown',
      financialStatus: o.status || null,
      itemsCount: lineItems.reduce((sum: number, li: any) => sum + li.quantity, 0),
      lineItems: JSON.stringify(lineItems),
      placedAt: new Date(o.date_created),
    },
    update: {
      customerId,
      total: parseFloat(o.total || '0'),
      status: o.status || 'unknown',
      financialStatus: o.status || null,
      itemsCount: lineItems.reduce((sum: number, li: any) => sum + li.quantity, 0),
      lineItems: JSON.stringify(lineItems),
    },
  });
}

async function handleCustomerUpdate(storeId: string, c: any) {
  if (!c.id) return;
  await db.customer.upsert({
    where: {
      storeConnectionId_externalId: {
        storeConnectionId: storeId,
        externalId: String(c.id),
      },
    },
    create: {
      storeConnectionId: storeId,
      externalId: String(c.id),
      email: c.email || null,
      firstName: c.first_name || null,
      lastName: c.last_name || null,
      phone: c.billing?.phone || null,
      totalSpent: parseFloat(c.total_spent || '0'),
      ordersCount: c.orders_count || 0,
    },
    update: {
      email: c.email || null,
      firstName: c.first_name || null,
      lastName: c.last_name || null,
      phone: c.billing?.phone || null,
      totalSpent: parseFloat(c.total_spent || '0'),
      ordersCount: c.orders_count || 0,
    },
  });
}

// Reject GET requests
export async function loader() {
  return json({ error: 'Method not allowed' }, { status: 405 });
}
