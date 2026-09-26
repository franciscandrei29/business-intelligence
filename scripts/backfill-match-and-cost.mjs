/**
 * backfill-match-and-cost.mjs
 * 1. Match unmatched AWBs to Shopify orders (by AWB search)
 * 2. Calculate shipping cost for all AWBs without servicePayment
 *    - With order: use Shopify shipping address for precise city
 *    - Without order: use SameDay county + county capital
 *
 * Usage: node scripts/backfill-match-and-cost.mjs [--dry-run] [--limit=500]
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

function removeDiacritics(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// ── SameDay ─────────────────────────────────────────────────────────────
let sdToken = null;
async function samedayAuth() {
  if (sdToken) return sdToken;
  const res = await fetch(`${SAMEDAY_API}/api/authenticate?remember_me=1`, {
    method: 'POST',
    headers: { 'X-AUTH-USERNAME': SAMEDAY_USER, 'X-AUTH-PASSWORD': SAMEDAY_PASS },
  });
  if (!res.ok) throw new Error(`SameDay auth failed: ${res.status}`);
  sdToken = (await res.json()).token;
  return sdToken;
}

async function samedayGet(path, retries = 3) {
  const token = await samedayAuth();
  for (let i = 1; i <= retries; i++) {
    const res = await fetch(`${SAMEDAY_API}${path}`, { headers: { 'X-AUTH-TOKEN': token } });
    if (res.status === 429) { await sleep(3000 * i); continue; }
    if (!res.ok) throw new Error(`SameDay ${res.status}: ${path}`);
    return res.json();
  }
  throw new Error(`SameDay max retries: ${path}`);
}

// ── Shopify ─────────────────────────────────────────────────────────────
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

// ── Geolocation cache ───────────────────────────────────────────────────
const countyCache = new Map();
const cityCache = new Map();
const capitalCache = new Map();

function normalizeCityName(name) {
  let n = name.trim();
  if (n === n.toUpperCase() && n.length > 2) n = n.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  n = n.replace(/\s*\(.*?\)\s*/g, '').trim();
  if (n.includes(',')) n = n.split(',')[0].trim();
  const comSatMatch = n.match(/^Com\.?\s+(.+?)\s+[Ss]at\.?\s+/i);
  if (comSatMatch) { n = comSatMatch[1].trim(); }
  else {
    const beforeComMatch = n.match(/^(.+?)\s+Com\.?\s+/i);
    if (beforeComMatch && !n.match(/^Com/i)) n = beforeComMatch[1].trim();
    n = n.replace(/^Com(?:una)?\.?\s*/i, '').trim();
    n = n.replace(/\.?\s+[Ss]at\.?\s+.*$/i, '').trim();
    n = n.replace(/\.+$/, '').trim();
  }
  n = n.replace(/^Sat\.?\s+/i, '').trim();
  n = n.replace(/\s+\d+\.?\s+.*$/i, '').trim();
  n = n.replace(/\s+(str|nr|bl|sc|ap|et)[\.\s].*/i, '').trim();
  n = n.replace(/-/g, ' ').trim().replace(/\s{2,}/g, ' ');
  n = n.replace(/^Tg[\.\-]?\s*/i, 'Targu ');
  n = n.replace(/^Tîrgu\s+/i, 'Targu ');
  n = n.replace(/^Târgu\s+/i, 'Targu ');
  n = n.replace(/^Sf\.?\s+/i, 'Sfantu ');
  n = n.replace(/^Rm\.?\s+/i, 'Ramnicu ');
  n = n.replace(/^Sector\s+\d$/i, 'Bucuresti');
  n = n.replace(/^Sectorul\s+\d$/i, 'Bucuresti');
  n = n.replace(/^București$/i, 'Bucuresti');
  return removeDiacritics(n);
}

async function loadCounties() {
  const data = await samedayGet('/api/geolocation/county?countPerPage=100');
  for (const c of data.data) {
    const entry = { id: c.id, name: c.name };
    countyCache.set(c.name.toLowerCase(), entry);
    countyCache.set(removeDiacritics(c.name).toLowerCase(), entry);
    if (c.latinName) countyCache.set(c.latinName.toLowerCase(), entry);
  }
  countyCache.set('bucharest', { id: 1, name: 'Bucuresti' });
  countyCache.set('bucurești', { id: 1, name: 'Bucuresti' });
  console.log(`[geo] ${countyCache.size} county entries cached`);
}

function mapCountyName(name) {
  if (!name) return null;
  const lower = removeDiacritics(name).toLowerCase().trim();
  return countyCache.get(lower) || countyCache.get(name.toLowerCase().trim()) || null;
}

