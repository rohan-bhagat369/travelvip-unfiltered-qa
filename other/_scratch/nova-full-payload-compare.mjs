/**
 * Full Flight/Hotel/Cab request+response parity: Node vs Canary.
 * Uses Postman nova-api collection sample payloads (+ live chaining where possible).
 * Skips live finalize/issue-ticket creates unless ALLOW_BOOK=1.
 *
 * Usage: node other/_scratch/nova-full-payload-compare.mjs
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const ALLOW_BOOK = process.env.ALLOW_BOOK === '1';

const COLLECTION = path.join(
  process.env.USERPROFILE || '',
  '.cursor/projects/d-Travel-VIP-API-Automation/attachments/9d27dee5-d0e7-4eb0-8b3a-c34ea217457a/nova-api.postman_collection.json',
);
const POSTMAN_ENV = path.join(
  process.env.USERPROFILE || '',
  '.cursor/projects/d-Travel-VIP-API-Automation/attachments/9d27dee5-d0e7-4eb0-8b3a-c34ea217457a/nova-api_dev.json',
);

function loadPostmanEnv() {
  const j = JSON.parse(fs.readFileSync(POSTMAN_ENV, 'utf8'));
  const out = {};
  for (const v of j.environments?.[0]?.variables || []) {
    out[v.name] = v.value ?? v.initialValue ?? '';
  }
  return out;
}

const env = loadPostmanEnv();
const PARTNER_ID = env.partner_id || 'vgm';
const PARTNER_SECRET = env.partner_secret;
const SIGNING_KEY = env.signing_key;
const TIER_ID = Number(env.tier_id || 10546901);
const NODE_BASE = 'https://dev-nova-api.travelvip.ai';
const LEGACY_BASE = 'https://canary-api.travelvip.ai';

function sign(body, ts) {
  return crypto.createHmac('sha256', SIGNING_KEY).update(`${body || ''}${ts}`).digest('hex');
}
function rid() {
  return `full-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
function futureDate(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function futureIsoZ(days, hour = 12) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
function topKeys(obj, n = 30) {
  if (!obj || typeof obj !== 'object') return [];
  return Object.keys(obj).slice(0, n);
}
function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}
function shapeDiff(a, b, prefix = '', depth = 0) {
  const diffs = [];
  if (depth > 2) return diffs;
  const aObj = a && typeof a === 'object' && !Array.isArray(a);
  const bObj = b && typeof b === 'object' && !Array.isArray(b);
  if (!aObj || !bObj) {
    if (typeOf(a) !== typeOf(b)) diffs.push({ path: prefix || '$', issue: 'type_mismatch', legacy: typeOf(a), node: typeOf(b) });
    return diffs;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const p = prefix ? `${prefix}.${k}` : k;
    const ha = Object.prototype.hasOwnProperty.call(a, k);
    const hb = Object.prototype.hasOwnProperty.call(b, k);
    if (ha && !hb) diffs.push({ path: p, issue: 'missing_in_node', legacy: typeOf(a[k]) });
    else if (!ha && hb) diffs.push({ path: p, issue: 'extra_in_node', node: typeOf(b[k]) });
    else if (typeOf(a[k]) !== typeOf(b[k])) diffs.push({ path: p, issue: 'type_mismatch', legacy: typeOf(a[k]), node: typeOf(b[k]) });
    else if (a[k] && typeof a[k] === 'object' && !Array.isArray(a[k]) && depth < 2) diffs.push(...shapeDiff(a[k], b[k], p, depth + 1));
  }
  return diffs;
}

async function call(base, { method = 'GET', path: p, body, authToken, partnerKey, signed = true }) {
  const bodyStr = body === undefined || body === null ? '' : JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const headers = {
    'Content-Type': 'application/json',
    'X-Request-Id': rid(),
    'X-Correlation-ID': rid(),
  };
  if (signed) {
    headers['X-Timestamp'] = timestamp;
    headers['X-Signature'] = sign(bodyStr, timestamp);
  }
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  if (partnerKey) headers['X-Partner-Key'] = partnerKey;

  const started = Date.now();
  try {
    const res = await fetch(`${base}${p}`, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : bodyStr || undefined,
      signal: AbortSignal.timeout(120000),
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { _raw: text.slice(0, 400) };
    }
    return { status: res.status, ms: Date.now() - started, data, ok: res.status >= 200 && res.status < 300 };
  } catch (e) {
    return { status: 0, ms: Date.now() - started, data: { error: { code: 'CLIENT_ERROR', message: String(e.message || e) } }, ok: false };
  }
}

async function authHop(base) {
  const tokenRes = await call(base, {
    method: 'POST',
    path: '/auth/partner/token',
    body: { partner_id: PARTNER_ID, partner_secret: PARTNER_SECRET },
    signed: false,
  });
  const access = tokenRes.data?.access_token;
  const sessionRes = await call(base, {
    method: 'POST',
    path: '/v1/auth/session',
    body: { tierId: TIER_ID },
    partnerKey: access,
    signed: false,
  });
  return {
    ok: sessionRes.ok,
    access,
    authToken: sessionRes.data?.auth_token,
    tokenStatus: tokenRes.status,
    sessionStatus: sessionRes.status,
    sessionMsg: sessionRes.data?.message || sessionRes.data?.code,
  };
}

function walkCollection() {
  const col = JSON.parse(fs.readFileSync(COLLECTION, 'utf8'));
  const out = [];
  function walk(items, prefix = []) {
    for (const it of items || []) {
      const name = [...prefix, it.name].filter(Boolean);
      if (it.item) walk(it.item, name);
      else if (it.request) {
        const url = it.request.url || {};
        const p = Array.isArray(url.path) ? `/${url.path.join('/')}` : '';
        const query = (url.query || [])
          .filter((q) => q && !q.disabled)
          .map((q) => `${q.key}=${q.value ?? ''}`)
          .join('&');
        let body = null;
        if (it.request.body?.raw) {
          try {
            body = JSON.parse(it.request.body.raw);
          } catch {
            body = null;
          }
        }
        const folder = name[0] || '';
        const blob = `${folder} ${p} ${name.join(' ')}`;
        if (!/flight|hotel|cab|airportServices/i.test(blob)) continue;
        out.push({
          id: name.join(' > '),
          folder,
          method: it.request.method,
          path: p,
          query,
          body,
        });
      }
    }
  }
  walk(col.item);
  return out;
}

function substVars(str) {
  if (!str) return str;
  return str.replace(/\{\{(\w+)\}\}/g, (_, k) => env[k] ?? '');
}

function isDestructive(row) {
  const p = row.path.toLowerCase();
  const n = row.id.toLowerCase();
  if (/finalize-booking|issue-ticket/.test(p)) return true;
  if (/finalize booking|issue flight ticket|^cabs > book$/i.test(n)) return true;
  return false;
}

function isCallback(row) {
  return /callback|webhook|request-action|supplier-recovery|protection-action|updateBooking|updateHotelBooking|update-booking|partner-webhook/i.test(
    row.id + row.path,
  );
}

function dedupeKey(row) {
  return `${row.method} ${row.path}`;
}

async function main() {
  if (!PARTNER_SECRET || !SIGNING_KEY) {
    console.error('Missing partner_secret / signing_key from Postman env');
    process.exit(1);
  }

  console.log('NODE  ', NODE_BASE);
  console.log('LEGACY', LEGACY_BASE);
  console.log('ALLOW_BOOK', ALLOW_BOOK);

  const legacyAuth = await authHop(LEGACY_BASE);
  const nodeAuth = await authHop(NODE_BASE);
  let nodeAuthToken = nodeAuth.authToken;
  let authNote = 'native';
  if (!nodeAuth.ok && legacyAuth.ok) {
    nodeAuthToken = legacyAuth.authToken;
    authNote = `fallback_legacy_jwt (node session ${nodeAuth.sessionStatus}: ${nodeAuth.sessionMsg})`;
    console.warn('WARN:', authNote);
  }
  if (!legacyAuth.ok || !nodeAuthToken || !nodeAuth.access) {
    console.error('Auth blocked', { legacyAuth, nodeAuth });
    process.exit(2);
  }

  const ctx = {
    flightDate: futureDate(28),
    hotelIn: futureDate(30),
    hotelOut: futureDate(32),
    cabPickup: futureIsoZ(14, 12),
    flightSearchId: null,
    flightPriceId: null,
    hotelEntityId: '357389:IN',
    hotelBookingCode: null,
    hotelRequestId: null,
    cabSearchId: null,
    cabPriceId: null,
  };

  // --- seed chains ---
  const flightSearchBody = {
    itinerary: [{ origin: 'DEL', destination: 'BOM', date: ctx.flightDate }],
    travellers: { adults: 1, children: 0, infants: 0 },
    cabinClass: 'ECONOMY',
    journeyType: 'ONE_WAY',
    currency: 'INR',
    language: 'en',
    preferences: { airlines: [], maxStops: 2, refundableOnly: false },
    appliedFilters: {},
    selection: { selectedSearchIds: [] },
  };
  const fpath = `/v1/flights/search?lang=en&currency=INR&page=0&perpage=10`;
  const nodeFlight = await call(NODE_BASE, {
    method: 'POST',
    path: fpath,
    body: flightSearchBody,
    authToken: nodeAuthToken,
    partnerKey: nodeAuth.access,
  });
  const legacyFlight = await call(LEGACY_BASE, {
    method: 'POST',
    path: fpath,
    body: flightSearchBody,
    authToken: legacyAuth.authToken,
    partnerKey: legacyAuth.access,
  });
  const opt = nodeFlight.data?.results?.[0]?.options?.[0];
  ctx.flightSearchId = opt?.searchId || null;
  console.log('seed flight search node', nodeFlight.status, 'searchId', !!ctx.flightSearchId, '| legacy', legacyFlight.status, legacyFlight.data?.error?.code);

  // hotel seed
  const hSearchBody = {
    checkin: ctx.hotelIn,
    checkout: ctx.hotelOut,
    entityId: ctx.hotelEntityId,
    nationality: 'IN',
    type: 'CITY',
    rooms: [{ adults: 2, children: 0, childrenAges: [] }],
  };
  const nodeHotel = await call(NODE_BASE, {
    method: 'POST',
    path: '/v1/hotels/search?currency=INR&page=0&perpage=5&lang=en',
    body: hSearchBody,
    authToken: nodeAuthToken,
    partnerKey: nodeAuth.access,
  });
  const hotelId = nodeHotel.data?.results?.[0]?.id;
  console.log('seed hotel search node', nodeHotel.status, 'hotelId', hotelId, 'total', nodeHotel.data?.totalResults);

  if (hotelId) {
    const det = await call(NODE_BASE, {
      method: 'POST',
      path: '/v1/hotels/details?lang=en&currency=INR&page=0&perpage=20',
      body: {
        checkin: ctx.hotelIn,
        checkout: ctx.hotelOut,
        entityId: String(hotelId),
        nationality: 'IN',
        rooms: [{ adults: 2, children: 0, childrenAges: [] }],
      },
      authToken: nodeAuthToken,
      partnerKey: nodeAuth.access,
    });
    // bookingCode / requestId locations vary by schema
    const room = det.data?.rooms?.[0] || det.data?.results?.[0] || det.data?.hotel?.rooms?.[0];
    ctx.hotelBookingCode = room?.bookingCode || room?.rate?.bookingCode || det.data?.bookingCode || null;
    ctx.hotelRequestId = det.data?.requestId || det.data?.request_id || nodeHotel.data?.requestId || null;
    console.log('seed hotel details', det.status, 'bookingCode', !!ctx.hotelBookingCode, 'requestId', !!ctx.hotelRequestId);
  }

  // cab seed
  const cabBody = {
    journeyType: 'RENTAL',
    travelType: 'DEPARTURE',
    pickup: { name: 'Keshav Nagar, Pune', city: 'Pune', latitude: 18.5518, longitude: 73.9467 },
    drop: { name: 'Keshav Nagar, Pune', city: 'Pune', latitude: 18.5518, longitude: 73.9467 },
    distanceKm: 20,
    durationMin: 120,
    pickupDatetime: ctx.cabPickup,
  };
  const nodeCab = await call(NODE_BASE, {
    method: 'POST',
    path: '/v1/airportServices/cabs/search?lang=en&currency=INR',
    body: cabBody,
    authToken: nodeAuthToken,
    partnerKey: nodeAuth.access,
  });
  ctx.cabSearchId = nodeCab.data?.cabs?.[0]?.searchId || null;
  console.log('seed cab search node', nodeCab.status, 'searchId', !!ctx.cabSearchId);

  // Build cases from collection (unique method+path), with refreshed bodies
  const raw = walkCollection();
  const seen = new Set();
  const cases = [];

  for (const row of raw) {
    const key = dedupeKey(row);
    // keep first occurrence of each method+path (except allow cancel variants once)
    if (seen.has(key) && !/cancel/i.test(row.path)) continue;
    if (seen.has(key)) continue;
    seen.add(key);

    const query = substVars(row.query);
    let body = row.body ? JSON.parse(JSON.stringify(row.body)) : null;
    let note = 'collection_sample';
    let skip = false;
    let skipReason = null;

    if (isDestructive(row) && !ALLOW_BOOK) {
      skip = true;
      skipReason = 'destructive_book_skipped (set ALLOW_BOOK=1 to run)';
    }
    if (isCallback(row)) {
      const q = query || '';
      if (/key=$|key=\s|&key=&/.test(`&${q}&`) || q.includes('{{') || (!env.callback_key && /callback_key|pid=/.test(q + JSON.stringify(body || {})))) {
        // still call — compare auth/validation envelopes; mark note
        note = 'callback_ops_sample';
      }
    }

    // refresh dates / chained ids
    if (row.path === '/v1/flights/search' && body) {
      body.itinerary = [{ origin: 'DEL', destination: 'BOM', date: ctx.flightDate }];
      delete body.fareType;
      body.preferences = { airlines: [], maxStops: 2, refundableOnly: false };
      note = 'live_dates';
    }
    if (['/v1/flights/details', '/v1/flights/fareRules', '/v1/flights/pricing'].includes(row.path)) {
      if (!ctx.flightSearchId) {
        skip = true;
        skipReason = 'no_flight_searchId (node search empty/failed)';
      } else {
        body = {
          journeyType: 'ONE_WAY',
          selection: { selectedSearchIds: [ctx.flightSearchId] },
        };
        note = 'chained_from_node_search';
      }
    }
    if (row.path === '/v1/flights/ssr') {
      if (!ctx.flightSearchId) {
        skip = true;
        skipReason = 'no_flight_searchId_for_ssr';
      } else {
        // pricing first if needed — try searchId as priceId fallback; real priceId from pricing
        body = { priceId: ctx.flightPriceId || ctx.flightSearchId };
        note = 'chained_priceId_or_searchId';
      }
    }
    if (row.path === '/v1/flights/seatmap') {
      body = {
        currency: 'INR',
        requestReference: ctx.flightSearchId || body?.requestReference || 'missing',
        passengers: body?.passengers || [{ type: 'ADT', count: 1 }],
      };
      note = 'chained_requestReference';
    }
    if (row.path === '/v1/hotels/autocomplete') {
      note = 'page0_mumbai';
    }
    if (row.path === '/v1/hotels/search' && body) {
      Object.assign(body, hSearchBody);
      note = 'live_city_mumbai';
    }
    if (row.path === '/v1/hotels/details' && body) {
      body.checkin = ctx.hotelIn;
      body.checkout = ctx.hotelOut;
      body.entityId = String(hotelId || body.entityId);
      body.nationality = 'IN';
      body.rooms = [{ adults: 2, children: 0, childrenAges: [] }];
      note = hotelId ? 'chained_hotel_id' : 'collection_entity';
    }
    if (row.path === '/v1/hotels/prebook' && body) {
      if (ctx.hotelBookingCode && ctx.hotelRequestId) {
        body.bookingCode = ctx.hotelBookingCode;
        body.requestId = ctx.hotelRequestId;
        note = 'chained_prebook';
      } else {
        note = 'stale_collection_prebook_ids';
      }
    }
    if (row.path === '/v1/airportServices/cabs/search' && body) {
      Object.assign(body, cabBody);
      note = 'live_rental';
    }
    if (row.path === '/v1/airportServices/cabs/fare' && body) {
      if (!ctx.cabSearchId) {
        skip = true;
        skipReason = 'no_cab_searchId';
      } else {
        body = { searchId: ctx.cabSearchId };
        note = 'chained_cab_searchId';
      }
    }

    let fullPath = row.path;
    if (row.path === '/v1/hotels/autocomplete') {
      fullPath = '/v1/hotels/autocomplete?lang=en&currency=INR&page=0&perpage=20&q=mumbai';
    } else if (query) {
      fullPath = `${row.path}?${query}`;
    }

    // strip empty template query leftovers for callbacks
    fullPath = fullPath.replace(/\{\{[^}]+\}\}/g, '');

    cases.push({
      id: row.id,
      folder: /flight/i.test(row.path + row.folder)
        ? 'Flight'
        : /hotel/i.test(row.path + row.folder)
          ? 'Hotel'
          : /cab|airportServices/i.test(row.path + row.folder)
            ? 'Cab'
            : 'Other',
      method: row.method,
      path: row.path,
      fullPath,
      body,
      note,
      skip,
      skipReason,
      requestKeys: body ? Object.keys(body) : [],
      destructive: isDestructive(row),
      callback: isCallback(row),
    });
  }

  // pricing chain: if we have searchId, call pricing on node to get priceId for SSR
  if (ctx.flightSearchId) {
    const pr = await call(NODE_BASE, {
      method: 'POST',
      path: '/v1/flights/pricing?lang=en&currency=INR',
      body: { journeyType: 'ONE_WAY', selection: { selectedSearchIds: [ctx.flightSearchId] } },
      authToken: nodeAuthToken,
      partnerKey: nodeAuth.access,
    });
    ctx.flightPriceId =
      pr.data?.priceId ||
      pr.data?.pricingId ||
      pr.data?.data?.priceId ||
      pr.data?.fares?.[0]?.priceId ||
      null;
    console.log('seed flight pricing', pr.status, 'priceId', !!ctx.flightPriceId);
    for (const c of cases) {
      if (c.path === '/v1/flights/ssr' && ctx.flightPriceId) {
        c.body = { priceId: ctx.flightPriceId };
        c.note = 'chained_priceId';
        c.skip = false;
        c.skipReason = null;
      }
    }
  }

  const results = [];
  for (const c of cases) {
    if (c.skip) {
      const row = {
        id: c.id,
        folder: c.folder,
        method: c.method,
        path: c.path,
        requestKeys: c.requestKeys,
        note: c.note,
        status: 'SKIPPED',
        skipReason: c.skipReason,
      };
      results.push(row);
      console.log(`[SKIP] ${c.folder} ${c.method} ${c.path} — ${c.skipReason}`);
      continue;
    }

    const legacy = await call(LEGACY_BASE, {
      method: c.method,
      path: c.fullPath,
      body: c.body,
      authToken: legacyAuth.authToken,
      partnerKey: legacyAuth.access,
    });
    const node = await call(NODE_BASE, {
      method: c.method,
      path: c.fullPath,
      body: c.body,
      authToken: nodeAuthToken,
      partnerKey: nodeAuth.access,
    });

    const lErr = legacy.data?.error || (legacy.data?.status === 'error' ? legacy.data : null);
    const nErr = node.data?.error || (node.data?.status === 'error' ? node.data : null);
    const diffs = shapeDiff(legacy.data || {}, node.data || {}).slice(0, 40);
    const statusMatch = legacy.status === node.status;
    const codeMatch = (lErr?.code || null) === (nErr?.code || null);
    let verdict = 'PASS';
    if (!statusMatch || (!legacy.ok && !node.ok && !codeMatch) || (legacy.ok && node.ok && diffs.length > 0)) {
      if (statusMatch && !legacy.ok && !node.ok && codeMatch && diffs.length === 0) verdict = 'PASS';
      else if (statusMatch && legacy.ok && node.ok && diffs.length === 0) verdict = 'PASS';
      else if (statusMatch && !legacy.ok && !node.ok && codeMatch) verdict = diffs.length ? 'WARN' : 'PASS';
      else verdict = statusMatch ? 'WARN' : 'DIFF';
    }
    if (legacy.ok && node.ok && diffs.length === 0) verdict = 'PASS';
    if (legacy.ok && node.ok && diffs.length > 0) verdict = 'WARN';
    if (!statusMatch) verdict = 'DIFF';
    if (!legacy.ok && !node.ok && statusMatch && codeMatch) verdict = diffs.length ? 'WARN' : 'PASS';

    const row = {
      id: c.id,
      folder: c.folder,
      method: c.method,
      path: c.path,
      requestKeys: c.body ? Object.keys(c.body) : [],
      note: c.note,
      legacy: {
        status: legacy.status,
        ok: legacy.ok,
        ms: legacy.ms,
        topKeys: topKeys(legacy.data),
        errorCode: lErr?.code || null,
        errorMessage: lErr?.message || null,
      },
      node: {
        status: node.status,
        ok: node.ok,
        ms: node.ms,
        topKeys: topKeys(node.data),
        errorCode: nErr?.code || null,
        errorMessage: nErr?.message || null,
      },
      statusMatch,
      codeMatch,
      shapeDiffs: diffs,
      verdict,
      sample: {
        legacy: JSON.stringify(legacy.data)?.slice(0, 220),
        node: JSON.stringify(node.data)?.slice(0, 220),
      },
    };
    results.push(row);
    console.log(
      `[${verdict}] ${c.folder} ${c.method} ${c.path}  L=${legacy.status}${lErr?.code ? '/' + lErr.code : ''} N=${node.status}${nErr?.code ? '/' + nErr.code : ''} diffs=${diffs.length}`,
    );
  }

  const summary = {
    at: new Date().toISOString(),
    nodeBase: NODE_BASE,
    legacyBase: LEGACY_BASE,
    partner: PARTNER_ID,
    auth: {
      node: { token: nodeAuth.tokenStatus, session: nodeAuth.sessionStatus, msg: nodeAuth.sessionMsg, productAuth: authNote },
      legacy: { token: legacyAuth.tokenStatus, session: legacyAuth.sessionStatus, ok: legacyAuth.ok },
    },
    counts: {
      total: results.length,
      pass: results.filter((r) => r.verdict === 'PASS').length,
      warn: results.filter((r) => r.verdict === 'WARN').length,
      diff: results.filter((r) => r.verdict === 'DIFF').length,
      skipped: results.filter((r) => r.status === 'SKIPPED').length,
    },
    results,
  };

  const outJson = path.join(ROOT, 'other/_scratch/nova-full-payload-report.json');
  fs.writeFileSync(outJson, JSON.stringify(summary, null, 2));

  // markdown table
  const lines = [
    '# Nova vs Canary — Full Flight/Hotel/Cab payload compare',
    '',
    `**When:** ${summary.at}`,
    `**Node:** ${NODE_BASE}`,
    `**Canary:** ${LEGACY_BASE}`,
    `**Partner:** ${PARTNER_ID} · tier ${TIER_ID}`,
    `**Auth:** Node session ${nodeAuth.sessionStatus} (${nodeAuth.sessionMsg || 'ok'}) · product auth: ${authNote}`,
    `**ALLOW_BOOK:** ${ALLOW_BOOK}`,
    '',
    `**Counts:** PASS ${summary.counts.pass} · WARN ${summary.counts.warn} · DIFF ${summary.counts.diff} · SKIPPED ${summary.counts.skipped} · total ${summary.counts.total}`,
    '',
    '| Domain | Method | Path | Canary | Node | Verdict | Notes |',
    '|--------|--------|------|--------|------|---------|-------|',
  ];
  for (const r of results) {
    if (r.status === 'SKIPPED') {
      lines.push(`| ${r.folder} | ${r.method} | \`${r.path}\` | — | — | SKIP | ${r.skipReason} |`);
      continue;
    }
    const lc = r.legacy.errorCode ? `${r.legacy.status}/${r.legacy.errorCode}` : String(r.legacy.status);
    const nc = r.node.errorCode ? `${r.node.status}/${r.node.errorCode}` : String(r.node.status);
    const note = [r.note, r.shapeDiffs?.length ? `shapeDiffs=${r.shapeDiffs.length}` : '', !r.statusMatch ? 'status mismatch' : '', !r.codeMatch && !r.legacy.ok ? 'error.code mismatch' : '']
      .filter(Boolean)
      .join('; ')
      .replace(/\|/g, '/');
    lines.push(`| ${r.folder} | ${r.method} | \`${r.path}\` | ${lc} | ${nc} | **${r.verdict}** | ${note} |`);
  }
  lines.push('', '## Request payload keys checked', '');
  for (const r of results.filter((x) => x.requestKeys?.length)) {
    lines.push(`- \`${r.method} ${r.path}\`: \`${r.requestKeys.join('`, `')}\``);
  }
  lines.push('', '## DIFF / WARN detail', '');
  for (const r of results.filter((x) => x.verdict === 'DIFF' || x.verdict === 'WARN')) {
    lines.push(`### ${r.verdict} — ${r.method} ${r.path}`);
    lines.push(`- Canary: ${r.legacy.status} ${r.legacy.errorCode || ''} ${r.legacy.errorMessage || ''}`);
    lines.push(`- Node: ${r.node.status} ${r.node.errorCode || ''} ${r.node.errorMessage || ''}`);
    if (r.shapeDiffs?.length) lines.push(`- Shape: ${r.shapeDiffs.slice(0, 12).map((d) => `${d.path}:${d.issue}`).join(', ')}`);
    lines.push('');
  }

  const outMd = path.join(ROOT, 'other/_scratch/NOVA-FULL-PAYLOAD-REPORT.md');
  fs.writeFileSync(outMd, lines.join('\n'));
  console.log('\nWrote', outJson);
  console.log('Wrote', outMd);
  console.log('Summary', summary.counts);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
