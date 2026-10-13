/**
 * Validate Oct 2026 Taj/ITC/Oberoi deals sheet vs preprod getHotelResults.
 *
 * Flow (same as provided curls):
 *   1) CITY compact deals (New Delhi) — paginate until last/empty
 *   2) HOTEL detailed deals per sheet HotelMetaInfoID
 *
 *   SHOP_BEARER='...' node travel-apis/hotel/scripts/validate-hotel-deals-oct2026-sheet.js
 *   SHEET='/path/to.xlsx'  optional
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const BASE = 'https://preprod-next-api.travelvip.ai/api/hotelbooking/getHotelResults';
const BEARER = (process.env.SHOP_BEARER || '').trim();
const SHEET =
  process.env.SHEET ||
  '/Users/atulugale/Downloads/Copy of Taj - ITC -Oberoi - Hotel deals .xlsx';
const TAB = process.env.SHEET_TAB || 'Oct 2026';
const CITY_ENTITY = process.env.CITY_ENTITY_ID || '131679';
const CITY_LABEL = process.env.CITY_LABEL || 'NEW DELHI';
const PAGE_SIZE = Number(process.env.PAGE_SIZE || 20);
const SLEEP_MS = Number(process.env.SLEEP_MS || 250);
const PRICE_TOL = Number(process.env.PRICE_TOL || 0.05);

if (!BEARER) {
  console.error('Set SHOP_BEARER to the shop JWT from the curl');
  process.exit(2);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function money(v) {
  const n = Number(v);
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
/** loose room match: all significant sheet tokens appear in API name (or vice versa if sheet longer) */
function roomMatch(sheetRoom, apiRoom) {
  const a = norm(sheetRoom);
  const b = norm(apiRoom);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const ta = tokens(sheetRoom);
  const tb = tokens(apiRoom);
  if (!ta.length || !tb.length) return false;
  const hitA = ta.filter((t) => b.includes(t)).length;
  const hitB = tb.filter((t) => a.includes(t)).length;
  return hitA / ta.length >= 0.7 || hitB / tb.length >= 0.7;
}
function priceClose(a, b) {
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) <= PRICE_TOL;
}

