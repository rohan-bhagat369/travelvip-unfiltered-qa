/**
 * Sanity: Node (dev-nova-api) vs existing Dev API for Flight / Hotel / Cab.
 * Usage: node other/_scratch/nova-php-sanity-compare.mjs
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function loadEnv() {
  const env = {};
  const p = path.join(ROOT, '.env');
  if (!fs.existsSync(p)) return env;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v;
    env[m[1].toUpperCase()] = v;
  }
  return env;
}

function loadPostmanDevEnv() {
  const candidates = [
    path.join(ROOT, 'postman/share/nova-api_dev.json'),
    path.join(
      process.env.USERPROFILE || '',
      '.cursor/projects/d-Travel-VIP-API-Automation/attachments/9d27dee5-d0e7-4eb0-8b3a-c34ea217457a/nova-api_dev.json',
    ),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      const vars = j.environments?.[0]?.variables || j.values || [];
      const out = {};
      for (const v of vars) {
        if (!v?.name) continue;
        out[v.name] = v.value ?? v.initialValue ?? '';
        out[String(v.name).toUpperCase()] = v.value ?? v.initialValue ?? '';
      }
      return out;
    } catch {
      /* ignore */
    }
  }
  return {};
}

const fileEnv = { ...loadPostmanDevEnv(), ...loadEnv() };
const PARTNER_ID = process.env.PARTNER_ID || fileEnv.PARTNER_ID || fileEnv.partner_id || 'vgm';
const PARTNER_SECRET = process.env.PARTNER_SECRET || fileEnv.PARTNER_SECRET || fileEnv.partner_secret;
const SIGNING_KEY = process.env.SIGNING_KEY || fileEnv.SIGNING_KEY || fileEnv.signing_key;
const TIER_ID = Number(process.env.TIER_ID || fileEnv.TIER_ID || fileEnv.tier_id || 10546901);

const NODE_BASE = process.env.NODE_BASE || 'https://dev-nova-api.travelvip.ai';
const LEGACY_BASE = process.env.LEGACY_BASE || process.env.EXISTING_DEV_BASE || 'https://canary-api.travelvip.ai';
const FALLBACK_LEGACY = process.env.FALLBACK_LEGACY || 'https://api-staging.travelvip.ai';

