import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import crypto from 'crypto';
import { db } from '~/lib/db.server';

function verifyHmac(rawBody: string, hmacHeader: string): boolean {
  const secret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!secret) {
    console.error('SHOPIFY_CLIENT_SECRET not set — cannot verify webhook HMAC');
    return false;
  }
  const digest = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
}

export async function action({ request }: ActionFunctionArgs) {
  const hmacHeader = request.headers.get('x-shopify-hmac-sha256') || '';
  const shopDomain = request.headers.get('x-shopify-shop-domain') || '';
  const topic = request.headers.get('x-shopify-topic') || '';

  const rawBody = await request.text();

  // ── HMAC verification ────────────────────────────────────────────────────
  if (!hmacHeader || !verifyHmac(rawBody, hmacHeader)) {
    console.warn(`Shopify webhook: HMAC verification failed for ${topic} from ${shopDomain}`);
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Mandatory compliance webhooks (GDPR) ─────────────────────────────────
  // These must respond 200 even if we don't find the store
  if (topic === 'customers/data_request') {
    // Merchant requested customer data export
    // Respond with 200 — we log the request for manual review
    console.log(`[compliance] customers/data_request from ${shopDomain}`);
    try {
      const payload = JSON.parse(rawBody);
      console.log(`[compliance] data_request for customer ${payload.customer?.id}, shop ${payload.shop_domain}`);
    } catch {}
    return json({ ok: true });
  }

  if (topic === 'customers/redact') {
    // Merchant requested customer data deletion
    console.log(`[compliance] customers/redact from ${shopDomain}`);
    try {
      const payload = JSON.parse(rawBody);
      const customerId = payload.customer?.id;
      if (customerId) {
        const externalId = `gid://shopify/Customer/${customerId}`;
        // Delete customer data from all stores matching this domain
        const stores = await db.storeConnection.findMany({
          where: { domain: shopDomain, platform: 'SHOPIFY' },
          select: { id: true },
        });
        for (const store of stores) {
          await db.customer.deleteMany({
            where: { storeConnectionId: store.id, externalId },
          });
        }
        console.log(`[compliance] redacted customer ${customerId} from ${shopDomain}`);
      }
    } catch (err) {
      console.error(`[compliance] customers/redact error:`, err);
    }
    return json({ ok: true });
  }

  if (topic === 'shop/redact') {
    // Store owner uninstalled and requested full data deletion (48h after uninstall)
    console.log(`[compliance] shop/redact from ${shopDomain}`);
    try {
      const stores = await db.storeConnection.findMany({
        where: { domain: shopDomain, platform: 'SHOPIFY' },
        select: { id: true },
      });
      for (const store of stores) {
        // Delete all synced data for this store
        await db.order.deleteMany({ where: { storeConnectionId: store.id } });
        await db.customer.deleteMany({ where: { storeConnectionId: store.id } });
        await db.product.deleteMany({ where: { storeConnectionId: store.id } });
        await db.storeConnection.update({
          where: { id: store.id },
          data: { isActive: false, shopifyAccessToken: null },
        });
        console.log(`[compliance] redacted all data for store ${store.id} (${shopDomain})`);
      }
    } catch (err) {
      console.error(`[compliance] shop/redact error:`, err);
    }
    return json({ ok: true });
  }

  // ── Regular webhooks — need a store ───────────────────────────────────────
  const store = await db.storeConnection.findFirst({
    where: { domain: shopDomain, platform: 'SHOPIFY', isActive: true },
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
      case 'app/uninstalled':
        console.log(`[webhook] app/uninstalled for ${shopDomain}`);
        await db.storeConnection.update({
          where: { id: store.id },
          data: { isActive: false },
        });
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
      storeConnectionId: storeId, externalId, title: p.title || '',
      sku: variant?.sku || null, price: parseFloat(variant?.price || '0'),
      compareAtPrice: variant?.compare_at_price ? parseFloat(variant.compare_at_price) : null,
      inventory: variant?.inventory_quantity || 0,
      vendor: p.vendor || null, productType: p.product_type || null,
      tags: p.tags ? p.tags.split(', ') : [], imageUrl: p.image?.src || null,
      handle: p.handle || null, status: p.status || 'active',
    },
    update: {
      title: p.title || '', sku: variant?.sku || null,
      price: parseFloat(variant?.price || '0'),
      compareAtPrice: variant?.compare_at_price ? parseFloat(variant.compare_at_price) : null,
      inventory: variant?.inventory_quantity || 0,
      vendor: p.vendor || null, productType: p.product_type || null,
      tags: p.tags ? p.tags.split(', ') : [], imageUrl: p.image?.src || null,
      status: p.status || 'active',
    },
  });
}

async function handleOrderUpdate(storeId: string, o: any) {
  const externalId = `gid://shopify/Order/${o.id}`;
  const lineItems = (o.line_items || []).map((li: any) => ({
    title: li.title, quantity: li.quantity,
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
    where: { storeConnectionId_externalId: { storeConnectionId: storeId, externalId } },
    create: {
      storeConnectionId: storeId, externalId, orderNumber: o.name || null, customerId,
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
      customerId, total: parseFloat(o.total_price || '0'),
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
    where: { storeConnectionId_externalId: { storeConnectionId: storeId, externalId } },
    create: {
      storeConnectionId: storeId, externalId,
      email: c.email || null, firstName: c.first_name || null, lastName: c.last_name || null,
      phone: c.phone || null, totalSpent: parseFloat(c.total_spent || '0'),
      ordersCount: c.orders_count || 0,
    },
    update: {
      email: c.email || null, firstName: c.first_name || null, lastName: c.last_name || null,
      phone: c.phone || null, totalSpent: parseFloat(c.total_spent || '0'),
      ordersCount: c.orders_count || 0,
    },
  });
}

async function handleInventoryUpdate(storeId: string, payload: any) {
  console.log(`Inventory update for store ${storeId}:`, payload);
}

export async function loader() {
  return json({ error: 'Method not allowed' }, { status: 405 });
}
