/**
 * Incremental sync — runs hourly via cron.
 * Pulls orders modified in the last 3 hours, products updated in the last 24h.
 * Short delay between API calls, serial DB writes (safe for PG).
 */
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

function decrypt(data) {
  const [iv, tag, ct] = data.split(':').map((h) => Buffer.from(h, 'hex'));
  const key = Buffer.from(process.env.APP_ENCRYPTION_KEY, 'hex');
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return d.update(ct) + d.final('utf8');
}

const API_VERSION = '2025-04';

async function gql(shop, token, query) {
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors).slice(0, 400));
  return json.data;
}

async function syncShopifyIncremental(store) {
  const token = decrypt(store.shopifyAccessToken);
  const now = new Date();
  // Window = max(lastSync..now, 2h default). Adds 15min overlap for safety.
  const bufferMs = 15 * 60 * 1000;
  const defaultWindowMs = 2 * 60 * 60 * 1000;
  const lastSync = store.lastSyncAt ? new Date(store.lastSyncAt).getTime() : 0;
  const windowStart = lastSync > 0 ? Math.min(lastSync - bufferMs, now.getTime() - defaultWindowMs) : now.getTime() - defaultWindowMs;
  const since = new Date(Math.max(windowStart, now.getTime() - 7 * 24 * 60 * 60 * 1000)); // cap at 7 days for safety

  const updatedAfter = since.toISOString();
  const updatedAfterProducts = since.toISOString();

  // --- CUSTOMERS (updated in last 24h) ---
  let custCursor;
  let custCount = 0;
  do {
    const after = custCursor ? `, after: "${custCursor}"` : '';
    const q = `{
      customers(first: 50, query: "updated_at:>'${updatedAfterProducts}'", sortKey: UPDATED_AT, reverse: true${after}) {
        edges { cursor node {
          id email firstName lastName phone amountSpent { amount }
          numberOfOrders
          createdAt updatedAt
          lastOrder { createdAt }
          tags
        } }
        pageInfo { hasNextPage }
      }
    }`;
    const data = await gql(store.domain, token, q);
    for (const e of data.customers.edges) {
      const c = e.node;
      try {
        await prisma.customer.upsert({
          where: { storeConnectionId_externalId: { storeConnectionId: store.id, externalId: c.id } },
          create: {
            storeConnectionId: store.id,
            externalId: c.id,
            email: c.email || null,
            firstName: c.firstName || null,
            lastName: c.lastName || null,
            phone: c.phone || null,
            totalSpent: parseFloat(c.amountSpent?.amount || '0'),
            ordersCount: parseInt(String(c.numberOfOrders || '0'), 10),
            firstOrderAt: null,
            lastOrderAt: c.lastOrder?.createdAt ? new Date(c.lastOrder.createdAt) : null,
            tags: c.tags || [],
          },
          update: {
            email: c.email || null,
            firstName: c.firstName || null,
            lastName: c.lastName || null,
            phone: c.phone || null,
            totalSpent: parseFloat(c.amountSpent?.amount || '0'),
            ordersCount: parseInt(String(c.numberOfOrders || '0'), 10),
            lastOrderAt: c.lastOrder?.createdAt ? new Date(c.lastOrder.createdAt) : null,
            tags: c.tags || [],
          },
        });
        custCount++;
      } catch (err) {
        console.error(`[${store.name}] customer upsert failed ${c.id}: ${err.message}`);
      }
    }
    custCursor = data.customers.pageInfo.hasNextPage ? data.customers.edges.at(-1).cursor : null;
    if (custCursor) await new Promise((r) => setTimeout(r, 500));
  } while (custCursor);

  // --- ORDERS (updated in last 3h) ---
  // Build map of customerExternalId -> customerId for fast lookup
  const allCustomers = await prisma.customer.findMany({
    where: { storeConnectionId: store.id },
    select: { id: true, externalId: true },
  });
  const custMap = new Map(allCustomers.map((c) => [c.externalId, c.id]));

  let ordCursor;
  let ordCount = 0;
  do {
    const after = ordCursor ? `, after: "${ordCursor}"` : '';
    const q = `{
      orders(first: 50, query: "updated_at:>'${updatedAfter}'", sortKey: UPDATED_AT, reverse: true${after}) {
        edges { cursor node {
          id name createdAt displayFinancialStatus displayFulfillmentStatus returnStatus
          totalPriceSet { shopMoney { amount currencyCode } }
          subtotalPriceSet { shopMoney { amount } }
          totalRefundedSet { shopMoney { amount } }
          totalDiscountsSet { shopMoney { amount } }
          customer { id }
          fulfillments(first: 1) { createdAt }
          lineItems(first: 50) { edges { node { title quantity originalUnitPriceSet { shopMoney { amount } } product { id } sku } } }
        } }
        pageInfo { hasNextPage }
      }
    }`;
    const data = await gql(store.domain, token, q);
    for (const e of data.orders.edges) {
      const n = e.node;
      const lineItems = n.lineItems.edges.map((li) => ({
        title: li.node.title,
        quantity: li.node.quantity,
        price: parseFloat(li.node.originalUnitPriceSet?.shopMoney?.amount || '0'),
        sku: li.node.sku,
        productId: li.node.product?.id,
      }));
      const customerId = n.customer?.id ? custMap.get(n.customer.id) ?? null : null;
      try {
        await prisma.order.upsert({
          where: { storeConnectionId_externalId: { storeConnectionId: store.id, externalId: n.id } },
          create: {
            storeConnectionId: store.id,
            externalId: n.id,
            orderNumber: n.name || null,
            customerId,
            total: parseFloat(n.totalPriceSet?.shopMoney?.amount || '0'),
            subtotal: n.subtotalPriceSet?.shopMoney?.amount ? parseFloat(n.subtotalPriceSet.shopMoney.amount) : null,
            totalRefunded: n.totalRefundedSet?.shopMoney?.amount ? parseFloat(n.totalRefundedSet.shopMoney.amount) : null,
            discountTotal: n.totalDiscountsSet?.shopMoney?.amount ? parseFloat(n.totalDiscountsSet.shopMoney.amount) : null,
            currency: n.totalPriceSet?.shopMoney?.currencyCode || 'RON',
            status: n.displayFinancialStatus || 'UNKNOWN',
            financialStatus: n.displayFinancialStatus || null,
            fulfillmentStatus: n.displayFulfillmentStatus || null,
            itemsCount: lineItems.reduce((s, li) => s + li.quantity, 0),
            lineItems: JSON.stringify(lineItems),
            placedAt: new Date(n.createdAt),
            fulfilledAt: n.fulfillments?.[0]?.createdAt ? new Date(n.fulfillments[0].createdAt) : null,
          },
          update: {
            customerId,
            total: parseFloat(n.totalPriceSet?.shopMoney?.amount || '0'),
            totalRefunded: n.totalRefundedSet?.shopMoney?.amount ? parseFloat(n.totalRefundedSet.shopMoney.amount) : null,
            discountTotal: n.totalDiscountsSet?.shopMoney?.amount ? parseFloat(n.totalDiscountsSet.shopMoney.amount) : null,
            status: n.displayFinancialStatus || 'UNKNOWN',
            financialStatus: n.displayFinancialStatus || null,
            fulfillmentStatus: n.displayFulfillmentStatus || null,
            itemsCount: lineItems.reduce((s, li) => s + li.quantity, 0),
            lineItems: JSON.stringify(lineItems),
            fulfilledAt: n.fulfillments?.[0]?.createdAt ? new Date(n.fulfillments[0].createdAt) : null,
          },
        });
        ordCount++;
      } catch (err) {
        console.error(`[${store.name}] order upsert failed ${n.id}: ${err.message}`);
      }
    }
    ordCursor = data.orders.pageInfo.hasNextPage ? data.orders.edges.at(-1).cursor : null;
    if (ordCursor) await new Promise((r) => setTimeout(r, 500));
  } while (ordCursor);

  // --- PRODUCTS (updated in last 24h) ---
  let prodCursor;
  let prodCount = 0;
  do {
    const after = prodCursor ? `, after: "${prodCursor}"` : '';
    const q = `{
      products(first: 50, query: "updated_at:>'${updatedAfterProducts}'", sortKey: UPDATED_AT, reverse: true${after}) {
        edges { cursor node {
          id title handle vendor productType tags status
          featuredImage { url }
          variants(first: 1) { edges { node { price compareAtPrice sku inventoryQuantity } } }
        } }
        pageInfo { hasNextPage }
      }
    }`;
    const data = await gql(store.domain, token, q);
    for (const e of data.products.edges) {
      const p = e.node;
      const v = p.variants.edges[0]?.node;
      try {
        await prisma.product.upsert({
          where: { storeConnectionId_externalId: { storeConnectionId: store.id, externalId: p.id } },
          create: {
            storeConnectionId: store.id,
            externalId: p.id,
            title: p.title,
            sku: v?.sku || null,
            price: parseFloat(v?.price || '0'),
            compareAtPrice: v?.compareAtPrice ? parseFloat(v.compareAtPrice) : null,
            inventory: v?.inventoryQuantity || 0,
            vendor: p.vendor || null,
            productType: p.productType || null,
            tags: p.tags || [],
            imageUrl: p.featuredImage?.url || null,
            handle: p.handle || null,
            status: p.status || 'active',
          },
          update: {
            title: p.title,
            sku: v?.sku || null,
            price: parseFloat(v?.price || '0'),
            compareAtPrice: v?.compareAtPrice ? parseFloat(v.compareAtPrice) : null,
            inventory: v?.inventoryQuantity || 0,
            vendor: p.vendor || null,
            productType: p.productType || null,
            tags: p.tags || [],
            imageUrl: p.featuredImage?.url || null,
            handle: p.handle || null,
            status: p.status || 'active',
          },
        });
        prodCount++;
      } catch (err) {
        console.error(`[${store.name}] product upsert failed ${p.id}: ${err.message}`);
      }
    }
    prodCursor = data.products.pageInfo.hasNextPage ? data.products.edges.at(-1).cursor : null;
    if (prodCursor) await new Promise((r) => setTimeout(r, 500));
  } while (prodCursor);

  await prisma.storeConnection.update({
    where: { id: store.id },
    data: { lastSyncAt: new Date(), syncStatus: 'COMPLETED' },
  });

  return { customers: custCount, orders: ordCount, products: prodCount };
}

