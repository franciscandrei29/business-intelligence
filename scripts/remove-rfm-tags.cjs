#!/usr/bin/env node
// remove-rfm-tags.cjs v3 — Ultra safe: 1 customer at a time, long waits on throttle
require('dotenv').config({ path: '/root/business-intelligence-kimono-nu-seo/.env' });
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

function decrypt(d) {
  const [i, t, c] = d.split(':').map(h => Buffer.from(h, 'hex'));
  const k = Buffer.from(process.env.APP_ENCRYPTION_KEY, 'hex');
  const dc = crypto.createDecipheriv('aes-256-gcm', k, i);
  dc.setAuthTag(t);
  return dc.update(c) + dc.final('utf8');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

const ALL_RFM_TAGS = [
  'RFM-Campioni', 'RFM-Fideli', 'RFM-Potential-Fidel', 'RFM-Clienti-Noi',
  'RFM-Promitatori', 'RFM-Necesita-Atentie', 'RFM-In-Pericol', 'RFM-Pierduti',
];

const fs = require(fs);
const LOCK_FILE = /tmp/rfm-tags-lock;

async function main() {
  // Check if sync is running - wait if so
  if (fs.existsSync(/tmp/shopify-sync-lock)) {
    console.log([remove-rfm-tags] Sync is running, waiting 60s...);
    await sleep(60000);
  }
  // Create lock
  fs.writeFileSync(LOCK_FILE, process.pid.toString());
  console.log('[remove-rfm-tags v3] Starting...');
  const store = await p.storeConnection.findFirst();
  if (!store || !store.shopifyAccessToken) { console.log('No store'); return; }
  const token = decrypt(store.shopifyAccessToken);

  let cursor = null;
  let done = 0;
  let pages = 0;

  do {
    const after = cursor ? `, after: "${cursor}"` : '';
    const searchQuery = ALL_RFM_TAGS.map(t => `tag:'${t}'`).join(' OR ');

    let result;
    try {
      const res = await fetch(`https://${store.domain}/admin/api/2025-04/graphql.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
        body: JSON.stringify({ query: `{ customers(first: 10, query: "${searchQuery}"${after}) { edges { cursor node { id tags } } pageInfo { hasNextPage } } }` }),
      });
      result = await res.json();
    } catch (e) {
      console.error('Fetch error:', e.message);
      await sleep(10000);
      continue;
    }

    if (result.errors) {
      if (result.errors.some(e => e.extensions?.code === 'THROTTLED')) {
        // Wait full 30s for rate limit to restore
        console.log(`  Throttled at ${done}, waiting 30s for restore...`);
        await sleep(30000);
        continue; // retry same page
      }
      console.error('API error:', JSON.stringify(result.errors).slice(0, 200));
      break;
    }

    const edges = result.data?.customers?.edges || [];
    const hasNext = result.data?.customers?.pageInfo?.hasNextPage;

    if (edges.length === 0) break;

    // Remove tags one by one
    for (const edge of edges) {
      const rfmTags = edge.node.tags.filter(t => t.startsWith('RFM-'));
      if (rfmTags.length === 0) continue;

      let success = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const rmRes = await fetch(`https://${store.domain}/admin/api/2025-04/graphql.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
            body: JSON.stringify({ query: `mutation { tagsRemove(id: "${edge.node.id}", tags: ${JSON.stringify(rfmTags)}) { userErrors { message } } }` }),
          });
          const rmJ = await rmRes.json();
          if (rmJ.errors?.some(e => e.extensions?.code === 'THROTTLED')) {
            console.log(`  Throttled on remove, waiting 30s...`);
            await sleep(30000);
            continue;
          }
          success = true;
          done++;
          break;
        } catch {
          await sleep(5000);
        }
      }

      await sleep(3000);
    }

    cursor = hasNext ? edges[edges.length - 1]?.cursor : null;
    pages++;

    if (pages % 10 === 0) {
      console.log(`  Pages: ${pages}, removed: ${done}`);
    }

    // Check if sync started, pause if so
    await waitForSync();
    await sleep(3000);
  } while (cursor);

  console.log(`[remove-rfm-tags v3] DONE: ${done} tags removed in ${pages} pages`);
  await p.$disconnect();
}

main().catch(e => { console.error(e); }).finally(() => { try { fs.unlinkSync(LOCK_FILE); } catch {} p.$disconnect(); });