async function searchCity(countyId, cityName) {
  const token = await samedayAuth();
  const res = await fetch(`${SAMEDAY_API}/api/geolocation/city?county=${countyId}&name=${encodeURIComponent(cityName)}&countPerPage=10`, {
    headers: { 'X-AUTH-TOKEN': token },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.data || [];
}

async function findCity(countyId, cityName) {
  const key = `${countyId}:${cityName.toLowerCase()}`;
  if (cityCache.has(key)) return cityCache.get(key);

  const variants = [cityName, normalizeCityName(cityName), removeDiacritics(cityName)];
  const unique = [...new Set(variants)].filter(v => v.length >= 2);

  for (const v of unique) {
    const results = await searchCity(countyId, v);
    if (results.length > 0) {
      const lv = removeDiacritics(v).toLowerCase();
      const exact = results.find(c => removeDiacritics(c.name).toLowerCase() === lv);
      const city = exact || results[0];
      cityCache.set(key, city.id);
      return city.id;
    }
    await sleep(300);
  }

  // Also try dash-joined: "Cluj Napoca" → "Cluj-Napoca"
  const nWords = normalizeCityName(cityName).split(' ');
  if (nWords.length === 2) {
    const dashed = `${nWords[0]}-${nWords[1]}`;
    const results = await searchCity(countyId, dashed);
    if (results.length > 0) { cityCache.set(key, results[0].id); return results[0].id; }
  }

  // Bucuresti fallback
  if (countyId === 1) {
    const results = await searchCity(1, 'Sectorul 1');
    if (results.length > 0) { cityCache.set(key, results[0].id); return results[0].id; }
  }

  cityCache.set(key, null);
  return null;
}

async function getCapitalCity(countyId, countyName) {
  if (capitalCache.has(countyId)) return capitalCache.get(countyId);
  const results = await searchCity(countyId, countyName);
  if (results.length > 0) { capitalCache.set(countyId, results[0].id); return results[0].id; }
  if (countyId === 1) {
    const buc = await searchCity(1, 'Sectorul 1');
    if (buc.length > 0) { capitalCache.set(1, buc[0].id); return buc[0].id; }
  }
  capitalCache.set(countyId, null);
  return null;
}

// Fuel surcharge correction: estimate-cost doesn't include full fuel surcharge
// Calibrated against real SameDay invoice: estimate * 1.02 ≈ invoice total
const FUEL_CORRECTION = 1.02;

async function getRealWeight(awb) {
  // Fetch parcel details for real catarit weight + dimensions
  try {
    const awbData = await samedayGet(`/api/client/awb/${awb}/status`);
    const parcelAwb = awbData.parcelsStatus?.[0]?.parcelAwbNumber;
    if (!parcelAwb) return { weight: awbData.expeditionSummary?.awbWeight || 1, cod: awbData.expeditionSummary?.cashOnDelivery || 0, county: awbData.expeditionStatus?.county };

    const parcelData = await samedayGet(`/api/client/parcel/${parcelAwb}/status-history`);
    const ps = parcelData.parcelSummary;

    const realWeight = ps?.parcelWeight || 0;
    const L = ps?.parcelLength || 0;
    const W = ps?.parcelWidth || 0;
    const H = ps?.parcelHeight || 0;
    const volumetric = (L && W && H) ? (L * W * H) / 6000 : 0;
    const billable = Math.max(realWeight, volumetric, 1);
    // Round up to nearest 0.5kg (SameDay billing granularity)
    const rounded = Math.ceil(billable * 2) / 2;

    return {
      weight: rounded,
      cod: awbData.expeditionSummary?.cashOnDelivery || 0,
      county: awbData.expeditionStatus?.county,
    };
  } catch {
    return null;
  }
}

async function estimateCost(countyId, cityId, weight, codAmount) {
  const token = await samedayAuth();
  const body = new URLSearchParams();
  body.set('pickupPoint', '375082');
  body.set('contactPerson', '543266');
  body.set('packageType', '0');
  body.set('packageNumber', '1');
  body.set('packageWeight', String(Math.max(weight, 1)));
  body.set('service', '7');
  body.set('awbPayment', '1');
  body.set('cashOnDelivery', String(codAmount || 0));
  body.set('cashOnDeliveryReturns', '0');
  body.set('insuredValue', '0');
  body.set('thirdPartyPickup', '0');
  body.set('awbRecipient[county]', String(countyId));
  body.set('awbRecipient[city]', String(cityId));
  body.set('parcels[0][weight]', String(Math.max(weight, 1)));

  const res = await fetch(`${SAMEDAY_API}/api/awb/estimate-cost`, {
    method: 'POST',
    headers: { 'X-AUTH-TOKEN': token, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`estimate-cost ${res.status}`);
  const raw = (await res.json()).amount;
  return Math.round(raw * FUEL_CORRECTION * 100) / 100;
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[backfill] ${new Date().toISOString()} ${DRY_RUN ? 'DRY RUN' : 'LIVE'} limit=${LIMIT}`);

  const stores = await prisma.storeConnection.findMany({
    where: { platform: 'SHOPIFY', isActive: true, shopifyAccessToken: { not: null } },
    select: { id: true, name: true, domain: true, shopifyAccessToken: true },
  });

  await loadCounties();

  let totalMatched = 0, totalCosted = 0, totalSkipped = 0, totalFailed = 0;

  for (const store of stores) {
    const shopifyToken = decrypt(store.shopifyAccessToken);
    console.log(`\n[${store.name}]`);

    // ── PHASE 1: Match unmatched AWBs ────────────────────────────────
    const unmatched = await prisma.courierTracking.findMany({
      where: { storeConnectionId: store.id, orderExternalId: null },
      select: { id: true, awb: true },
      take: LIMIT,
    });

    if (unmatched.length > 0) {
      console.log(`  Phase 1: Matching ${unmatched.length} AWBs to Shopify orders...`);
      for (const ct of unmatched) {
        try {
          const result = await shopifyGql(store.domain, shopifyToken, `{
            orders(first: 1, query: "${ct.awb}") {
              edges { node { id name } }
            }
          }`);
          const shopifyOrder = result.orders?.edges?.[0]?.node;
          if (shopifyOrder) {
            const localOrder = await prisma.order.findFirst({
              where: { storeConnectionId: store.id, externalId: shopifyOrder.id },
              select: { id: true },
            });
            if (!DRY_RUN) {
              await prisma.courierTracking.update({
                where: { id: ct.id },
                data: {
                  orderId: localOrder?.id || null,
                  orderExternalId: shopifyOrder.id,
                  orderNumber: shopifyOrder.name,
                },
              });
            }
            totalMatched++;
          }
          await sleep(500);
        } catch (err) {
          // Silently continue
          await sleep(500);
        }
      }
      console.log(`  Phase 1 done: ${totalMatched} matched`);
    }

    // ── PHASE 2: Calculate costs ─────────────────────────────────────
    const needCost = await prisma.courierTracking.findMany({
      where: {
        storeConnectionId: store.id,
        servicePayment: null,
        currency: 'RON',
        OR: [{ isDelivered: true }, { isReturned: true }],
      },
      select: {
        id: true, awb: true, orderNumber: true, orderExternalId: true,
        codAmount: true, isCod: true, county: true,
      },
      take: LIMIT,
      orderBy: { courierUpdatedAt: 'desc' },
    });

    if (needCost.length === 0) { console.log(`  Phase 2: No AWBs need cost`); continue; }
    console.log(`  Phase 2: Calculating cost for ${needCost.length} AWBs...`);

    for (let i = 0; i < needCost.length; i++) {
      const ct = needCost[i];
      try {
        let countyId = null, cityId = null, weight = 1, cod = 0, method = '';

        // Get real weight from SameDay parcel details (catarit + volumetric)
        const realData = await getRealWeight(ct.awb);
        if (!realData) { totalSkipped++; await sleep(500); continue; }

        weight = realData.weight;
        cod = realData.cod;

        // Strategy A: Has Shopify order → use shipping address for precise city
        if (ct.orderExternalId) {
          const data = await shopifyGql(store.domain, shopifyToken, `{
            order(id: "${ct.orderExternalId}") {
              shippingAddress { city province countryCodeV2 }
            }
          }`);
          const addr = data.order?.shippingAddress;
          if (addr && addr.countryCodeV2 === 'RO' && addr.province) {
            const county = mapCountyName(addr.province);
            if (county) {
              countyId = county.id;
              cityId = await findCity(county.id, addr.city || county.name);
              method = 'shopify';
            }
          }
          if (addr?.countryCodeV2 && addr.countryCodeV2 !== 'RO') {
            totalSkipped++;
            continue;
          }
        }

        // Strategy B: No order or failed A → use SameDay AWB county + capital
        if (!countyId) {
          const countyName = realData.county;
          if (!countyName) { totalSkipped++; await sleep(500); continue; }

          const county = mapCountyName(countyName);
          if (!county) { totalSkipped++; await sleep(500); continue; }

          countyId = county.id;
          cityId = await getCapitalCity(county.id, county.name);
          method = 'sameday-county';

          if (!DRY_RUN && ct.county !== countyName) {
            await prisma.courierTracking.update({ where: { id: ct.id }, data: { county: countyName } });
          }
        }

        if (!countyId || !cityId) { totalSkipped++; await sleep(500); continue; }

        const cost = await estimateCost(countyId, cityId, weight, cod);

        if (!DRY_RUN) {
          await prisma.courierTracking.update({ where: { id: ct.id }, data: { servicePayment: cost } });
        }
        totalCosted++;

        if (totalCosted % 50 === 0 || i < 5) {
          console.log(`  ${ct.orderNumber || ct.awb} → ${cost} RON [${method}] (${totalCosted}/${needCost.length})`);
        }

        await sleep(600);
      } catch (err) {
        totalFailed++;
        await sleep(500);
      }

      if ((i + 1) % 100 === 0) {
        console.log(`  ... ${i + 1}/${needCost.length} (${totalCosted} ok, ${totalSkipped} skip, ${totalFailed} fail)`);
      }
    }
  }

  console.log(`\n[backfill] DONE: ${totalMatched} matched, ${totalCosted} costed, ${totalSkipped} skipped, ${totalFailed} failed`);
}

main()
  .catch(e => { console.error('[backfill]', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