function loadSheetRows() {
  const py = `
import openpyxl, json, sys
wb = openpyxl.load_workbook(${JSON.stringify(SHEET)}, data_only=True)
ws = wb[${JSON.stringify(TAB)}]
rows = []
for r in range(2, ws.max_row + 1):
    hotel = ws.cell(r, 3).value
    meta = ws.cell(r, 7).value
    if not hotel and not meta:
        continue
    meta_s = str(int(meta)) if isinstance(meta, float) else str(meta or '').strip()
    rows.append({
        'sr': ws.cell(r, 1).value,
        'deal': str(ws.cell(r, 2).value or '').strip(),
        'hotel': str(hotel or '').strip(),
        'city': str(ws.cell(r, 4).value or '').strip(),
        'dates': str(ws.cell(r, 6).value or '').strip(),
        'metaId': meta_s,
        'room': str(ws.cell(r, 8).value or '').strip(),
        'variant': str(ws.cell(r, 14).value or '').strip(),
        'retail': ws.cell(r, 21).value,
        'selling': ws.cell(r, 22).value,
        'currency': str(ws.cell(r, 23).value or '').strip(),
    })
print(json.dumps(rows))
`;
  const res = spawnSync('python3', ['-c', py], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  if (res.status !== 0) {
    throw new Error(`sheet load failed: ${res.stderr || res.stdout}`);
  }
  return JSON.parse(res.stdout);
}

async function postResults(body, { offset = 0 } = {}) {
  const qs = new URLSearchParams({
    key: 'palsgcvgscvvs',
    pid: 'smt',
    platform: 'web',
    client: 'web',
    lang: 'en',
    currency: 'USD',
    offset: String(offset),
  });
  const res = await fetch(`${BASE}?${qs}`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json',
      authorization: `Bearer ${BEARER}`,
      'user-agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { _raw: text.slice(0, 500) };
  }
  return { status: res.status, ok: res.ok, data };
}

function listingHotels(data) {
  const list = data?.content || data?.results || [];
  return Array.isArray(list) ? list : [];
}

function hotelName(h) {
  return String(h?.title || h?.name || h?.data?.roomDetail?.HotelDetails?.HotelName || '');
}

function extractRooms(data) {
  const content0 = (data?.content || [])[0] || {};
  const rd = content0?.data?.roomDetail || data?.data?.roomDetail || {};
  const rooms = rd.Rooms || rd.rooms || [];
  const info = data?.roomsInfo || [];
  const out = [];
  for (let i = 0; i < rooms.length; i += 1) {
    const r = rooms[i];
    const inf = info[i] || {};
    let name = inf.Title || inf.roomType || r.RoomType || r.Name || r.name || r.title;
    if (Array.isArray(name)) name = name.filter(Boolean).join(' / ');
    const pd = r.priceDetail || {};
    out.push({
      name: String(name || ''),
      meal: String(inf.MealType || r.MealType || ''),
      selling: money(r.TotalFare ?? pd.totalPrice ?? pd.payablePrice ?? pd.finalPrice),
      retail: money(pd.maxTotalPrice ?? pd.maxPrice ?? r.retailPrice ?? r.RecommendedSellingRate),
      currency: r.Currency || pd.currency || 'USD',
    });
  }
  return out;
}

async function paginateCityDeals() {
  const hotelsById = new Map();
  const pages = [];
  let requestId = null;
  let authExpired = false;
  let offset = 0;
  let page = 0;

  for (;;) {
    const body = {
      type: 'CITY',
      entityId: CITY_ENTITY,
      entityLabel: CITY_LABEL,
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

    const res = await postResults(body, { offset });
    if (res.status === 401 || res.status === 403) {
      authExpired = true;
      pages.push({ page, offset, status: res.status, authExpired: true, hotels: [] });
      break;
    }
    if (!requestId) requestId = res.data?.request?.requestId || res.data?.requestId || null;

    const batch = listingHotels(res.data);
    const pageHotels = [];
    for (const h of batch) {
      const id = String(h.entityId || h.id || '');
      if (!id) continue;
      const entry = {
        entityId: id,
        title: hotelName(h),
        city: h.city || '',
        page,
        offset,
      };
      pageHotels.push(entry);
      if (!hotelsById.has(id)) hotelsById.set(id, entry);
    }
    pages.push({
      page,
      offset,
      status: res.status,
      availableResults: res.data?.availableResults,
      totalElements: res.data?.totalElements,
      last: res.data?.last,
      count: batch.length,
      hotels: pageHotels,
    });
    console.log(
      `CITY page ${page} offset=${offset} http=${res.status} count=${batch.length} last=${res.data?.last} available=${res.data?.availableResults} totalPages=${res.data?.totalPages}`,
    );

    // Keep paging while API says not last and this page had hotels.
    // Always fetch one more page when last=false even if availableResults already covered,
    // so hotels missing from page 0 are not falsely marked absent.
    if (batch.length === 0 || res.data?.last === true) break;
    offset += batch.length || PAGE_SIZE;
    page += 1;
    if (page > 50) break;
    await sleep(SLEEP_MS);
  }

  return { hotelsById, pages, requestId, authExpired };
}

async function fetchHotelDetailed(metaId, requestId) {
  const body = {
    type: 'HOTEL',
    entityId: String(metaId),
    entityLabel: CITY_LABEL,
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
  return postResults(body, { offset: 0 });
}

function matchSheetRow(row, apiRooms) {
  const selling = money(row.selling);
  const retail = money(row.retail);
  const candidates = apiRooms.filter((r) => roomMatch(row.room, r.name));
  let best = null;
  for (const c of candidates.length ? candidates : apiRooms) {
    const sellOk = priceClose(selling, c.selling);
    const retailOk = priceClose(retail, c.retail);
    const nameOk = roomMatch(row.room, c.name);
    const score = (nameOk ? 4 : 0) + (sellOk ? 2 : 0) + (retailOk ? 1 : 0);
    if (!best || score > best.score) {
      best = { api: c, score, nameOk, sellOk, retailOk };
    }
  }
  if (!best) {
    return { status: 'MISSING', detail: 'no rooms in API' };
  }
  if (best.nameOk && best.sellOk && best.retailOk) {
    return { status: 'PASS', detail: best.api };
  }
  if (best.nameOk && best.sellOk) {
    return { status: 'PASS_PRICE', detail: { ...best.api, note: 'selling match; retail mismatch or missing' }, flags: best };
  }
  if (best.nameOk) {
    return { status: 'ROOM_PRESENT_PRICE_MISMATCH', detail: best.api, flags: best };
  }
  if (best.sellOk || best.retailOk) {
    return { status: 'PRICE_PRESENT_ROOM_MISMATCH', detail: best.api, flags: best };
  }
  return { status: 'MISSING', detail: 'no room/price match', closest: best.api };
}

async function main() {
  const sheetRows = loadSheetRows();
  console.log(`Sheet "${TAB}": ${sheetRows.length} rows from ${SHEET}`);

  const city = await paginateCityDeals();
  if (city.authExpired) {
    const report = {
      ranAt: new Date().toISOString(),
      tokenExpired: true,
      cityPages: city.pages,
      message: 'Bearer token expired/rejected during CITY search — stopped.',
    };
    const out = path.join(ROOT, 'travel-apis/hotel/reports/hotel-deals-oct2026-sheet-validate.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.error('TOKEN EXPIRED (CITY)');
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const uniqueMeta = [...new Set(sheetRows.map((r) => r.metaId).filter(Boolean))];
  console.log(`Unique HotelMetaInfoIDs: ${uniqueMeta.length}; CITY listing unique: ${city.hotelsById.size}`);

  const hotelApi = new Map();
  let tokenExpiredMid = false;
  for (let i = 0; i < uniqueMeta.length; i += 1) {
    const id = uniqueMeta[i];
    process.stdout.write(`HOTEL detailed ${i + 1}/${uniqueMeta.length} id=${id} ... `);
    const res = await fetchHotelDetailed(id, city.requestId);
    if (res.status === 401 || res.status === 403) {
      console.log(`AUTH ${res.status}`);
      tokenExpiredMid = true;
      hotelApi.set(id, { status: res.status, authExpired: true, rooms: [], title: null });
      break;
    }
    const rooms = extractRooms(res.data);
    const title = hotelName((res.data?.content || [])[0] || {});
    console.log(`http=${res.status} rooms=${rooms.length} title=${title || '-'}`);
    hotelApi.set(id, {
      status: res.status,
      authExpired: false,
      rooms,
      title,
      availableResults: res.data?.availableResults,
    });
    await sleep(SLEEP_MS);
  }

  const results = [];
  let pass = 0;
  let soft = 0;
  let miss = 0;
  let authStop = 0;

  for (const row of sheetRows) {
    const listing = city.hotelsById.get(row.metaId) || null;
    const api = hotelApi.get(row.metaId);
    let rowStatus;
    let match = null;
    if (!api) {
      rowStatus = tokenExpiredMid ? 'NOT_TESTED_TOKEN' : 'NOT_TESTED';
      authStop += 1;
    } else if (api.authExpired) {
      rowStatus = 'NOT_TESTED_TOKEN';
      authStop += 1;
    } else if (api.status !== 200 || !api.rooms.length) {
      rowStatus = 'HOTEL_API_EMPTY';
      miss += 1;
    } else {
      match = matchSheetRow(row, api.rooms);
      rowStatus = match.status;
      if (rowStatus === 'PASS' || rowStatus === 'PASS_PRICE') pass += 1;
      else if (String(rowStatus).includes('MISMATCH')) soft += 1;
      else miss += 1;
    }

    results.push({
      sr: row.sr,
      hotel: row.hotel,
      city: row.city,
      metaId: row.metaId,
      sheetRoom: row.room,
      sheetSelling: money(row.selling),
      sheetRetail: money(row.retail),
      sheetDates: row.dates,
      inCityListing: Boolean(listing),
      cityListingPage: listing ? listing.page : null,
      cityListingOffset: listing ? listing.offset : null,
      cityListingTitle: listing?.title || null,
      apiHotelTitle: api?.title || null,
      apiRoomCount: api?.rooms?.length ?? null,
      status: rowStatus,
      matchedApiRoom: match?.detail?.name || match?.closest?.name || null,
      matchedApiSelling: match?.detail?.selling ?? match?.closest?.selling ?? null,
      matchedApiRetail: match?.detail?.retail ?? match?.closest?.retail ?? null,
      flags: match?.flags || null,
    });
  }

  const sheetMetaSet = new Set(uniqueMeta);
  const cityOnly = [...city.hotelsById.values()].filter((h) => !sheetMetaSet.has(h.entityId));

  const report = {
    ranAt: new Date().toISOString(),
    env: 'preprod-next-api',
    sheet: SHEET,
    tab: TAB,
    tokenExpired: false,
    tokenExpiredMidRun: tokenExpiredMid,
    citySearch: {
      entityId: CITY_ENTITY,
      entityLabel: CITY_LABEL,
      requestId: city.requestId,
      pages: city.pages.length,
      pageDetail: city.pages,
      uniqueHotels: [...city.hotelsById.values()],
    },
    summary: {
      sheetRows: sheetRows.length,
      uniqueHotels: uniqueMeta.length,
      PASS: results.filter((r) => r.status === 'PASS').length,
      PASS_PRICE: results.filter((r) => r.status === 'PASS_PRICE').length,
      ROOM_PRESENT_PRICE_MISMATCH: results.filter((r) => r.status === 'ROOM_PRESENT_PRICE_MISMATCH').length,
      PRICE_PRESENT_ROOM_MISMATCH: results.filter((r) => r.status === 'PRICE_PRESENT_ROOM_MISMATCH').length,
      MISSING: results.filter((r) => r.status === 'MISSING').length,
      HOTEL_API_EMPTY: results.filter((r) => r.status === 'HOTEL_API_EMPTY').length,
      NOT_TESTED_TOKEN: results.filter((r) => r.status === 'NOT_TESTED_TOKEN').length,
      inCityListing: results.filter((r) => r.inCityListing).length,
      notInCityListing: results.filter((r) => !r.inCityListing).length,
      cityHotelsNotInSheet: cityOnly.map((h) => ({ entityId: h.entityId, title: h.title, page: h.page })),
    },
    results,
  };

  const outJson = path.join(ROOT, 'travel-apis/hotel/reports/hotel-deals-oct2026-sheet-validate.json');
  const outMd = path.join(ROOT, 'travel-apis/hotel/reports/hotel-deals-oct2026-sheet-validate.md');
  fs.mkdirSync(path.dirname(outJson), { recursive: true });
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2));

  const lines = [];
  lines.push('# Hotel deals Oct 2026 sheet vs API');
  lines.push('');
  lines.push(`Ran: ${report.ranAt}`);
  lines.push(`CITY: ${CITY_LABEL} (${CITY_ENTITY}) — ${city.pages.length} page(s), ${city.hotelsById.size} hotels`);
  lines.push(`Token expired mid-run: **${tokenExpiredMid ? 'YES' : 'NO'}**`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('|---|---:|');
  for (const [k, v] of Object.entries(report.summary)) {
    if (typeof v === 'number') lines.push(`| ${k} | ${v} |`);
  }
  lines.push('');
  lines.push('## CITY pagination');
  lines.push('');
  lines.push('| Page | Offset | HTTP | Count | Last | Hotels |');
  lines.push('|---:|---:|---:|---:|---|---|');
  for (const p of city.pages) {
    lines.push(
      `| ${p.page} | ${p.offset} | ${p.status} | ${p.count} | ${p.last} | ${(p.hotels || []).map((h) => `${h.entityId} ${h.title}`).join('; ')} |`,
    );
  }
  lines.push('');
  lines.push('## Row results');
  lines.push('');
  lines.push('| Sr | Hotel | City | MetaId | In CITY (page) | Sheet room | Sheet sell | API room | API sell | Status |');
  lines.push('|---:|---|---|---|---|---|---:|---|---:|---|');
  for (const r of results) {
    const page = r.inCityListing ? String(r.cityListingPage) : 'no';
    lines.push(
      `| ${r.sr} | ${r.hotel} | ${r.city} | ${r.metaId} | ${page} | ${(r.sheetRoom || '').replace(/\|/g, '/').slice(0, 40)} | ${r.sheetSelling ?? ''} | ${(r.matchedApiRoom || '').replace(/\|/g, '/').slice(0, 40)} | ${r.matchedApiSelling ?? ''} | ${r.status} |`,
    );
  }
  fs.writeFileSync(outMd, lines.join('\n'));

  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Wrote ${outJson}`);
  console.log(`Wrote ${outMd}`);
  if (tokenExpiredMid) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
