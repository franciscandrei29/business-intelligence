/**
 * backfill-shipping-costs.mjs
 * Calculates real SameDay shipping cost for each AWB using:
 *   1. Shopify order → shipping address (city, province, country)
 *   2. SameDay geolocation API → county ID + city ID
 *   3. SameDay estimate-cost API → real negotiated cost
 * Saves result to CourierTracking.servicePayment
 *
 * Usage: node scripts/backfill-shipping-costs.mjs [--dry-run] [--limit=50]
 */
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import 'dotenv/config';

const prisma = new PrismaClient();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = (() => { const m = process.argv.find(a => a.startsWith('--limit=')); return m ? parseInt(m.split('=')[1]) : 9999; })();

const SAMEDAY_API = process.env.SAMEDAY_API_URL || 'https://api.sameday.ro';
const SAMEDAY_USER = process.env.SAMEDAY_USERNAME;
const SAMEDAY_PASS = process.env.SAMEDAY_PASSWORD;
const API_VERSION = '2025-10';

function decrypt(data) {
  const [iv, tag, ct] = data.split(':').map(h => Buffer.from(h, 'hex'));
  const key = Buffer.from(process.env.APP_ENCRYPTION_KEY, 'hex');
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return d.update(ct) + d.final('utf8');
}

// ── SameDay Auth ────────────────────────────────────────────────────────
let sdToken = null;

async function samedayAuth() {
  if (sdToken) return sdToken;
  const res = await fetch(`${SAMEDAY_API}/api/authenticate?remember_me=1`, {
    method: 'POST',
    headers: { 'X-AUTH-USERNAME': SAMEDAY_USER, 'X-AUTH-PASSWORD': SAMEDAY_PASS },
  });
  if (!res.ok) throw new Error(`SameDay auth failed: ${res.status}`);
  const data = await res.json();
  sdToken = data.token;
  return sdToken;
}

// ── SameDay Geolocation cache ───────────────────────────────────────────
const countyCache = new Map();    // name(lower) → { id, name }
const cityCache = new Map();      // "countyId:cityName(lower)" → { id, name }