function sign(body, ts, key) {
  return crypto.createHmac('sha256', key).update(`${body || ''}${ts}`).digest('hex');
}
function rid() {
  return `sanity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function ts() {
  return Math.floor(Date.now() / 1000).toString();
}

async function call(base, { method = 'GET', path: p, body, authToken, partnerKey, signed = true, auth = true }) {
  const bodyStr = body === undefined ? '' : JSON.stringify(body);
  const timestamp = ts();
  const headers = {
    'Content-Type': 'application/json',
    'X-Request-Id': rid(),
    'X-Correlation-ID': rid(),
  };
  if (signed && SIGNING_KEY) {
    headers['X-Timestamp'] = timestamp;
    headers['X-Signature'] = sign(bodyStr, timestamp, SIGNING_KEY);
  }
  if (auth && authToken) headers.Authorization = `Bearer ${authToken}`;
  if (partnerKey) headers['X-Partner-Key'] = partnerKey;

  const url = `${base}${p}`;
  const started = Date.now();
  let status = 0;
  let data = null;
  let err = null;
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : bodyStr,
    });
    status = res.status;
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { _raw: text?.slice(0, 500) };
    }
  } catch (e) {
    err = String(e.message || e);
  }
  return { base, method, path: p, status, ms: Date.now() - started, data, err, ok: status >= 200 && status < 300 };
}

async function authOn(base) {
  const tokenRes = await call(base, {
    method: 'POST',
    path: '/auth/partner/token',
    body: { partner_id: PARTNER_ID, partner_secret: PARTNER_SECRET },
    signed: false,
    auth: false,
  });
  if (!tokenRes.ok) {
    return { ok: false, tokenRes, sessionRes: null };
  }
  const access = tokenRes.data?.access_token;
  const sessionRes = await call(base, {
    method: 'POST',
    path: '/v1/auth/session',
    body: { tierId: TIER_ID },
    signed: false,
    auth: false,
    partnerKey: access,
  });
  return {
    ok: sessionRes.ok,
    tokenRes,
    sessionRes,
    accessToken: access,
    authToken: sessionRes.data?.auth_token,
  };
}

function topKeys(obj, max = 25) {
  if (!obj || typeof obj !== 'object') return [];
  return Object.keys(obj).slice(0, max);
}

function shapeDiff(a, b, prefix = '') {
  const diffs = [];
  const aObj = a && typeof a === 'object' && !Array.isArray(a);
  const bObj = b && typeof b === 'object' && !Array.isArray(b);
  if (aObj && bObj) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const p = prefix ? `${prefix}.${k}` : k;
      const ha = Object.prototype.hasOwnProperty.call(a, k);
      const hb = Object.prototype.hasOwnProperty.call(b, k);
      if (ha && !hb) diffs.push({ path: p, issue: 'missing_in_node', legacyType: typeOf(a[k]) });
      else if (!ha && hb) diffs.push({ path: p, issue: 'extra_in_node', nodeType: typeOf(b[k]) });
      else if (typeOf(a[k]) !== typeOf(b[k])) {
        diffs.push({ path: p, issue: 'type_mismatch', legacyType: typeOf(a[k]), nodeType: typeOf(b[k]) });
      } else if (aObj && typeof a[k] === 'object' && a[k] && b[k] && !Array.isArray(a[k]) && prefix.split('.').length < 2) {
        diffs.push(...shapeDiff(a[k], b[k], p));
      }
    }
  } else if (typeOf(a) !== typeOf(b)) {
    diffs.push({ path: prefix || '$', issue: 'type_mismatch', legacyType: typeOf(a), nodeType: typeOf(b) });
  }
  return diffs;
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function futureDate(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function futureIso(days, hour = 10) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

async function main() {
  if (!PARTNER_SECRET || !SIGNING_KEY) {
    console.error('Missing PARTNER_SECRET / SIGNING_KEY');
    process.exit(1);
  }

  console.log('NODE   ', NODE_BASE);
  console.log('LEGACY ', LEGACY_BASE);
  console.log('Partner', PARTNER_ID, 'tier', TIER_ID);

  let legacyBase = LEGACY_BASE;
  let legacyAuth = await authOn(legacyBase);
  if (!legacyAuth.ok) {
    console.log(`Legacy auth failed on ${legacyBase} (${legacyAuth.tokenRes.status}/${legacyAuth.sessionRes?.status}) → try ${FALLBACK_LEGACY}`);
    legacyBase = FALLBACK_LEGACY;
    legacyAuth = await authOn(legacyBase);
  }
  const nodeAuth = await authOn(NODE_BASE);

  // Tiers list (partner key only) — useful when session mint fails on Node
  const nodeTiers = await call(NODE_BASE, {
    method: 'GET',
    path: '/v1/tiers',
    signed: false,
    auth: false,
    partnerKey: nodeAuth.accessToken || nodeAuth.tokenRes?.data?.access_token,
  });
  const legacyTiers = await call(legacyBase, {
    method: 'GET',
    path: '/v1/tiers',
    signed: false,
    auth: false,
    partnerKey: legacyAuth.accessToken,
  });

  let nodeAuthToken = nodeAuth.authToken;
  let nodeAuthNote = 'native_session';
  if (!nodeAuth.ok && legacyAuth.ok) {
    // Observed: Node GET /v1/tiers returns 10546901 but POST /v1/auth/session → Invalid tierId.
    // Product routes on Node accept a canary-minted auth_token + Node partner access_token.
    nodeAuthToken = legacyAuth.authToken;
    nodeAuthNote = `fallback_legacy_jwt (node session ${nodeAuth.sessionRes?.status}: ${nodeAuth.sessionRes?.data?.message || nodeAuth.sessionRes?.data?.code})`;
    console.warn('WARN: Node session failed; using legacy-minted auth_token for Node product calls.');
  }

  const authSummary = {
    node: {
      token: nodeAuth.tokenRes.status,
      session: nodeAuth.sessionRes?.status,
      ok: nodeAuth.ok,
      tokenKeys: topKeys(nodeAuth.tokenRes.data),
      sessionKeys: topKeys(nodeAuth.sessionRes?.data),
      sessionMessage: nodeAuth.sessionRes?.data?.message || null,
      tiersStatus: nodeTiers.status,
      tierIds: Array.isArray(nodeTiers.data) ? nodeTiers.data.map((t) => t.tierId) : null,
      productAuth: nodeAuthNote,
    },
    legacy: {
      base: legacyBase,
      token: legacyAuth.tokenRes.status,
      session: legacyAuth.sessionRes?.status,
      ok: legacyAuth.ok,
      tokenKeys: topKeys(legacyAuth.tokenRes.data),
      sessionKeys: topKeys(legacyAuth.sessionRes?.data),
      tiersStatus: legacyTiers.status,
      tierIds: Array.isArray(legacyTiers.data) ? legacyTiers.data.map((t) => t.tierId) : null,
    },
  };
  console.log('\nAUTH', JSON.stringify(authSummary, null, 2));

  if (!legacyAuth.ok || !nodeAuthToken || !(nodeAuth.accessToken || nodeAuth.tokenRes?.data?.access_token)) {
    const out = { verdict: 'BLOCKED_AUTH', authSummary, at: new Date().toISOString() };
    const outPath = path.join(ROOT, 'other/_scratch/nova-php-sanity-report.json');
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
    console.error('Auth failed — cannot continue product sanity');
    process.exit(2);
  }

  const nodePartnerKey = nodeAuth.accessToken || nodeAuth.tokenRes?.data?.access_token;

  const checkIn = futureDate(20);
  const checkOut = futureDate(22);
  const flightDate = futureDate(25);
  const cabPickup = futureIso(10, 12);

  const cabPickupZ = cabPickup.replace(/\.\d{3}Z$/, 'Z');

  const cases = [
    {
      id: 'flight.airports',
      method: 'GET',
      path: '/v1/flights/airports?lang=en&currency=INR&airport=BOM&page=0&perpage=10',
    },
    {
      id: 'flight.citySearch',
      method: 'GET',
      path: '/v1/flights/citySearch?lang=en&currency=INR&q=Pune&page=0&perpage=10',
    },
    {
      id: 'flight.search',
      method: 'POST',
      path: '/v1/flights/search?lang=en&currency=INR&page=0&perpage=20',
      body: {
        itinerary: [{ origin: 'DEL', destination: 'BOM', date: flightDate }],
        travellers: { adults: 1, children: 0, infants: 0 },
        cabinClass: 'ECONOMY',
        journeyType: 'ONE_WAY',
        currency: 'INR',
        language: 'en',
        preferences: { airlines: [], maxStops: 2, refundableOnly: false },
        appliedFilters: {},
        selection: { selectedSearchIds: [] },
      },
    },
    {
      id: 'hotel.autocomplete',
      method: 'GET',
      path: '/v1/hotels/autocomplete?lang=en&currency=INR&page=0&perpage=20&q=mumbai',
    },
    {
      id: 'hotel.search',
      method: 'POST',
      path: '/v1/hotels/search?currency=INR&page=0&perpage=20&lang=en',
      body: {
        checkin: checkIn,
        checkout: checkOut,
        entityId: '357389:IN',
        nationality: 'IN',
        type: 'CITY',
        rooms: [{ adults: 2, children: 0, childrenAges: [] }],
      },
    },
    {
      id: 'cab.locations',
      method: 'GET',
      path: '/v1/airportServices/cabs/locations?lang=en&query=Pune',
    },
    {
      id: 'cab.search',
      method: 'POST',
      path: '/v1/airportServices/cabs/search?lang=en&currency=INR',
      body: {
        journeyType: 'RENTAL',
        travelType: 'DEPARTURE',
        pickup: {
          name: 'Keshav Nagar, Pune',
          city: 'Pune',
          latitude: 18.5518,
          longitude: 73.9467,
        },
        drop: {
          name: 'Keshav Nagar, Pune',
          city: 'Pune',
          latitude: 18.5518,
          longitude: 73.9467,
        },
        distanceKm: 20,
        durationMin: 120,
        pickupDatetime: cabPickupZ,
      },
    },
  ];

  const results = [];
  for (const c of cases) {
    const legacy = await call(legacyBase, {
      ...c,
      authToken: legacyAuth.authToken,
      partnerKey: legacyAuth.accessToken,
    });
    const node = await call(NODE_BASE, {
      ...c,
      authToken: nodeAuthToken,
      partnerKey: nodePartnerKey,
    });

    const legacyErr = legacy.data?.error || null;
    const nodeErr = node.data?.error || null;
    const diffs = shapeDiff(
      legacy.data && typeof legacy.data === 'object' ? legacy.data : { value: legacy.data },
      node.data && typeof node.data === 'object' ? node.data : { value: node.data },
    ).slice(0, 40);

    const row = {
      id: c.id,
      method: c.method,
      path: c.path.split('?')[0],
      legacy: {
        status: legacy.status,
        ms: legacy.ms,
        ok: legacy.ok,
        topKeys: topKeys(legacy.data),
        errorCode: legacyErr?.code || null,
        errorMessage: legacyErr?.message || null,
        errorDetails: legacyErr?.details || null,
      },
      node: {
        status: node.status,
        ms: node.ms,
        ok: node.ok,
        topKeys: topKeys(node.data),
        errorCode: nodeErr?.code || null,
        errorMessage: nodeErr?.message || null,
        errorDetails: nodeErr?.details || null,
      },
      statusMatch: legacy.status === node.status,
      bothOk: legacy.ok && node.ok,
      shapeDiffs: diffs,
      sample: {
        legacySnippet: JSON.stringify(legacy.data)?.slice(0, 280),
        nodeSnippet: JSON.stringify(node.data)?.slice(0, 280),
      },
    };
    results.push(row);
    const flag = row.bothOk ? 'PASS' : row.statusMatch ? 'WARN' : 'DIFF';
    console.log(`\n[${flag}] ${c.id}  legacy=${legacy.status} node=${node.status}  diffs=${diffs.length}`);
    if (diffs.length) console.log('  shape:', diffs.slice(0, 8).map((d) => `${d.path}:${d.issue}`).join(', '));
    if (legacyErr || nodeErr) {
      console.log('  legacyErr', legacyErr?.code, legacyErr?.message);
      console.log('  nodeErr   ', nodeErr?.code, nodeErr?.message);
    }
  }

  const summary = {
    at: new Date().toISOString(),
    nodeBase: NODE_BASE,
    legacyBase,
    partner: PARTNER_ID,
    authSummary,
    results,
    discrepancies: results.filter((r) => !r.bothOk || r.shapeDiffs.length > 0 || !r.statusMatch),
  };

  const outDir = path.join(ROOT, 'other/_scratch');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'nova-php-sanity-report.json');
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log('\nWrote', outPath);
  console.log(
    'Summary:',
    results.filter((r) => r.bothOk).length,
    'both OK /',
    results.length,
    '| discrepancies',
    summary.discrepancies.length,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
