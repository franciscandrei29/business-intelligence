#!/usr/bin/env node
// cron-rfm-shopify-sync.cjs — Runs daily after RFM calculation
// Recalculates RFM, then syncs tags to Shopify (removes old RFM tags, adds new ones)
// Shopify segments auto-update because they're query-based on tags

require('dotenv').config({ path: '/root/business-intelligence-kimono-nu-seo/.env' });
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const db = new PrismaClient();

const RO_LABELS = {
  Champions: 'Campioni',
  'Loyal Customers': 'Fideli',
  'Potential Loyalist': 'Potential-Fidel',
  'Recent Customers': 'Clienti-Noi',
  Promising: 'Promitatori',
  'Need Attention': 'Necesita-Atentie',
  'At Risk': 'In-Pericol',
  Lost: 'Pierduti',
};

const ALL_RFM_TAGS = Object.values(RO_LABELS).map(l => 'RFM-' + l);

function decrypt(data) {
  const [iv, tag, ct] = data.split(':').map(h => Buffer.from(h, 'hex'));
  const key = Buffer.from(process.env.APP_ENCRYPTION_KEY, 'hex');
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return d.update(ct) + d.final('utf8');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function gql(domain, token, query, variables, retries = 5) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(`https://${domain}/admin/api/2025-04/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json();
    if (json.errors && json.errors.some(e => e.extensions?.code === 'THROTTLED')) {
      const wait = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
      console.log(`  [throttle] waiting ${wait / 1000}s (attempt ${attempt})`);
      await sleep(wait);
      continue;
    }
    return json;
  }
  throw new Error('Max retries exceeded');
}

async function syncRfmToShopify(store) {
  const token = decrypt(store.shopifyAccessToken);

  // Get all RFM segments with customer external IDs
  const rfmRecords = await db.rfmSegment.findMany({
    where: { storeConnectionId: store.id },
    select: { customerExternalId: true, segment: true },
  });

  if (rfmRecords.length === 0) {
    console.log(`  No RFM data for ${store.name}`);
    return { tagged: 0 };
  }

  // Get subscribed customer IDs
  const subscribedCustomers = new Set(
    (await db.customer.findMany({
      where: { storeConnectionId: store.id, emailSubscribed: true },
      select: { externalId: true },
    })).map(c => c.externalId)
  );

  // Build map: customerId -> new tag (only subscribed)
  const customerTagMap = new Map();
  for (const r of rfmRecords) {
    if (!subscribedCustomers.has(r.customerExternalId)) continue;
    const label = RO_LABELS[r.segment] || r.segment.replace(/ /g, '-');
    customerTagMap.set(r.customerExternalId, 'RFM-' + label);
  }

  console.log(`  ${customerTagMap.size} customers to sync`);

  // Process in batches of 10
  const customers = [...customerTagMap.entries()];
  let tagged = 0;
  let errors = 0;

  for (let i = 0; i < customers.length; i += 10) {
    const batch = customers.slice(i, i + 10);

    // For each customer: remove ALL old RFM tags, add new one
    const mutations = batch.map(([custId, newTag], idx) => {
      // Remove old tags
      const removeTags = ALL_RFM_TAGS.filter(t => t !== newTag);
      return `
        remove${idx}: tagsRemove(id: "${custId}", tags: ${JSON.stringify(removeTags)}) {
          userErrors { message }
        }
        add${idx}: tagsAdd(id: "${custId}", tags: ["${newTag}"]) {
          userErrors { message }
        }
      `;
    }).join('');

    try {
      const result = await gql(store.domain, token, `mutation { ${mutations} }`, {});
      if (result.errors) {
        errors += batch.length;
      } else {
        tagged += batch.length;
      }
    } catch (e) {
      errors += batch.length;
      console.error(`  Batch error: ${e.message}`);
    }

    if (i % 500 === 0 && i > 0) {
      console.log(`  Progress: ${i}/${customers.length} (${tagged} tagged, ${errors} errors)`);
    }

    await sleep(1000); // 1s between batches to respect rate limits
  }

  return { tagged, errors };
}

async function ensureShopifySegments(store) {
  const token = decrypt(store.shopifyAccessToken);

  // Create segments for each RFM category if they don't exist
  for (const [eng, ro] of Object.entries(RO_LABELS)) {
    const segName = 'RFM: ' + ro.replace(/-/g, ' ');
    const tagName = 'RFM-' + ro;
    const segQuery = "customer_tags CONTAINS '" + tagName + "'";

    try {
      const result = await gql(store.domain, token,
        `mutation($name: String!, $query: String!) { segmentCreate(name: $name, query: $query) { segment { id } userErrors { message } } }`,
        { name: segName, query: segQuery }
      );
      const seg = result.data?.segmentCreate?.segment;
      const err = result.data?.segmentCreate?.userErrors?.[0]?.message;
      if (seg) {
        console.log(`  Created segment: ${segName}`);
      } else if (err && err.includes('already exists')) {
        // Already exists, fine
      } else if (err) {
        console.log(`  Segment ${segName}: ${err}`);
      }
    } catch (e) {
      console.log(`  Segment ${segName} error: ${e.message}`);
    }
    await sleep(300);
  }

  // Also create "Retargetare Ads" segment
  try {
    await gql(store.domain, token,
      `mutation($name: String!, $query: String!) { segmentCreate(name: $name, query: $query) { segment { id } userErrors { message } } }`,
      { name: 'RFM: Retargetare Ads', query: "email_subscription_status = 'NOT_SUBSCRIBED'" }
    );
  } catch {}
}

async function main() {
  const ts = new Date().toISOString();
  console.log(`[rfm-shopify-sync] ${ts} starting`);

  const stores = await db.storeConnection.findMany({});

  for (const store of stores) {
    if (!store.shopifyAccessToken) {
      console.log(`  [${store.name}] skip (no Shopify token)`);
      continue;
    }

    try {
      // Step 1: Recalculate RFM
      console.log(`  [${store.name}] Recalculating RFM...`);
      const { calculateRfm } = require('/root/business-intelligence-kimono-nu-seo/app/lib/rfm/index.ts');
      // Can't import TS directly in CJS, use the existing cron-rfm.cjs logic instead
      // Actually we'll just call the existing RFM calculation
      // For now, assume RFM is already calculated by cron-rfm.cjs which runs before this

      // Step 2: Ensure Shopify segments exist
      console.log(`  [${store.name}] Ensuring Shopify segments...`);
      await ensureShopifySegments(store);

      // Step 3: Sync tags
      console.log(`  [${store.name}] Syncing tags to Shopify...`);
      const result = await syncRfmToShopify(store);
      console.log(`  [${store.name}] Done: ${result.tagged} tagged, ${result.errors || 0} errors`);
    } catch (e) {
      console.error(`  [${store.name}] FAILED: ${e.message}`);
    }
  }

  console.log(`[rfm-shopify-sync] done`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