function removeDiacritics(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

async function loadCounties() {
  const token = await samedayAuth();
  const res = await fetch(`${SAMEDAY_API}/api/geolocation/county?countPerPage=100`, {
    headers: { 'X-AUTH-TOKEN': token },
  });
  const data = await res.json();
  for (const c of data.data) {
    const entry = { id: c.id, name: c.name };
    countyCache.set(c.name.toLowerCase(), entry);
    countyCache.set(removeDiacritics(c.name).toLowerCase(), entry);
    if (c.latinName) countyCache.set(c.latinName.toLowerCase(), entry);
  }
  // Add common aliases (Shopify uses diacritics, SameDay doesn't)
  countyCache.set('bucharest', { id: 1, name: 'Bucuresti' });
  countyCache.set('bucurești', { id: 1, name: 'Bucuresti' });
  countyCache.set('ilfov county', { id: 26, name: 'Ilfov' });
  countyCache.set('caras-severin', { id: 13, name: 'Caras-Severin' });
  countyCache.set('caraș-severin', { id: 13, name: 'Caras-Severin' });
  countyCache.set('bistrita-nasaud', { id: 7, name: 'Bistrita-Nasaud' });
  countyCache.set('bistrița-năsăud', { id: 7, name: 'Bistrita-Nasaud' });
  console.log(`[geo] ${countyCache.size} county entries cached`);
}

function normalizeCityName(name) {
  let n = name.trim();

  // Convert ALL UPPERCASE to Title Case: "GLAMBOCATA DEAL" → "Glambocata Deal"
  if (n === n.toUpperCase() && n.length > 2) {
    n = n.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }

  // Strip parenthetical notes: "Schineni (Sascut)" → "Schineni"
  n = n.replace(/\s*\(.*?\)\s*/g, '').trim();

  // Strip ", County" suffix: "Craiova, Dolj" → "Craiova"
  if (n.includes(',')) {
    n = n.split(',')[0].trim();
  }

  // "Com X sat/Sat Y" pattern → extract X: "Com Tg Trotuș sat Tuta" → "Tg Trotuș"
  // "Com Girov Sat Căciulești" → "Girov"
  const comSatMatch = n.match(/^Com\.?\s+(.+?)\s+[Ss]at\.?\s+/i);
  if (comSatMatch) {
    n = comSatMatch[1].trim();
  } else {
    // "Santioana De Mures Com. Panet" → extract before "Com."
    const beforeComMatch = n.match(/^(.+?)\s+Com\.?\s+/i);
    if (beforeComMatch && !n.match(/^Com/i)) {
      n = beforeComMatch[1].trim();
    }

    // "Com. Corbeni. Sat Bucsenesti." → extract first locality after Com prefix
    // "Com.Costeiu" → "Costeiu"
    // "Comuna Fundata" → "Fundata"
    n = n.replace(/^Com(?:una)?\.?\s*/i, '').trim();

    // If after stripping Com, there's ". Sat Xyz" or "Sat Xyz" → strip it
    n = n.replace(/\.?\s+[Ss]at\.?\s+.*$/i, '').trim();
    // Clean trailing dots
    n = n.replace(/\.+$/, '').trim();
  }

  // Strip "Sat " prefix: "Sat Malu Spart" → "Malu Spart"
  n = n.replace(/^Sat\.?\s+/i, '').trim();

  // Strip address fragments: "Danesti 213. Str principala" → "Danesti"
  n = n.replace(/\s+\d+\.?\s+.*$/i, '').trim();
  n = n.replace(/\s+(str|nr|bl|sc|ap|et)[\.\s].*/i, '').trim();

  // Replace dashes between words with spaces: "Targu-jiu" → "Targu jiu", "Piatra-Neamt" → "Piatra Neamt"
  n = n.replace(/-/g, ' ').trim();
  // Collapse multiple spaces
  n = n.replace(/\s{2,}/g, ' ');

  // Common Romanian abbreviations
  n = n.replace(/^Tg[\.\-]?\s*/i, 'Targu ');
  n = n.replace(/^Tîrgu\s+/i, 'Targu ');
  n = n.replace(/^Târgu\s+/i, 'Targu ');
  n = n.replace(/^Sf\.?\s+/i, 'Sfantu ');
  n = n.replace(/^Rm\.?\s+/i, 'Ramnicu ');
  n = n.replace(/^Dr\.?\s+Tr\.?\s+/i, 'Drobeta Turnu ');
  n = n.replace(/^Drobeta Turnu\s+/i, 'Drobeta Turnu ');
  // Sector handling for Bucuresti
  n = n.replace(/^Sector\s+\d$/i, 'Bucuresti');
  n = n.replace(/^Sectorul\s+\d$/i, 'Bucuresti');
  n = n.replace(/^București$/i, 'Bucuresti');

  // Remove diacritics as final normalization
  n = removeDiacritics(n);

  return n;
}

async function searchSamedayCity(countyId, searchName) {
  const token = await samedayAuth();
  const encoded = encodeURIComponent(searchName);
  const res = await fetch(`${SAMEDAY_API}/api/geolocation/city?county=${countyId}&name=${encoded}&countPerPage=10`, {
    headers: { 'X-AUTH-TOKEN': token },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.data || [];
}

// Common misspelling map: wrong → correct
const CITY_MISSPELLINGS = {
  'reaita': 'Resita',
  'casino nou': 'Casinu Nou',
  'casino': 'Casinu',
};

function generateCityVariants(cityName) {
  const variants = new Set();
  const trimmed = cityName.trim();
  const normalized = normalizeCityName(cityName);
  const noDiacritics = removeDiacritics(trimmed);
  const normalizedNoDiacritics = removeDiacritics(normalized);

  variants.add(trimmed);
  variants.add(normalized);
  variants.add(noDiacritics);
  variants.add(normalizedNoDiacritics);

  // Try with dash between words: "Cluj Napoca" → "Cluj-Napoca", "Popesti Leordeni" → "Popesti-Leordeni"
  // Apply to both normalized and noDiacritics versions
  for (const v of [normalizedNoDiacritics, normalized]) {
    const words = v.split(' ');
    if (words.length === 2) {
      variants.add(`${words[0]}-${words[1]}`);
    }
    if (words.length === 3) {
      // "Drobeta Turnu Severin" → "Drobeta-Turnu Severin"
      variants.add(`${words[0]}-${words[1]} ${words[2]}`);
      variants.add(`${words[0]} ${words[1]}-${words[2]}`);
    }
  }

  // Try adding -i suffix for common Romanian plural pattern:
  // "Filipesti De Padure" → "Filipestii De Padure"
  // Only add to first word if it ends in a consonant + i pattern
  const firstWord = normalizedNoDiacritics.split(' ')[0];
  const rest = normalizedNoDiacritics.split(' ').slice(1).join(' ');
  if (firstWord.endsWith('i') || firstWord.endsWith('esti') || firstWord.endsWith('eni') || firstWord.endsWith('ani')) {
    const withExtraI = firstWord + 'i' + (rest ? ' ' + rest : '');
    variants.add(withExtraI);
  }

  // Try just the first word: "Valea Lunga Cricov" → "Valea Lunga"
  if (normalizedNoDiacritics.split(' ').length >= 3) {
    const first2 = normalizedNoDiacritics.split(' ').slice(0, 2).join(' ');
    variants.add(first2);
    // Also with dash
    const parts2 = normalizedNoDiacritics.split(' ');
    variants.add(`${parts2[0]}-${parts2[1]}`);
  }

  // Check misspelling map
  const lower = normalizedNoDiacritics.toLowerCase();
  if (CITY_MISSPELLINGS[lower]) {
    variants.add(CITY_MISSPELLINGS[lower]);
  }
  // Also check first word only for partial misspellings
  const firstWordLower = firstWord.toLowerCase();
  if (CITY_MISSPELLINGS[firstWordLower]) {
    const corrected = CITY_MISSPELLINGS[firstWordLower] + (rest ? ' ' + rest : '');
    variants.add(corrected);
  }

  return variants;
}

async function findSamedayCity(countyId, cityName) {
  const key = `${countyId}:${cityName.toLowerCase().trim()}`;
  if (cityCache.has(key)) return cityCache.get(key);

  const variants = generateCityVariants(cityName);

  for (const variant of variants) {
    if (!variant || variant.length < 2) continue;
    const results = await searchSamedayCity(countyId, variant);
    if (results.length > 0) {
      // Exact match first (compare without diacritics)
      const lv = removeDiacritics(variant).toLowerCase();
      const exact = results.find(c =>
        c.name.toLowerCase() === lv
        || removeDiacritics(c.name).toLowerCase() === lv
      );
      const city = exact || results[0];
      const result = { id: city.id, name: city.name };
      cityCache.set(key, result);
      return result;
    }
    await sleep(300);
  }

  // Special fallback: Bucuresti → search "Sectorul 1" (any sector works for cost estimate)
  if (countyId === 1) {
    const bucResults = await searchSamedayCity(1, 'Sectorul 1');
    if (bucResults.length > 0) {
      const result = { id: bucResults[0].id, name: bucResults[0].name };
      cityCache.set(key, result);
      return result;
    }
  }

  cityCache.set(key, null);
  return null;
}

function mapProvinceToCounty(province) {
  if (!province) return null;
  const lower = province.toLowerCase().trim();
  // Try exact, then without diacritics
  return countyCache.get(lower)
    || countyCache.get(removeDiacritics(lower))
    || null;
}

// ── SameDay Estimate Cost ───────────────────────────────────────────────
async function estimateCost(countyId, cityId, weight, codAmount) {
  const token = await samedayAuth();
  const body = new URLSearchParams();
  body.set('pickupPoint', '375082');      // Global Distribution Center
  body.set('contactPerson', '543266');
  body.set('packageType', '0');            // parcel
  body.set('packageNumber', '1');
  body.set('packageWeight', String(Math.max(weight, 0.5)));
  body.set('service', '7');               // 24H domestic
  body.set('awbPayment', '1');             // sender pays
  body.set('cashOnDelivery', String(codAmount || 0));
  body.set('cashOnDeliveryReturns', '0');
  body.set('insuredValue', '0');
  body.set('thirdPartyPickup', '0');
  body.set('awbRecipient[county]', String(countyId));
  body.set('awbRecipient[city]', String(cityId));
  body.set('parcels[0][weight]', String(Math.max(weight, 0.5)));

  const res = await fetch(`${SAMEDAY_API}/api/awb/estimate-cost`, {
    method: 'POST',
    headers: { 'X-AUTH-TOKEN': token, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`estimate-cost ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.amount;  // number in RON
}

// ── Shopify helper ──────────────────────────────────────────────────────
async function shopifyGql(domain, token, query) {
  const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Shopify ${res.status}`);
  const data = await res.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors).slice(0, 200));
  return data.data;
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[backfill-costs] ${new Date().toISOString()} starting ${DRY_RUN ? '(DRY RUN)' : ''} limit=${LIMIT}`);

  await loadCounties();

  // Get stores with Shopify tokens
  const stores = await prisma.storeConnection.findMany({
    where: { platform: 'SHOPIFY', isActive: true, shopifyAccessToken: { not: null } },
    select: { id: true, name: true, domain: true, shopifyAccessToken: true },
  });

  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (const store of stores) {
    const shopifyToken = decrypt(store.shopifyAccessToken);
    console.log(`\n[${store.name}] Processing...`);

    // Get AWBs that need cost calculation
    const awbs = await prisma.courierTracking.findMany({
      where: {
        storeConnectionId: store.id,
        servicePayment: null,
        orderExternalId: { not: null },
        OR: [{ isDelivered: true }, { isReturned: true }],
      },
      select: {
        id: true, awb: true, orderExternalId: true, orderNumber: true,
        codAmount: true, isCod: true, currency: true,
      },
      take: LIMIT,
      orderBy: { courierUpdatedAt: 'desc' },
    });

    console.log(`  ${awbs.length} AWBs need cost calculation`);
    if (awbs.length === 0) continue;

    // Batch fetch Shopify orders (10 at a time to avoid throttle)
    const BATCH = 10;
    for (let i = 0; i < awbs.length; i += BATCH) {
      const batch = awbs.slice(i, i + BATCH);

      for (const ct of batch) {
        try {
          // Fetch shipping address from Shopify
          const data = await shopifyGql(store.domain, shopifyToken, `{
            order(id: "${ct.orderExternalId}") {
              shippingAddress {
                city
                province
                countryCodeV2
              }
              totalWeight
            }
          }`);

          const addr = data.order?.shippingAddress;
          if (!addr || !addr.city || !addr.province) {
            console.log(`  ${ct.orderNumber} (${ct.awb}): no shipping address — skipped`);
            totalSkipped++;
            continue;
          }

          // Skip crossborder — SameDay estimate-cost only supports Romania
          if (addr.countryCodeV2 !== 'RO') {
            console.log(`  ${ct.orderNumber}: crossborder ${addr.countryCodeV2} — skipped`);
            totalSkipped++;
            continue;
          }

          const weight = (data.order.totalWeight || 0) / 1000; // grams → kg

          // Map province → SameDay county
          const county = mapProvinceToCounty(addr.province);
          if (!county) {
            console.log(`  ${ct.orderNumber}: county not found for province "${addr.province}" — skipped`);
            totalSkipped++;
            continue;
          }

          // Map city → SameDay city
          const city = await findSamedayCity(county.id, addr.city);
          if (!city) {
            console.log(`  ${ct.orderNumber}: city not found "${addr.city}" in ${county.name} — skipped`);
            totalSkipped++;
            continue;
          }

          // Estimate cost
          const cost = await estimateCost(
            county.id,
            city.id,
            Math.max(weight, 1),  // min 1kg
            ct.isCod ? (ct.codAmount || 0) : 0,
          );

          if (DRY_RUN) {
            console.log(`  ${ct.orderNumber} → ${addr.city}, ${county.name} (${addr.countryCodeV2}) = ${cost} RON [DRY RUN]`);
          } else {
            await prisma.courierTracking.update({
              where: { id: ct.id },
              data: { servicePayment: cost },
            });
            console.log(`  ${ct.orderNumber} → ${addr.city}, ${county.name} = ${cost} RON ✓`);
          }
          totalUpdated++;

          await sleep(800); // respect API rate limits
        } catch (err) {
          console.error(`  ${ct.orderNumber} (${ct.awb}): ERROR ${err.message}`);
          totalFailed++;
          await sleep(1000);
        }
      }

      // Pause between batches
      if (i + BATCH < awbs.length) {
        console.log(`  ... batch ${Math.floor(i/BATCH)+1} done, pausing ...`);
        await sleep(2000);
      }
    }
  }

  console.log(`\n[backfill-costs] Done: ${totalUpdated} updated, ${totalSkipped} skipped, ${totalFailed} failed`);
}

main()
  .catch(e => { console.error('[backfill-costs]', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
