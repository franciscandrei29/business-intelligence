#!/usr/bin/env node
/**
 * Weekly full product reconciliation.
 * Runs Sunday night — syncs ALL products (no since filter) for all stores.
 * Catches products added/modified that incremental sync missed.
 */
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const prisma = new PrismaClient();
const APP_ENCRYPTION_KEY = process.env.APP_ENCRYPTION_KEY;

function decrypt(data) {
  const [ivHex, tagHex, cipherHex] = data.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(APP_ENCRYPTION_KEY, "hex"), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return decipher.update(cipherHex, "hex", "utf8") + decipher.final("utf8");
}

async function fullProductSync(store) {
  const isWoo = store.platform === "WOOCOMMERCE";
  const isShopify = store.platform === "SHOPIFY";
  let prodCount = 0;

  if (isWoo && store.wooConsumerKey) {
    const apiKey = decrypt(store.wooConsumerKey);
    const isPlugin = decrypt(store.wooConsumerSecret) === "kimono-bi-plugin";
    const baseUrl = (store.wooApiUrl || `https://${store.domain}`).replace(/\/$/, "");
    const apiBase = isPlugin ? `${baseUrl}/wp-json/kimono-bi/v1` : `${baseUrl}/wp-json/wc/v3`;
    const headers = isPlugin
      ? { "X-Kimono-BI-Key": apiKey, "Content-Type": "application/json" }
      : { Authorization: "Basic " + Buffer.from(`${apiKey}:${decrypt(store.wooConsumerSecret)}`).toString("base64"), "Content-Type": "application/json" };

    let page = 1;
    while (true) {
      const res = await fetch(`${apiBase}/products?page=${page}&per_page=100`, { headers });
      if (!res.ok) break;
      const data = await res.json();
      const products = data.data || data;
      if (!Array.isArray(products) || products.length === 0) break;

      for (const p of products) {
        const exId = String(p.id);
        const statusVal = (p.status === "ACTIVE" || p.status === "publish") ? "ACTIVE" : "DRAFT";
        await prisma.product.upsert({
          where: { storeConnectionId_externalId: { storeConnectionId: store.id, externalId: exId } },
          create: {
            storeConnectionId: store.id, externalId: exId, title: p.title || p.name || "",
            sku: p.sku || null, price: p.price || 0,
            costPerUnit: p.cost_per_unit ? parseFloat(p.cost_per_unit) : null,
            inventory: p.inventory ?? p.stock_quantity ?? 0,
            vendor: p.vendor || null, productType: p.product_type || null,
            tags: p.tags || [], imageUrl: p.image_url || null, handle: p.handle || null,
            status: statusVal,
          },
          update: {
            title: p.title || p.name || undefined, price: p.price || undefined,
            costPerUnit: p.cost_per_unit ? parseFloat(p.cost_per_unit) : undefined,
            inventory: p.inventory ?? p.stock_quantity ?? undefined, status: statusVal,
          },
        });
        prodCount++;
      }
      const totalPages = data.total_pages || 1;
      if (page >= totalPages) break;
      page++;
    }
  }

  if (isShopify && store.shopifyAccessToken) {
    const token = decrypt(store.shopifyAccessToken);
    const shop = store.domain;
    const API_VERSION = "2024-10";
    let cursor = null;

    while (true) {
      const after = cursor ? `, after: "${cursor}"` : "";
      const query = `{ products(first: 50, sortKey: UPDATED_AT, reverse: true${after}) {
        edges { cursor node {
          id title handle status vendor productType tags
          featuredMedia { preview { image { url } } }
          variants(first: 1) { edges { node { price compareAtPrice sku inventoryQuantity inventoryItem { unitCost { amount } } } } }
        }}
        pageInfo { hasNextPage }
      }}`;

      const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
        body: JSON.stringify({ query }),
      });
      if (!res.ok) break;
      const json = await res.json();
      const data = json.data;
      if (!data?.products?.edges?.length) break;

      for (const e of data.products.edges) {
        const p = e.node;
        const v = p.variants?.edges?.[0]?.node;
        const unitCost = v?.inventoryItem?.unitCost?.amount ? parseFloat(v.inventoryItem.unitCost.amount) : null;
        await prisma.product.upsert({
          where: { storeConnectionId_externalId: { storeConnectionId: store.id, externalId: p.id } },
          create: {
            storeConnectionId: store.id, externalId: p.id, title: p.title || "",
            sku: v?.sku || null, price: parseFloat(v?.price || "0"),
            compareAtPrice: v?.compareAtPrice ? parseFloat(v.compareAtPrice) : null,
            costPerUnit: unitCost, inventory: v?.inventoryQuantity || 0,
            vendor: p.vendor || null, productType: p.productType || null,
            tags: p.tags || [], imageUrl: p.featuredMedia?.preview?.image?.url || null,
            handle: p.handle || null, status: p.status === "ACTIVE" ? "ACTIVE" : "DRAFT",
          },
          update: {
            title: p.title || undefined, price: parseFloat(v?.price || "0"),
            costPerUnit: unitCost, inventory: v?.inventoryQuantity || 0,
            status: p.status === "ACTIVE" ? "ACTIVE" : "DRAFT",
          },
        });
        prodCount++;
      }
      cursor = data.products.pageInfo.hasNextPage ? data.products.edges.at(-1).cursor : null;
      if (!cursor) break;
    }
  }

  return prodCount;
}

async function main() {
  console.log(`[full-product-sync] ${new Date().toISOString()} starting`);
  const stores = await prisma.storeConnection.findMany({ where: { isActive: true } });

  for (const store of stores) {
    if (store.platform !== "SHOPIFY" && store.platform !== "WOOCOMMERCE") {
      console.log(`[${store.name}] skip (${store.platform})`);
      continue;
    }
    try {
      const count = await fullProductSync(store);
      console.log(`[${store.name}] ${count} products synced`);
    } catch (err) {
      console.error(`[${store.name}] error:`, err.message);
    }
  }

  console.log(`[full-product-sync] done`);
  await prisma.$disconnect();
}

main();
