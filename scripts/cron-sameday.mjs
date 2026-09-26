/**
 * cron-sameday.mjs — SameDay courier tracking sync
 * Polls SameDay status-sync every 30 min.
 * Matches AWBs to Shopify orders, marks delivered COD as PAID, detects returns.
 * Calculates shipping costs via estimate-cost API for AWBs missing servicePayment.
 */
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import fs from 'fs';

const LOCK_FILE = '/tmp/kimono-sameday.lock';

// Prevent multiple instances
if (fs.existsSync(LOCK_FILE)) {
  try {
    const pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8'));
    try { process.kill(pid, 0); console.log('[sameday] Another instance running, exiting.'); process.exit(0); }
    catch { fs.unlinkSync(LOCK_FILE); }
  } catch { fs.unlinkSync(LOCK_FILE); }
}
fs.writeFileSync(LOCK_FILE, String(process.pid));
process.on('exit', () => { try { fs.unlinkSync(LOCK_FILE); } catch {} });
process.on('SIGTERM', () => { try { fs.unlinkSync(LOCK_FILE); } catch {} process.exit(0); });
process.on('SIGINT', () => { try { fs.unlinkSync(LOCK_FILE); } catch {} process.exit(0); });
process.on('uncaughtException', (err) => { console.error('[sameday] UNCAUGHT:', err.message); try { fs.unlinkSync(LOCK_FILE); } catch {} });
process.on('unhandledRejection', (err) => { console.error('[sameday] UNHANDLED:', err?.message || err); });

const prisma = new PrismaClient();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const SAMEDAY_API = process.env.SAMEDAY_API_URL || 'https://api.sameday.ro';
const SAMEDAY_USER = process.env.SAMEDAY_USERNAME;
const SAMEDAY_PASS = process.env.SAMEDAY_PASSWORD;
const API_VERSION = '2025-10';

// ── Decrypt helper (same as cron-sync) ──────────────────────────────────────
function decrypt(data) {
  const [iv, tag, ct] = data.split(':').map(h => Buffer.from(h, 'hex'));
  const key = Buffer.from(process.env.APP_ENCRYPTION_KEY, 'hex');
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return d.update(ct) + d.final('utf8');
}

// ── SameDay Auth ────────────────────────────────────────────────────────────
let samedayToken = null;
let samedayTokenExpiry = 0;

// Token cache per store
const tokenCache = new Map();

async function samedayAuth(username, password) {
  const cacheKey = username;
  const cached = tokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) return cached.token;

  // Try store-specific credentials first, fallback to env
  const user = username || SAMEDAY_USER;
  const pass = password || SAMEDAY_PASS;

  if (!user || !pass) throw new Error('SameDay credentials not available');

  const res = await fetch(`${SAMEDAY_API}/api/authenticate?remember_me=1`, {
    method: 'POST',
    headers: { 'X-AUTH-USERNAME': user, 'X-AUTH-PASSWORD': pass },
  });

  if (!res.ok) throw new Error(`SameDay auth failed: ${res.status}`);
  const data = await res.json();
  tokenCache.set(cacheKey, { token: data.token, expiry: Date.now() + 25 * 24 * 60 * 60 * 1000 });
  console.log(`[sameday] Authenticated ${user}, expires: ${data.expire_at}`);
  return data.token;
}

// ── SameDay API call with retry ─────────────────────────────────────────────
async function samedayGet(path, username, password, retries = 3) {
  const token = await samedayAuth(username, password);
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(`${SAMEDAY_API}${path}`, {
      headers: { 'X-AUTH-TOKEN': token },
    });
    if (res.status === 429) {
      const wait = Math.min(3000 * Math.pow(2, attempt), 30000);
      console.log(`  [sameday] rate limited, waiting ${wait / 1000}s`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`SameDay API ${res.status}: ${path}`);
    return res.json();
  }
  throw new Error(`SameDay max retries: ${path}`);
}