async function main() {
  const ts = new Date().toISOString();
  console.log(`[cron-sync] ${ts} starting`);
  const force = process.argv.includes('--force');
  const storeIdArg = process.argv.find((a) => a.startsWith('--store='))?.split('=')[1];
  const stores = await prisma.storeConnection.findMany({
    where: storeIdArg ? { id: storeIdArg } : undefined,
  });
  const now = Date.now();
  for (const store of stores) {
    if (store.platform !== 'SHOPIFY') {
      console.log(`[${store.name}] skip (${store.platform})`);
      continue;
    }
    // Respect per-store interval unless forced or disabled (interval <= 0)
    const intervalMs = (store.syncIntervalMinutes ?? 60) * 60 * 1000;
    if (!force && intervalMs > 0 && store.lastSyncAt) {
      const sinceLast = now - new Date(store.lastSyncAt).getTime();
      if (sinceLast < intervalMs - 60 * 1000) {
        // -1min tolerance so cron at :15 still runs a store with 60min interval set at :16
        const remainingMin = Math.ceil((intervalMs - sinceLast) / 60000);
        console.log(`[${store.name}] skip (${remainingMin}min până la următorul sync, interval ${store.syncIntervalMinutes}m)`);
        continue;
      }
    }
    if (!force && (store.syncIntervalMinutes ?? 0) <= 0) {
      console.log(`[${store.name}] skip (sync automat dezactivat)`);
      continue;
    }
    try {
      const r = await syncShopifyIncremental(store);
      console.log(`[${store.name}] ${r.customers}c ${r.orders}o ${r.products}p`);
    } catch (e) {
      console.error(`[${store.name}] FAILED: ${e.message}`);
    }
  }
  console.log(`[cron-sync] done`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
