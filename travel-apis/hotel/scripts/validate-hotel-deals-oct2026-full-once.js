/**
 * One-pass Oct 2026 deals validation (no retries / no ID scan loops).
 * Abort immediately on 401/403.
 *
 *   set -a; source .env.shop_bearer; set +a
 *   node travel-apis/hotel/scripts/validate-hotel-deals-oct2026-full-once.js
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const API = 'https://preprod-next-api.travelvip.ai';
const BEARER = (process.env.SHOP_BEARER || '').trim();
const SHEET =
  process.env.SHEET ||
  '/Users/atulugale/Downloads/Copy of Taj - ITC -Oberoi - Hotel deals .xlsx';
const TAB = 'Oct 2026';
const PRICE_TOL = 0.05;
const SLEEP_MS = 200;

if (!BEARER) {
  console.error('SHOP_BEARER missing');
  process.exit(2);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function money(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/[$,]/g, '').trim());
  return Number.isFinite(n) ? n : null;
}
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\n\r]+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function tokens(s) {
  return norm(s).split(' ').filter((t) => t.length > 2);
}
function roomMatch(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return false;
  return ta.filter((t) => nb.includes(t)).length / ta.length >= 0.7
    || tb.filter((t) => na.includes(t)).length / tb.length >= 0.7;
}
function priceClose(a, b) {
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) <= PRICE_TOL;
}
function cityKey(s) {
  const x = norm(s);
  if (x === 'gurgaon') return 'gurugram';
  if (x === 'bangalore') return 'bengaluru';
  return x;
}

function loadSheet() {
  const py = `
import openpyxl, json
wb = openpyxl.load_workbook(${JSON.stringify(SHEET)}, data_only=True)
ws = wb[${JSON.stringify(TAB)}]
rows = []
for r in range(2, ws.max_row + 1):
    hotel = ws.cell(r, 3).value
    meta = ws.cell(r, 7).value
    if not hotel and not meta: continue
    meta_s = str(int(meta)) if isinstance(meta, float) else str(meta or '').strip()
    rows.append({
        'sr': int(float(ws.cell(r, 1).value)),
        'deal': str(ws.cell(r, 2).value or '').strip().lower(),
        'hotel': str(hotel or '').strip(),
        'city': str(ws.cell(r, 4).value or '').strip(),
        'star': str(ws.cell(r, 5).value or '').strip(),
        'dates': str(ws.cell(r, 6).value or '').strip(),
        'metaId': meta_s,
        'room': str(ws.cell(r, 8).value or '').strip(),
        'rtype': str(ws.cell(r, 9).value or '').strip(),
        'capacity': str(ws.cell(r, 13).value or '').strip(),
        'variant': str(ws.cell(r, 14).value or '').strip(),
        'variantExcl': str(ws.cell(r, 16).value or '').strip(),
        'retail': ws.cell(r, 21).value,
        'selling': ws.cell(r, 22).value,
        'currency': str(ws.cell(r, 23).value or '').strip(),
        'rating': ws.cell(r, 33).value,
        'reviews': ws.cell(r, 34).value,
    })
print(json.dumps(rows))
`;
  const res = spawnSync('python3', ['-c', py], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(res.stderr || res.stdout);
  return JSON.parse(res.stdout);
}

async function api(url, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json',
      authorization: `Bearer ${BEARER}`,
      'user-agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { _raw: text.slice(0, 300) };
  }
  return { status: res.status, data };
}

function abortAuth(step, status) {
  return {
    aborted: true,
    reason: `TOKEN_FAILED_OR_UNAUTHORIZED at ${step} (HTTP ${status}). Share fresh curls.`,
    step,
    status,
  };
}

async function getDiscountCities() {
  const url = `${API}/api/getCarousels?key=palsgcvgscvvs&pid=smt&platform=web&client=web&lang=en&currency=USD&page=1&perpage=20&slug=smt-hotel-deals&type=page&sendDefaultTab=1`;
  const res = await api(url);
  if (res.status === 401 || res.status === 403) return abortAuth('getCarousels', res.status);
  if (res.status !== 200) {
    return { aborted: true, reason: `getCarousels HTTP ${res.status} — stopped (no retry).`, status: res.status };
  }
  const discount = (res.data.tabs || []).find((t) => String(t.type || '').toLowerCase() === 'discount');
  const cities = [];
  for (const r of discount?.results || []) {
    for (const b of r.banners || []) {
      if (String(b.bannerType || '').toUpperCase() === 'CITY' && String(b.typeId || '').toLowerCase() === 'discount') {
        cities.push({
          city: String(b.title || '').trim(),
          entityId: String(b.landingUrl || '').trim(),
          dealType: String(b.typeId || '').trim(),
        });
      }
    }
  }
  return { aborted: false, cities };
}

async function cityListing(entityId, entityLabel) {
  const hotels = new Map();
  let offset = 0;
  let page = 0;
  let requestId = null;
  for (;;) {
    const body = {
      type: 'CITY',
      entityId: String(entityId),
      entityLabel,
      searchType: 'deals',
      dealType: 'discount',
      pid: 'smt',
      rt: 'compact',
      nationality: 'IN',
      rooms: [{ adults: 1, children: 0, childrenAges: [] }],
      filters: { refundable: 0, noOfRooms: 0, mealType: 0 },
      includeRooms: true,
    };
    if (requestId) body.requestId = requestId;
    const qs = new URLSearchParams({
      key: 'palsgcvgscvvs',
      pid: 'smt',
      platform: 'web',
      client: 'web',
      lang: 'en',
      currency: 'USD',
      offset: String(offset),
    });
    const res = await api(`${API}/api/hotelbooking/getHotelResults?${qs}`, { method: 'POST', body });
    if (res.status === 401 || res.status === 403) return abortAuth(`CITY ${entityLabel}`, res.status);
    if (res.status !== 200) {
      return { aborted: true, reason: `CITY ${entityLabel} HTTP ${res.status} — stopped.`, status: res.status };
    }
    if (!requestId) requestId = res.data?.request?.requestId || null;
    const batch = res.data?.content || [];
    for (const h of batch) {
      const id = String(h.entityId || h.id || '');
      if (!id) continue;
      if (!hotels.has(id)) {
        hotels.set(id, { entityId: id, title: h.title || '', city: h.city || '', page, offset });
      }
    }
    if (!batch.length || res.data?.last === true) break;
    offset += batch.length;
    page += 1;
    if (page > 20) break; // safety only
    await sleep(SLEEP_MS);
  }
  return { aborted: false, hotels, requestId };
}

function extractRooms(data) {
  const content0 = (data?.content || [])[0] || {};
  const rd = content0?.data?.roomDetail || {};
  const rooms = rd.Rooms || [];
  const info = data?.roomsInfo || [];
  const out = [];
  for (let i = 0; i < rooms.length; i += 1) {
    const r = rooms[i];
    const inf = info[i] || {};
    let name = inf.Title || inf.roomType || r.RoomType || r.Name || r.name;
    if (Array.isArray(name)) name = name.filter(Boolean).join(' / ');
    const pd = r.priceDetail || {};
    out.push({
      name: String(name || ''),
      meal: String(inf.MealType || r.MealType || ''),
      selling: money(r.TotalFare ?? pd.totalPrice ?? pd.payablePrice),
      retail: money(pd.maxTotalPrice ?? pd.maxPrice ?? r.retailPrice),
      currency: r.Currency || pd.currency || null,
      refundable: r.IsRefundable ?? r.refundable ?? null,
    });
  }
  const h = content0;
  return {
    title: h.title || '',
    city: h.city || '',
    rooms: out,
  };
}

async function hotelDetailed(metaId, requestId) {
  const body = {
    type: 'HOTEL',
    entityId: String(metaId),
    entityLabel: 'DEALS',
    searchType: 'deals',
    dealType: 'discount',
    pid: 'smt',
    rt: 'detailed',
    nationality: 'IN',
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
    filters: { refundable: 0, noOfRooms: 0, mealType: 0 },
    includeRooms: true,
  };
  if (requestId) body.requestId = requestId;
  const qs = new URLSearchParams({
    key: 'palsgcvgscvvs',
    pid: 'smt',
    platform: 'web',
    client: 'web',
    lang: 'en',
    currency: 'USD',
    offset: '0',
  });
  const res = await api(`${API}/api/hotelbooking/getHotelResults?${qs}`, { method: 'POST', body });
  if (res.status === 401 || res.status === 403) return abortAuth(`HOTEL ${metaId}`, res.status);
  if (res.status !== 200) {
    return { aborted: true, reason: `HOTEL ${metaId} HTTP ${res.status} — stopped.`, status: res.status };
  }
  return { aborted: false, ...extractRooms(res.data), status: res.status };
}

function matchRow(row, api) {
  const selling = money(row.selling);
  const retail = money(row.retail);
  let best = null;
  for (const r of api.rooms || []) {
    const nameOk = roomMatch(row.room, r.name);
    const sellOk = priceClose(selling, r.selling);
    const retailOk = priceClose(retail, r.retail);
    const score = (nameOk ? 4 : 0) + (sellOk ? 2 : 0) + (retailOk ? 1 : 0);
    if (!best || score > best.score) best = { r, score, nameOk, sellOk, retailOk };
  }
  if (!best || !api.rooms?.length) {
    return { status: 'FAIL', reason: 'hotel/rooms missing in API', matched: null };
  }
  const curOk = !row.currency || !best.r.currency || String(row.currency).toUpperCase() === String(best.r.currency).toUpperCase();
  if (best.nameOk && best.sellOk && best.retailOk && curOk) {
    return { status: 'PASS', reason: 'room+selling+retail match', matched: best.r };
  }
  const parts = [];
  if (!best.nameOk) parts.push('room');
  if (!best.sellOk) parts.push('selling');
  if (!best.retailOk) parts.push('retail');
  if (!curOk) parts.push('currency');
  return { status: 'FAIL', reason: `mismatch: ${parts.join(',')}`, matched: best.r, flags: best };
}

async function main() {
  const sheetRows = loadSheet();
  const sheetMeta = new Set(sheetRows.map((r) => r.metaId));
  console.log(`Sheet rows=${sheetRows.length} uniqueHotels=${sheetMeta.size}`);

  console.log('1) getCarousels discount cities…');
  const car = await getDiscountCities();
  if (car.aborted) {
    writeReport({ aborted: true, ...car, sheetRows: sheetRows.length });
    console.error(car.reason);
    process.exit(1);
  }
  console.log(`   discount cities=${car.cities.length}`);

  const cityEntityByKey = new Map();
  for (const c of car.cities) cityEntityByKey.set(cityKey(c.city), c);

  // sheet cities → entity mapping (Gurugram uses New Delhi listing)
  const sheetCities = [...new Set(sheetRows.map((r) => r.city))];
  const cityPlan = [];
  for (const city of sheetCities) {
    const key = cityKey(city);
    if (key === 'gurugram') {
      const delhi = cityEntityByKey.get('new delhi');
      cityPlan.push({
        sheetCity: city,
        entityId: delhi?.entityId || null,
        entityLabel: 'NEW DELHI',
        note: 'Gurugram hotels via New Delhi CITY deals',
      });
      continue;
    }
    if (key === 'jaipur') {
      cityPlan.push({ sheetCity: city, entityId: null, entityLabel: 'JAIPUR', note: 'No city banner in carousels — CITY listing NOT TESTED' });
      continue;
    }
    const hit = cityEntityByKey.get(key);
    cityPlan.push({
      sheetCity: city,
      entityId: hit?.entityId || null,
      entityLabel: (hit?.city || city).toUpperCase(),
      note: hit ? null : 'entityId missing from carousels',
    });
  }

  const cityResults = [];
  const allCityHotels = new Map(); // metaId -> {..., searchedCity}
  let sharedRequestId = null;

  console.log('2) CITY listings…');
  for (const plan of cityPlan) {
    if (!plan.entityId) {
      console.log(`   skip CITY ${plan.sheetCity}: ${plan.note}`);
      cityResults.push({ ...plan, status: 'NOT_TESTED', hotels: [], extras: [] });
      continue;
    }
    console.log(`   CITY ${plan.sheetCity} entityId=${plan.entityId}`);
    const listing = await cityListing(plan.entityId, plan.entityLabel);
    if (listing.aborted) {
      writeReport({ aborted: true, ...listing, carouselsCities: car.cities, cityResults });
      console.error(listing.reason);
      process.exit(1);
    }
    if (!sharedRequestId) sharedRequestId = listing.requestId;
    const hotels = [...listing.hotels.values()];
    for (const h of hotels) {
      if (!allCityHotels.has(h.entityId)) allCityHotels.set(h.entityId, { ...h, searchedCity: plan.sheetCity });
    }
    const extras = hotels.filter((h) => !sheetMeta.has(h.entityId));
    cityResults.push({
      ...plan,
      status: 'OK',
      hotelCount: hotels.length,
      hotels,
      extras,
    });
    console.log(`     hotels=${hotels.length} extras=${extras.length}`);
    await sleep(SLEEP_MS);
  }

  const uniqueMeta = [...sheetMeta];
  const hotelApi = new Map();
  console.log(`3) HOTEL detailed × ${uniqueMeta.length}…`);
  for (let i = 0; i < uniqueMeta.length; i += 1) {
    const id = uniqueMeta[i];
    process.stdout.write(`   ${i + 1}/${uniqueMeta.length} ${id}… `);
    const det = await hotelDetailed(id, sharedRequestId);
    if (det.aborted) {
      writeReport({
        aborted: true,
        ...det,
        carouselsCities: car.cities,
        cityResults,
        rowResultsPartial: true,
      });
      console.error('\n' + det.reason);
      process.exit(1);
    }
    hotelApi.set(id, det);
    console.log(`rooms=${det.rooms.length}`);
    await sleep(SLEEP_MS);
  }

  const rowResults = [];
  for (const row of sheetRows) {
    const api = hotelApi.get(row.metaId);
    const inCity = [...allCityHotels.values()].some((h) => h.entityId === row.metaId);
    const cityCovered = cityResults.some(
      (c) => cityKey(c.sheetCity) === cityKey(row.city) && c.status === 'OK',
    );
    const match = matchRow(row, api || { rooms: [] });
    rowResults.push({
      sr: row.sr,
      hotel: row.hotel,
      city: row.city,
      metaId: row.metaId,
      sheetRoom: row.room,
      sheetSelling: money(row.selling),
      sheetRetail: money(row.retail),
      sheetCurrency: row.currency,
      sheetVariant: row.variant,
      inCityListing: cityCovered ? inCity : null,
      apiTitle: api?.title || null,
      apiCity: api?.city || null,
      apiRoom: match.matched?.name || null,
      apiSelling: match.matched?.selling ?? null,
      apiRetail: match.matched?.retail ?? null,
      apiMeal: match.matched?.meal || null,
      apiRefundable: match.matched?.refundable ?? null,
      status: match.status,
      reason: match.reason,
    });
  }

  const extras = [];
  for (const c of cityResults) {
    for (const h of c.extras || []) {
      extras.push({ searchedCity: c.sheetCity, ...h });
    }
  }
  // carousel cities not on sheet
  const sheetCityKeys = new Set(sheetCities.map(cityKey));
  sheetCityKeys.add('gurugram');
  const extraCarouselCities = car.cities.filter((c) => !sheetCityKeys.has(cityKey(c.city)));

  const summary = {
    sheetRows: sheetRows.length,
    PASS: rowResults.filter((r) => r.status === 'PASS').length,
    FAIL: rowResults.filter((r) => r.status === 'FAIL').length,
    citiesChecked: cityResults.filter((c) => c.status === 'OK').length,
    citiesNotTested: cityResults.filter((c) => c.status === 'NOT_TESTED').length,
    extraHotelsInCityApi: extras.length,
    extraCitiesInCarousels: extraCarouselCities.length,
    tokenOk: true,
    aborted: false,
  };

  const report = {
    ranAt: new Date().toISOString(),
    env: 'preprod-next-api',
    summary,
    carouselsDiscountCities: car.cities,
    extraCarouselCities,
    cityResults: cityResults.map((c) => ({
      sheetCity: c.sheetCity,
      entityId: c.entityId,
      status: c.status,
      note: c.note,
      hotelCount: c.hotelCount || 0,
      extras: (c.extras || []).map((h) => ({ entityId: h.entityId, title: h.title, city: h.city })),
    })),
    extraHotels: extras,
    rowResults,
  };
  writeReport(report);
  printMarkdown(report);
}

function writeReport(report) {
  const dir = path.join(ROOT, 'travel-apis/hotel/reports');
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, 'hotel-deals-oct2026-full-validate.json');
  const mdPath = path.join(dir, 'hotel-deals-oct2026-full-validate.md');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  if (!report.aborted) {
    const lines = [];
    lines.push('# Hotel deals Oct 2026 — full validation report');
    lines.push('');
    lines.push(`Ran: ${report.ranAt}`);
    lines.push(`Token: OK`);
    lines.push('');
    lines.push('## Summary');
    lines.push('');
    lines.push('| Metric | Count |');
    lines.push('|---|---:|');
    for (const [k, v] of Object.entries(report.summary)) {
      if (typeof v === 'number' || typeof v === 'boolean') lines.push(`| ${k} | ${v} |`);
    }
    lines.push('');
    lines.push('## Extra hotels (in CITY API, not on sheet)');
    lines.push('');
    if (!report.extraHotels?.length) lines.push('_None_');
    else {
      lines.push('| Searched city | MetaId | Title | API city |');
      lines.push('|---|---|---|---|');
      for (const h of report.extraHotels) {
        lines.push(`| ${h.searchedCity} | ${h.entityId} | ${h.title} | ${h.city || ''} |`);
      }
    }
    lines.push('');
    lines.push('## Extra cities (carousels discount, not on sheet)');
    lines.push('');
    if (!report.extraCarouselCities?.length) lines.push('_None_');
    else {
      for (const c of report.extraCarouselCities) lines.push(`- ${c.city} (\`${c.entityId}\`)`);
    }
    lines.push('');
    lines.push('## Row results');
    lines.push('');
    lines.push('| Sr | Hotel | City | MetaId | In CITY | Sheet sell | API sell | Status | Reason |');
    lines.push('|---:|---|---|---|---|---:|---:|---|---|');
    for (const r of report.rowResults) {
      const inCity = r.inCityListing == null ? 'n/a' : r.inCityListing ? 'yes' : 'no';
      lines.push(
        `| ${r.sr} | ${r.hotel} | ${r.city} | ${r.metaId} | ${inCity} | ${r.sheetSelling ?? ''} | ${r.apiSelling ?? ''} | ${r.status} | ${r.reason} |`,
      );
    }
    fs.writeFileSync(mdPath, lines.join('\n'));
  } else {
    fs.writeFileSync(mdPath, `# Aborted\n\n${report.reason}\n`);
  }
  console.log(`\nWrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
}

function printMarkdown(report) {
  console.log('\n========== REPORT ==========');
  console.log(JSON.stringify(report.summary, null, 2));
  console.log('\nExtra hotels:', report.extraHotels.length);
  for (const h of report.extraHotels) {
    console.log(`  - [${h.searchedCity}] ${h.entityId} ${h.title}`);
  }
  console.log('\nExtra carousel cities:', report.extraCarouselCities.map((c) => `${c.city}(${c.entityId})`).join(', ') || 'none');
  const fails = report.rowResults.filter((r) => r.status === 'FAIL');
  console.log(`\nFAIL rows: ${fails.length}`);
  for (const f of fails.slice(0, 30)) {
    console.log(`  Sr${f.sr} ${f.hotel} | ${f.sheetRoom.slice(0, 40)} | ${f.reason} | apiRoom=${f.apiRoom} sell=${f.apiSelling}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