// ── SameDay POST helper (for estimate-cost) ─────────────────────────────────
async function samedayPost(path, body, username, password, retries = 3) {
  const token = await samedayAuth(username, password);
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(`${SAMEDAY_API}${path}`, {
      method: 'POST',
      headers: {
        'X-AUTH-TOKEN': token,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (res.status === 429) {
      const wait = Math.min(3000 * Math.pow(2, attempt), 30000);
      console.log(`  [sameday] rate limited on POST, waiting ${wait / 1000}s`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`SameDay POST ${res.status}: ${path} — ${text.slice(0, 200)}`);
    }
    return res.json();
  }
  throw new Error(`SameDay max retries POST: ${path}`);
}

// ── Shopify GraphQL helper ──────────────────────────────────────────────────
async function shopifyGql(domain, token, query) {
  const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Shopify API ${res.status}`);
  const data = await res.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors).slice(0, 200));
  return data.data;
}

// ── Geolocation helpers for estimate-cost ───────────────────────────────────
const countyCache = new Map();    // name(lower) → { id, name }
const cityCache = new Map();      // "countyId:cityName(lower)" → { id, name }

function removeDiacritics(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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
  const comSatMatch = n.match(/^Com\.?\s+(.+?)\s+[Ss]at\.?\s+/i);
  if (comSatMatch) {
    n = comSatMatch[1].trim();
  } else {
    // "Santioana De Mures Com. Panet" → extract before "Com."
    const beforeComMatch = n.match(/^(.+?)\s+Com\.?\s+/i);
    if (beforeComMatch && !n.match(/^Com/i)) {
      n = beforeComMatch[1].trim();
    }
    // "Com.Costeiu" / "Comuna Fundata" → strip prefix
    n = n.replace(/^Com(?:una)?\.?\s*/i, '').trim();
    // Strip ". Sat Xyz" suffix
    n = n.replace(/\.?\s+[Ss]at\.?\s+.*$/i, '').trim();
    n = n.replace(/\.+$/, '').trim();
  }

  // Strip "Sat " prefix: "Sat Malu Spart" → "Malu Spart"
  n = n.replace(/^Sat\.?\s+/i, '').trim();

  // Strip address fragments: "Danesti 213. Str principala" → "Danesti"
  n = n.replace(/\s+\d+\.?\s+.*$/i, '').trim();
  n = n.replace(/\s+(str|nr|bl|sc|ap|et)[\.\s].*/i, '').trim();

  // Replace dashes between words with spaces: "Targu-jiu" → "Targu jiu"
  n = n.replace(/-/g, ' ').trim();
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

async function loadCounties(sdUser, sdPass) {
  if (countyCache.size > 0) return; // already loaded for this run
  const data = await samedayGet('/api/geolocation/county?countPerPage=100', sdUser, sdPass);
  for (const c of data.data) {
    const entry = { id: c.id, name: c.name };
    countyCache.set(c.name.toLowerCase(), entry);
    countyCache.set(removeDiacritics(c.name).toLowerCase(), entry);
    if (c.latinName) countyCache.set(c.latinName.toLowerCase(), entry);
  }
  // Add common aliases (Shopify uses diacritics, SameDay doesn't)
  countyCache.set('bucharest', { id: 1, name: 'Bucuresti' });
  countyCache.set('bucure\u0219ti', { id: 1, name: 'Bucuresti' });
  countyCache.set('ilfov county', { id: 26, name: 'Ilfov' });
  countyCache.set('caras-severin', { id: 13, name: 'Caras-Severin' });
  countyCache.set('cara\u0219-severin', { id: 13, name: 'Caras-Severin' });
  countyCache.set('bistrita-nasaud', { id: 7, name: 'Bistrita-Nasaud' });
  countyCache.set('bistri\u021ba-n\u0103s\u0103ud', { id: 7, name: 'Bistrita-Nasaud' });
  console.log(`  [geo] ${countyCache.size} county entries cached`);
}

async function searchSamedayCity(countyId, searchName, sdUser, sdPass) {
  const token = await samedayAuth(sdUser, sdPass);
  const encoded = encodeURIComponent(searchName);
  const res = await fetch(`${SAMEDAY_API}/api/geolocation/city?county=${countyId}&name=${encoded}&countPerPage=10`, {
    headers: { 'X-AUTH-TOKEN': token },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.data || [];
}

// Common misspelling map
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

  // Try with dash between words: "Cluj Napoca" → "Cluj-Napoca"
  for (const v of [normalizedNoDiacritics, normalized]) {
    const words = v.split(' ');
    if (words.length === 2) variants.add(`${words[0]}-${words[1]}`);
    if (words.length === 3) {
      variants.add(`${words[0]}-${words[1]} ${words[2]}`);
      variants.add(`${words[0]} ${words[1]}-${words[2]}`);
    }
  }

  // Try -i suffix for Romanian plural: "Filipesti" → "Filipestii"
  const firstWord = normalizedNoDiacritics.split(' ')[0];
  const rest = normalizedNoDiacritics.split(' ').slice(1).join(' ');
  if (firstWord.endsWith('i') || firstWord.endsWith('esti') || firstWord.endsWith('eni') || firstWord.endsWith('ani')) {
    variants.add(firstWord + 'i' + (rest ? ' ' + rest : ''));
  }

  // Try first 2 words only: "Valea Lunga Cricov" → "Valea Lunga"
  if (normalizedNoDiacritics.split(' ').length >= 3) {
    const parts2 = normalizedNoDiacritics.split(' ');
    variants.add(`${parts2[0]} ${parts2[1]}`);
    variants.add(`${parts2[0]}-${parts2[1]}`);
  }

  // Misspelling corrections
  const lower = normalizedNoDiacritics.toLowerCase();
  if (CITY_MISSPELLINGS[lower]) variants.add(CITY_MISSPELLINGS[lower]);
  const firstWordLower = firstWord.toLowerCase();
  if (CITY_MISSPELLINGS[firstWordLower]) {
    variants.add(CITY_MISSPELLINGS[firstWordLower] + (rest ? ' ' + rest : ''));
  }

  return variants;
}

async function findSamedayCity(countyId, cityName, sdUser, sdPass) {
  const key = `${countyId}:${cityName.toLowerCase().trim()}`;
  if (cityCache.has(key)) return cityCache.get(key);

  const variants = generateCityVariants(cityName);

  for (const variant of variants) {
    if (!variant || variant.length < 2) continue;
    const results = await searchSamedayCity(countyId, variant, sdUser, sdPass);
    if (results.length > 0) {
      const lv = removeDiacritics(variant).toLowerCase();
      const exact = results.find(c =>
        c.name.toLowerCase() === lv || removeDiacritics(c.name).toLowerCase() === lv
      );
      const city = exact || results[0];
      const result = { id: city.id, name: city.name };
      cityCache.set(key, result);
      return result;
    }
    await sleep(300);
  }

  // Special fallback: Bucuresti → search "Sectorul 1"
  if (countyId === 1) {
    const bucResults = await searchSamedayCity(1, 'Sectorul 1', sdUser, sdPass);
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
  return countyCache.get(lower)
    || countyCache.get(removeDiacritics(lower))
    || null;
}

// Fuel surcharge correction — calibrated against real SameDay invoices
const FUEL_CORRECTION = 1.02;

async function getRealWeight(awb, sdUser, sdPass) {
  try {
    const awbData = await samedayGet(`/api/client/awb/${awb}/status`, sdUser, sdPass);
    const parcelAwb = awbData.parcelsStatus?.[0]?.parcelAwbNumber;
    if (!parcelAwb) return { weight: awbData.expeditionSummary?.awbWeight || 1, cod: awbData.expeditionSummary?.cashOnDelivery || 0, county: awbData.expeditionStatus?.county };

    const parcelData = await samedayGet(`/api/client/parcel/${parcelAwb}/status-history`, sdUser, sdPass);
    const ps = parcelData.parcelSummary;
    const realWeight = ps?.parcelWeight || 0;
    const L = ps?.parcelLength || 0, W = ps?.parcelWidth || 0, H = ps?.parcelHeight || 0;
    const volumetric = (L && W && H) ? (L * W * H) / 6000 : 0;
    const billable = Math.max(realWeight, volumetric, 1);
    return {
      weight: Math.ceil(billable * 2) / 2,
      cod: awbData.expeditionSummary?.cashOnDelivery || 0,
      county: awbData.expeditionStatus?.county,
    };
  } catch { return null; }
}

async function estimateCost(countyId, cityId, weight, codAmount, sdUser, sdPass) {
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

  const data = await samedayPost('/api/awb/estimate-cost', body, sdUser, sdPass);
  return Math.round(data.amount * FUEL_CORRECTION * 100) / 100;
}

// ── HU AWB sync (SameDay International / crossborder) ─────────────────────
// status-sync stopped returning HU events around 2026-04-30. SameDay confirmed
// (May 2026) that the proper endpoint for crossborder shipments is
// /api/client/xb-status-sync — same shape as status-sync, paginated, 2h window.
// AWB format: "011ONBX..." (17 chars). Cost is applied from storeSettings tariff.
function isHuAwb(awb) {
  return typeof awb === 'string' && awb.startsWith('011') && awb.includes('ONBX');
}

// Bulk live HU events via /api/client/xb-status-sync (2h window).
// Mirrors syncSameDay's status-sync loop but for crossborder AWBs.
async function syncXbStatusSync(store, sdUser, sdPass) {
  const now = Math.floor(Date.now() / 1000);
  const start = now - 7000;
  console.log(`  [xb-status-sync] Fetching ${new Date(start * 1000).toISOString()} → ${new Date(now * 1000).toISOString()}`);

  let page = 1;
  let processed = 0, delivered = 0, returned = 0;

  while (true) {
    let data;
    try {
      data = await samedayGet(`/api/client/xb-status-sync?startTimestamp=${start}&endTimestamp=${now}&page=${page}&countPerPage=100`, sdUser, sdPass);
    } catch (err) {
      console.error(`  [xb-status-sync] page ${page} failed:`, err.message);
      break;
    }
    if (!data.data || data.data.length === 0) break;

    for (const event of data.data) {
      const parcelAwb = event.parcelAwbNumber;
      if (!parcelAwb) continue;
      // Expedition AWB = parcel AWB minus 3-digit suffix
      const awb = parcelAwb.length > 3 ? parcelAwb.slice(0, -3) : parcelAwb;
      const statusId = event.statusId;
      const isDelivered = statusId === 9;
      const isReturned = statusId === 35 || statusId === 16 || statusId === 79 || event.inReturn === true;

      try {
        await prisma.courierTracking.upsert({
          where: { storeConnectionId_awb: { storeConnectionId: store.id, awb } },
          create: {
            storeConnectionId: store.id,
            currency: 'HUF',
            awb,
            statusId,
            statusName: event.status || event.statusLabel || '',
            inReturn: event.inReturn || isReturned,
            isDelivered,
            isReturned,
            county: event.transitLocation || null,
            courierUpdatedAt: event.statusDate ? new Date(event.statusDate) : new Date(),
          },
          update: {
            statusId,
            statusName: event.status || event.statusLabel || '',
            inReturn: event.inReturn || isReturned,
            isDelivered: isDelivered || undefined,
            isReturned: isReturned || undefined,
            county: event.transitLocation || undefined,
            courierUpdatedAt: event.statusDate ? new Date(event.statusDate) : new Date(),
          },
        });
        processed++;
        if (isDelivered) delivered++;
        if (isReturned) returned++;
      } catch (err) {
        console.error(`  [xb-tracking] upsert failed ${awb}:`, err.message);
      }
    }

    if (page >= (data.pages || 1)) break;
    page++;
    await sleep(1000);
  }

  console.log(`  [xb-status-sync] ${processed} events, ${delivered} delivered, ${returned} returned`);
  return { processed, delivered, returned };
}

// HU shipping cost: prefer per-weight tariff (settings.shippingCostHuTariff JSON), fallback to fixed shippingCostIntl.
// Tariff format: { "1": 30, "2": 32, "5": 38, "10": 50 } — keys are weight ceilings in kg, value is RON cost.
function calcHuCostForWeight(weightKg, tariff, fallback) {
  if (tariff && typeof tariff === 'object') {
    const tiers = Object.keys(tariff).map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b);
    for (const t of tiers) {
      if (weightKg <= t) return tariff[String(t)];
    }
    if (tiers.length) return tariff[String(tiers[tiers.length - 1])]; // over max tier
  }
  return fallback;
}

async function syncHuOrders(store, sdUser, sdPass, shopifyToken) {
  const fixedHuCost = store.settings?.shippingCostIntl || null;
  // Parse JSON tariff if present in settings
  let huTariff = null;
  if (store.settings?.shippingCostHuTariff) {
    try { huTariff = JSON.parse(store.settings.shippingCostHuTariff); }
    catch { huTariff = null; }
  }

  // 1) Get HU AWBs from recent Shopify orders (last 30 days)
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const huFromShopify = new Map(); // awb → { orderExternalId, orderName }
  let cursor = null;
  for (let page = 0; page < 6; page++) {
    let data;
    try {
      data = await shopifyGql(store.domain, shopifyToken, `{
        orders(first: 100, query: "created_at:>=${since}", reverse: true, sortKey: CREATED_AT${cursor ? `, after: "${cursor}"` : ''}) {
          pageInfo { hasNextPage endCursor }
          edges { cursor node { id name fulfillments(first: 5) { trackingInfo { number } } } }
        }
      }`);
    } catch (err) {
      console.error('  [hu] Shopify orders page failed:', err.message);
      break;
    }
    const edges = data.orders?.edges || [];
    for (const e of edges) {
      const fulfillments = e.node.fulfillments || [];
      for (const f of fulfillments) {
        for (const t of (f.trackingInfo || [])) {
          if (isHuAwb(t.number)) {
            huFromShopify.set(t.number, { orderExternalId: e.node.id, orderName: e.node.name });
          }
        }
      }
    }
    if (!data.orders?.pageInfo?.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
    await sleep(500);
  }

  // 2) Get HU AWBs already in DB that aren't terminal (or have no cost yet)
  const huFromDb = await prisma.courierTracking.findMany({
    where: {
      storeConnectionId: store.id,
      currency: 'HUF',
      OR: [
        { isDelivered: false, isReturned: false },
        ...(fixedHuCost ? [{ isDelivered: true, servicePayment: null }] : []),
      ],
    },
    select: { awb: true },
    take: 100,
  });

  // 3) Union of AWBs to refresh
  const toRefresh = new Map(huFromShopify); // copy
  for (const r of huFromDb) {
    if (!toRefresh.has(r.awb)) toRefresh.set(r.awb, {});
  }

  if (toRefresh.size === 0) {
    console.log('  [hu] no HU AWBs to refresh');
    return { huProcessed: 0, huDelivered: 0, huReturned: 0 };
  }

  console.log(`  [hu] refreshing ${toRefresh.size} HU AWBs (${huFromShopify.size} from Shopify, ${huFromDb.length} pending in DB)`);

  let huProcessed = 0, huDelivered = 0, huReturned = 0, huCostApplied = 0;

  for (const [awb, info] of toRefresh) {
    try {
      const data = await samedayGet(`/api/client/awb/${awb}/status`, sdUser, sdPass);
      const summary = data.expeditionSummary || {};
      const status = data.expeditionStatus || {};
      // Pick the latest event from parcels' status history
      let lastEvent = null;
      for (const p of (data.parcelsStatus || [])) {
        const hist = p.statusHistory || [];
        for (const ev of hist) {
          if (!lastEvent || new Date(ev.statusDate) > new Date(lastEvent.statusDate)) {
            lastEvent = ev;
          }
        }
      }
      const statusId = lastEvent?.statusId || status?.statusId || 0;
      const statusName = lastEvent?.statusState || status?.statusState || lastEvent?.status || '';
      const isDelivered = statusId === 9 || summary?.delivered === true;
      const isReturned = statusId === 35 || statusId === 16 || statusId === 79;
      const isCod = (summary?.cashOnDelivery || 0) > 0;
      const codAmount = summary?.cashOnDelivery || 0;
      // County: prefer the destination county from a delivery event in expeditionHistory
      // (expeditionStatus.county returns the pickup hub for HU, not the destination).
      let county = null;
      const history = data.expeditionHistory || [];
      const RO_COUNTIES = new Set(['Pest', 'Ilfov', 'Bucuresti', 'București', 'Cluj', 'Bihor', 'Timiș', 'Timis', 'Iași', 'Iasi', 'Brașov', 'Brasov']);
      const deliveredEvent = history.find(h => h?.statusId === 9);
      if (deliveredEvent?.county) {
        county = deliveredEvent.county;
      } else {
        // Find latest HU-looking county in history (anything not a known RO county)
        for (let i = history.length - 1; i >= 0; i--) {
          const c = history[i]?.county;
          if (c && !RO_COUNTIES.has(c)) { county = c; break; }
        }
        if (!county) county = status?.county || lastEvent?.transitLocation || null;
      }

      // Resolve local order if we have orderExternalId from Shopify
      let orderId = null;
      const orderExternalId = info.orderExternalId || null;
      const orderNumber = info.orderName || null;
      if (orderExternalId) {
        const localOrder = await prisma.order.findFirst({
          where: { storeConnectionId: store.id, externalId: orderExternalId },
          select: { id: true },
        });
        orderId = localOrder?.id || null;
      }

      // Determine billable weight on delivery (real + volumetric from parcel details)
      let billableWeight = 1;
      try {
        const parcelAwb = (data.parcelsStatus || [])[0]?.parcelAwbNumber;
        if (parcelAwb && (isDelivered || isReturned)) {
          const pd = await samedayGet(`/api/client/parcel/${parcelAwb}/status-history`, sdUser, sdPass);
          const ps = pd.parcelSummary || {};
          const real = ps.parcelWeight || 0;
          const L = ps.parcelLength || 0, W = ps.parcelWidth || 0, H = ps.parcelHeight || 0;
          const vol = (L && W && H) ? (L * W * H) / 6000 : 0;
          billableWeight = Math.max(real, vol, 1);
          billableWeight = Math.ceil(billableWeight * 2) / 2;
        }
      } catch {}

      // Apply HU cost on delivery
      let servicePayment = null;
      if (isDelivered) {
        const tariffCost = calcHuCostForWeight(billableWeight, huTariff, fixedHuCost);
        servicePayment = tariffCost || null;
      }

      const existing = await prisma.courierTracking.findUnique({
        where: { storeConnectionId_awb: { storeConnectionId: store.id, awb } },
        select: { id: true, servicePayment: true, orderId: true },
      });

      const updateData = {
        statusId,
        statusName,
        inReturn: isReturned,
        isDelivered: isDelivered || undefined,
        isReturned: isReturned || undefined,
        codAmount,
        isCod,
        county: county || undefined,
        courierUpdatedAt: lastEvent?.statusDate ? new Date(lastEvent.statusDate) : new Date(),
      };
      if (servicePayment && !existing?.servicePayment) {
        updateData.servicePayment = servicePayment;
        huCostApplied++;
      }
      if (orderId && !existing?.orderId) {
        updateData.orderId = orderId;
        updateData.orderExternalId = orderExternalId;
        updateData.orderNumber = orderNumber;
      } else if (orderExternalId && !existing?.orderId) {
        updateData.orderExternalId = orderExternalId;
        updateData.orderNumber = orderNumber;
      }

      await prisma.courierTracking.upsert({
        where: { storeConnectionId_awb: { storeConnectionId: store.id, awb } },
        create: {
          storeConnectionId: store.id,
          awb,
          currency: 'HUF',
          statusId,
          statusName,
          inReturn: isReturned,
          isDelivered,
          isReturned,
          codAmount,
          isCod,
          servicePayment,
          county,
          courierUpdatedAt: lastEvent?.statusDate ? new Date(lastEvent.statusDate) : new Date(),
          orderId,
          orderExternalId,
          orderNumber,
        },
        update: updateData,
      });

      huProcessed++;
      if (isDelivered) huDelivered++;
      if (isReturned) huReturned++;
      await sleep(500);
    } catch (err) {
      console.error(`  [hu] ${awb}:`, err.message?.slice(0, 100));
      await sleep(800);
    }
  }

  console.log(`  [hu] done: ${huProcessed} processed, ${huDelivered} delivered, ${huReturned} returned, ${huCostApplied} cost-applied`);
  return { huProcessed, huDelivered, huReturned };
}

// ── Main sync ───────────────────────────────────────────────────────────────
async function syncSameDay(store) {
  const shopifyToken = decrypt(store.shopifyAccessToken);

  // Get SameDay credentials from store settings
  let sdUser, sdPass;
  if (store.settings?.courierUsername && store.settings?.courierPassword) {
    sdUser = decrypt(store.settings.courierUsername);
    sdPass = decrypt(store.settings.courierPassword);
  }

  // Determine time window (last 2h, or since last run)
  const now = Math.floor(Date.now() / 1000);
  const start = now - 7000; // ~2h (max allowed by SameDay)

  console.log(`  [status-sync] Fetching ${new Date(start * 1000).toISOString()} → ${new Date(now * 1000).toISOString()}`);

  let page = 1;
  let totalProcessed = 0;
  let newDelivered = 0;
  let newReturned = 0;

  while (true) {
    let data;
    try {
      data = await samedayGet(`/api/client/status-sync?startTimestamp=${start}&endTimestamp=${now}&page=${page}&countPerPage=100`, sdUser, sdPass);
    } catch (err) {
      console.error(`  [status-sync] page ${page} failed:`, err.message);
      break;
    }

    if (!data.data || data.data.length === 0) break;

    for (const event of data.data) {
      const parcelAwb = event.parcelAwbNumber;
      // Extract expedition AWB (remove last 3 digits = parcel suffix)
      const awb = parcelAwb.length > 3 ? parcelAwb.slice(0, -3) : parcelAwb;
      const statusId = event.statusId;
      const isDelivered = statusId === 9;
      const isReturned = statusId === 35 || event.inReturn === true;
      const currency = awb.includes("ONBX") ? "HUF" : "RON";

      try {
        // Upsert tracking record
        await prisma.courierTracking.upsert({
          where: { storeConnectionId_awb: { storeConnectionId: store.id, awb } },
          create: {
            storeConnectionId: store.id, currency,
            awb,
            statusId,
            statusName: event.status || event.statusLabel || '',
            inReturn: event.inReturn || false,
            isDelivered,
            isReturned,
            county: event.transitLocation || null,
            courierUpdatedAt: event.statusDate ? new Date(event.statusDate) : new Date(),
          },
          update: {
            statusId,
            statusName: event.status || event.statusLabel || '',
            inReturn: event.inReturn || isReturned,
            isDelivered: isDelivered || undefined,
            isReturned: isReturned || undefined,
            county: event.transitLocation || undefined,
            courierUpdatedAt: event.statusDate ? new Date(event.statusDate) : new Date(),
          },
        });
        totalProcessed++;

        if (isDelivered) newDelivered++;
        if (isReturned) newReturned++;
      } catch (err) {
        console.error(`  [tracking] upsert failed ${awb}:`, err.message);
      }
    }

    if (page >= (data.pages || 1)) break;
    page++;
    await sleep(1000);
  }

  console.log(`  [status-sync] ${totalProcessed} events, ${newDelivered} delivered, ${newReturned} returned`);

  // ── Fetch AWB details for delivered/returned (COD amount, weight) ────────
  const needDetails = await prisma.courierTracking.findMany({
    where: {
      storeConnectionId: store.id,
      codAmount: null,
      OR: [{ isDelivered: true }, { isReturned: true }],
    },
    select: { id: true, awb: true },
    take: 50,
  });

  for (const ct of needDetails) {
    try {
      const awbData = await samedayGet(`/api/client/awb/${ct.awb}/status`, sdUser, sdPass);
      const summary = awbData.expeditionSummary;
      await prisma.courierTracking.update({
        where: { id: ct.id },
        data: {
          codAmount: summary.cashOnDelivery || 0,
          isCod: (summary.cashOnDelivery || 0) > 0,
          servicePayment: summary.servicePayment || null,
          county: awbData.expeditionStatus?.county || undefined,
        },
      });
      await sleep(500);
    } catch (err) {
      console.error(`  [awb-detail] ${ct.awb}:`, err.message);
    }
  }

  // ── Match AWBs to Shopify orders ──────────────────────────────────────────
  // Pick newest first; skip those marked abandoned.
  // Adaptive cooldown: 1h if we already found a Shopify order (waiting for local DB sync),
  // 6h otherwise. We approximate with a 1h cooldown for entries that have orderNumber set but no orderId.
  const cooldownLong = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const cooldownShort = new Date(Date.now() - 1 * 60 * 60 * 1000);
  const unmatched = await prisma.courierTracking.findMany({
    where: {
      storeConnectionId: store.id,
      orderId: null,
      matchAbandoned: false,
      OR: [
        { lastMatchAt: null },
        { orderNumber: { not: null }, lastMatchAt: { lt: cooldownShort } }, // fast retry for "found in Shopify, waiting for local sync"
        { orderNumber: null, lastMatchAt: { lt: cooldownLong } },
      ],
    },
    select: { id: true, awb: true, orderNumber: true, orderExternalId: true, matchAttempts: true, firstSeenAt: true },
    orderBy: { firstSeenAt: 'desc' },
    take: 100,
  });

  if (unmatched.length > 0) {
    console.log(`  [match] ${unmatched.length} AWBs unmatched (newest first), searching...`);

    const ABANDON_AFTER_ATTEMPTS = 5;
    const ABANDON_AFTER_DAYS = 30;

    for (const ct of unmatched) {
      try {
        // Fast-path: if we already have orderExternalId from a prior match attempt, just look up the local DB
        if (ct.orderExternalId) {
          const localOrder = await prisma.order.findFirst({
            where: { storeConnectionId: store.id, externalId: ct.orderExternalId },
            select: { id: true },
          });
          if (localOrder) {
            await prisma.courierTracking.update({
              where: { id: ct.id },
              data: { orderId: localOrder.id, lastMatchAt: new Date() },
            });
            console.log(`  [match] ${ct.awb} → ${ct.orderNumber} (local DB caught up)`);
            continue;
          } else {
            await prisma.courierTracking.update({
              where: { id: ct.id },
              data: { lastMatchAt: new Date() },
            });
            continue;
          }
        }

        const result = await shopifyGql(store.domain, shopifyToken, `{
          orders(first: 1, query: "${ct.awb}") {
            edges { node { id name } }
          }
        }`);

        const shopifyOrder = result.orders?.edges?.[0]?.node;
        if (shopifyOrder) {
          // Find local order by externalId
          const localOrder = await prisma.order.findFirst({
            where: { storeConnectionId: store.id, externalId: shopifyOrder.id },
            select: { id: true, financialStatus: true },
          });

          await prisma.courierTracking.update({
            where: { id: ct.id },
            data: {
              orderId: localOrder?.id || null,
              orderExternalId: shopifyOrder.id,
              orderNumber: shopifyOrder.name,
              lastMatchAt: new Date(),
            },
          });

          if (localOrder) {
            console.log(`  [match] ${ct.awb} → ${shopifyOrder.name}`);
          }
        } else {
          // No match; increment attempts and possibly abandon
          const nextAttempts = ct.matchAttempts + 1;
          const ageDays = (Date.now() - new Date(ct.firstSeenAt).getTime()) / (1000 * 60 * 60 * 24);
          const shouldAbandon = nextAttempts >= ABANDON_AFTER_ATTEMPTS && ageDays > ABANDON_AFTER_DAYS;
          await prisma.courierTracking.update({
            where: { id: ct.id },
            data: {
              matchAttempts: nextAttempts,
              lastMatchAt: new Date(),
              matchAbandoned: shouldAbandon,
            },
          });
          if (shouldAbandon) {
            console.log(`  [match] ${ct.awb} abandoned after ${nextAttempts} attempts (${Math.round(ageDays)}d old)`);
          }
        }
        await sleep(700);
      } catch (err) {
        console.error(`  [match] ${ct.awb} search failed:`, err.message);
      }
    }
  }

  // ── Calculate shipping costs for AWBs without servicePayment ──────────────
  const needCost = await prisma.courierTracking.findMany({
    where: {
      storeConnectionId: store.id,
      servicePayment: null,
      currency: 'RON',
      OR: [{ isDelivered: true }, { isReturned: true }],
    },
    select: {
      id: true, awb: true, orderExternalId: true, orderNumber: true,
      codAmount: true, isCod: true, county: true,
    },
    take: 30,
    orderBy: { courierUpdatedAt: 'desc' },
  });

  if (needCost.length > 0) {
    console.log(`  [estimate-cost] ${needCost.length} AWBs need shipping cost calculation`);
    await loadCounties(sdUser, sdPass);

    let costUpdated = 0, costSkipped = 0, costFailed = 0;

    for (const ct of needCost) {
      try {
        // Get real weight from parcel details
        const realData = await getRealWeight(ct.awb, sdUser, sdPass);
        if (!realData) { costSkipped++; await sleep(800); continue; }

        let countyId = null, cityId = null;

        // Strategy A: Shopify order → precise city
        if (ct.orderExternalId) {
          const shopifyData = await shopifyGql(store.domain, shopifyToken, `{
            order(id: "${ct.orderExternalId}") {
              shippingAddress { city province countryCodeV2 }
            }
          }`);
          const addr = shopifyData.order?.shippingAddress;
          if (addr?.countryCodeV2 !== 'RO') { costSkipped++; await sleep(800); continue; }
          if (addr?.province) {
            const county = mapProvinceToCounty(addr.province);
            if (county) {
              countyId = county.id;
              const city = await findSamedayCity(county.id, addr.city || county.name, sdUser, sdPass);
              cityId = city?.id;
            }
          }
        }

        // Strategy B: SameDay county + capital
        if (!countyId && realData.county) {
          const county = mapProvinceToCounty(realData.county);
          if (county) {
            countyId = county.id;
            const capitalResults = await searchSamedayCity(countyId, county.name, sdUser, sdPass);
            cityId = capitalResults[0]?.id;
            if (!cityId && countyId === 1) {
              const buc = await searchSamedayCity(1, 'Sectorul 1', sdUser, sdPass);
              cityId = buc[0]?.id;
            }
          }
        }

        if (!countyId || !cityId) { costSkipped++; await sleep(800); continue; }

        const cost = await estimateCost(countyId, cityId, realData.weight, realData.cod, sdUser, sdPass);
        await prisma.courierTracking.update({ where: { id: ct.id }, data: { servicePayment: cost } });
        console.log(`  [estimate-cost] ${ct.orderNumber || ct.awb} = ${cost} RON (${realData.weight}kg)`);
        costUpdated++;
        await sleep(800);
      } catch (err) {
        console.error(`  [estimate-cost] ${ct.awb}: ERROR ${err.message}`);
        costFailed++;
        await sleep(1000);
      }
    }

    console.log(`  [estimate-cost] Done: ${costUpdated} updated, ${costSkipped} skipped, ${costFailed} failed`);
  }

  // ── Mark delivered COD orders as PAID in Shopify ──────────────────────────
  const toMarkPaid = await prisma.courierTracking.findMany({
    where: {
      storeConnectionId: store.id,
      isDelivered: true,
      isCod: true,
      shopifyPaymentMarked: false,
      orderExternalId: { not: null },
      order: { financialStatus: 'PENDING' },
    },
    select: { id: true, awb: true, orderExternalId: true, orderNumber: true, orderId: true },
  });

  if (toMarkPaid.length > 0) {
    console.log(`  [pay] ${toMarkPaid.length} COD orders to mark as PAID`);
  }

  for (const ct of toMarkPaid) {
    try {
      // First check Shopify's current financial status — skip if already paid/refunded/voided
      const liveStatus = await shopifyGql(store.domain, shopifyToken, `{
        order(id: "${ct.orderExternalId}") { id displayFinancialStatus }
      }`);
      const liveFin = liveStatus.order?.displayFinancialStatus;
      if (liveFin && liveFin !== 'PENDING' && liveFin !== 'AUTHORIZED' && liveFin !== 'PARTIALLY_PAID') {
        // Already settled in Shopify (PAID/REFUNDED/VOIDED) — mark as processed locally to stop retrying.
        await prisma.courierTracking.update({
          where: { id: ct.id },
          data: { shopifyPaymentMarked: true, shopifyMarkedAt: new Date() },
        });
        if (ct.orderId) {
          await prisma.order.update({
            where: { id: ct.orderId },
            data: { financialStatus: liveFin === 'PAID' ? 'PAID' : liveFin },
          }).catch(() => {});
        }
        console.log(`  [pay] ${ct.orderNumber} skipped (Shopify status: ${liveFin})`);
        await sleep(800);
        continue;
      }

      const result = await shopifyGql(store.domain, shopifyToken, `
        mutation {
          orderMarkAsPaid(input: { id: "${ct.orderExternalId}" }) {
            order { id displayFinancialStatus }
            userErrors { field message }
          }
        }
      `);

      const errors = result.orderMarkAsPaid?.userErrors;
      if (errors && errors.length > 0) {
        // Shopify refused — mark as processed so we don't retry forever, log only.
        await prisma.courierTracking.update({
          where: { id: ct.id },
          data: { shopifyPaymentMarked: true, shopifyMarkedAt: new Date() },
        });
        console.log(`  [pay] ${ct.orderNumber} unmarkable (${errors[0].message}) — marked processed locally`);
      } else {
        console.log(`  [pay] ${ct.orderNumber} → PAID`);
        await prisma.courierTracking.update({
          where: { id: ct.id },
          data: { shopifyPaymentMarked: true, shopifyMarkedAt: new Date() },
        });
        // Update local order too
        if (ct.orderId) {
          await prisma.order.update({
            where: { id: ct.orderId },
            data: { financialStatus: 'PAID', status: 'PAID' },
          });
        }
      }
      await sleep(2000);
    } catch (err) {
      console.error(`  [pay] ${ct.orderNumber} failed:`, err.message);
    }
  }

  // ── Mark returns in Shopify + local DB ─────────────────────────────────────
  const returnedOrders = await prisma.courierTracking.findMany({
    where: {
      storeConnectionId: store.id,
      isReturned: true,
      orderId: { not: null },
      shopifyPaymentMarked: false, // reuse flag to avoid re-processing
    },
    select: { id: true, orderId: true, orderNumber: true, orderExternalId: true },
  });

  if (returnedOrders.length > 0) {
    console.log(`  [return] ${returnedOrders.length} orders to mark as returned`);
  }

  for (const ct of returnedOrders) {
    // Mark return in Shopify via returnClose (void the order)
    if (ct.orderExternalId) {
      try {
        await shopifyGql(store.domain, shopifyToken, `
          mutation {
            orderCancel(orderId: "${ct.orderExternalId}", reason: CUSTOMER, notifyCustomer: false, refund: true, restock: true) {
              orderCancelUserErrors { field message }
            }
          }
        `);
        console.log(`  [return] ${ct.orderNumber} → cancelled in Shopify`);
      } catch (err) {
        // Order may already be cancelled/voided — that's fine
        console.log(`  [return] ${ct.orderNumber} Shopify cancel: ${err.message?.slice(0, 80)}`);
      }
      await sleep(2000);
    }

    try {
      await prisma.order.update({
        where: { id: ct.orderId },
        data: { financialStatus: 'VOIDED', fulfillmentStatus: 'RETURNED' },
      });
      await prisma.courierTracking.update({
        where: { id: ct.id },
        data: { shopifyPaymentMarked: true }, // mark as processed
      });
    } catch {}
  }

  // ── HU live events via xb-status-sync (replaces deprecated per-AWB calls) ─
  let xbResult = { processed: 0, delivered: 0, returned: 0 };
  try {
    xbResult = await syncXbStatusSync(store, sdUser, sdPass);
  } catch (err) {
    console.error('  [xb-status-sync] failed:', err.message);
  }

  // ── HU backfill (Shopify match + cost calc for AWBs not seen via xb-sync) ─
  let huResult = { huProcessed: 0, huDelivered: 0, huReturned: 0 };
  try {
    huResult = await syncHuOrders(store, sdUser, sdPass, shopifyToken);
  } catch (err) {
    console.error('  [hu] sync failed:', err.message);
  }

  return {
    totalProcessed: totalProcessed + xbResult.processed + huResult.huProcessed,
    newDelivered: newDelivered + xbResult.delivered + huResult.huDelivered,
    newReturned: newReturned + xbResult.returned + huResult.huReturned,
    matched: unmatched.length,
    paid: toMarkPaid.length,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[sameday] ${new Date().toISOString()} starting`);

  if (!SAMEDAY_USER || !SAMEDAY_PASS) {
    console.error('[sameday] SAMEDAY_USERNAME/PASSWORD not set, exiting.');
    return;
  }

  // Find Shopify stores that have tracking (vivimall for now, expand later)
  const stores = await prisma.storeConnection.findMany({
    where: { platform: 'SHOPIFY', isActive: true, shopifyAccessToken: { not: null } },
    select: { id: true, name: true, domain: true, shopifyAccessToken: true, settings: { select: { courierUsername: true, courierPassword: true, courierProvider: true, shippingCostIntl: true, shippingChargeToCustomerIntl: true } } },
  });

  for (const store of stores) {
    console.log(`[${store.name}] syncing courier data...`);
    try {
      const result = await syncSameDay(store);
      console.log(`[${store.name}] done: ${result.totalProcessed} events, ${result.newDelivered} delivered, ${result.newReturned} returned`);
    } catch (err) {
      console.error(`[${store.name}] FAILED:`, err.message);
    }
  }

  console.log('[sameday] done');
}

main()
  .catch(e => { console.error('[sameday]', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
