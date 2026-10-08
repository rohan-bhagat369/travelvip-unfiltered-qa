/**
 * Probe Zenith hotelbooking/search for each area name from india-areas sheet.
 * Output Excel with Hotels Available / Hotel Count / Hotel Names / Parent City Match.
 *
 * Env:
 *   PLACE_TYPE=suburb|neighbourhood|  (empty = all)
 *   CONCURRENCY=6
 *   LIMIT=0
 *   REQUEST_GAP_MS=80
 *   ZENITH_BEARER=Bearer ...
 */
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const ROOT = path.resolve('d:/Travel VIP API Automation');
const CSV_PATH = path.join(ROOT, 'tmp/india-areas.csv');
const PROGRESS_PATH = path.join(ROOT, 'tmp/zenith-area-hotel-progress.json');
const NAME_CACHE_PATH = path.join(ROOT, 'tmp/zenith-area-hotel-name-cache.json');
const OUT_XLSX = path.join(ROOT, 'reports/hotel/zenith-area-hotel-availability-report.xlsx');
const OUT_JSON = path.join(ROOT, 'reports/hotel/zenith-area-hotel-availability-report.json');

const TOKEN =
  process.env.ZENITH_BEARER ||
  'Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiI2OTcwYTY2MDQ1ZTIwMS4yMzU5NjE3OCIsInRva2VuRGF0ZSI6IjIwMjYtMDYtMTkgMDk6Mjc6MTUifQ.HkKGS8WBs3upBNwDWornGgHsixMCtNmv5VRFBJddVpA0V2';

const BASE =
  'https://zenith-api.travelvip.ai/api/hotelbooking/search?key=palsgcvgscvvs&pid=smt&platform=web&client=web&lang=en&currency=INR';

const CONCURRENCY = Number(process.env.CONCURRENCY || 10);
const PLACE_TYPE_FILTER = (process.env.PLACE_TYPE || '').toLowerCase();
const LIMIT = Number(process.env.LIMIT || 0);
const REQUEST_GAP_MS = Number(process.env.REQUEST_GAP_MS || 40);
const CHECKPOINT_EVERY = Number(process.env.CHECKPOINT_EVERY || 100);
const EXCEL_EVERY = Number(process.env.EXCEL_EVERY || 1000);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (q) {
      if (c === '"' && n === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cur);
      cur = '';
    } else if (c === '\n') {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else if (c !== '\r') cur += c;
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

function loadRows() {
  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const table = parseCsv(raw);
  const header = table[0].map((h) => String(h || '').trim());
  const idx = Object.fromEntries(header.map((k, i) => [k, i]));
  let rows = table.slice(1).filter((r) => (r[idx.name] || '').trim());
  if (PLACE_TYPE_FILTER) {
    rows = rows.filter(
      (r) => String(r[idx.place_type] || '').toLowerCase() === PLACE_TYPE_FILTER,
    );
  }
  if (LIMIT > 0) rows = rows.slice(0, LIMIT);
  return { idx, rows };
}

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function saveJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, filePath);
}

function nameKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function searchArea(name) {
  const url = `${BASE}&q=${encodeURIComponent(name)}&page=0`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.FETCH_TIMEOUT_MS || 20000));
  let res;
  let text;
  try {
    res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        authorization: TOKEN,
        origin: 'https://zenith-shop.travelvip.ai',
        'content-type': 'application/json',
      },
    });
    text = await res.text();
  } catch (e) {
    clearTimeout(timer);
    return {
      httpStatus: 0,
      error: `fetch_error: ${e.message || e}`,
      hotelCount: 0,
      hotelsAvailable: 'No',
      hotelNames: '',
      responseCities: [],
    };
  }
  clearTimeout(timer);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return {
      httpStatus: res.status,
      error: `non-json: ${text.slice(0, 200)}`,
      hotelCount: 0,
      hotelsAvailable: 'No',
      hotelNames: '',
      responseCities: [],
    };
  }

  if (res.status === 429 || res.status === 503) {
    const err = new Error(`RATE_LIMIT_${res.status}`);
    err.status = res.status;
    throw err;
  }

  if (!res.ok) {
    return {
      httpStatus: res.status,
      error: data?.message || data?.error || text.slice(0, 200),
      hotelCount: 0,
      hotelsAvailable: 'No',
      hotelNames: '',
      responseCities: [],
    };
  }

  const content = Array.isArray(data.content) ? data.content : [];
  const hotels = content.filter((x) => String(x.type || '').toUpperCase() === 'HOTEL');
  const countFromTotal =
    typeof data.totalElements === 'number' ? data.totalElements : hotels.length;
  const hotelCount = countFromTotal > 0 ? countFromTotal : hotels.length;
  const names = hotels.map((h) => h.title).filter(Boolean);
  const namesStr =
    hotelCount > names.length && names.length
      ? `${names.join(' | ')} (+${hotelCount - names.length} more)`
      : names.join(' | ');
  const responseCities = [...new Set(hotels.map((h) => h.city).filter(Boolean))];

  return {
    httpStatus: res.status,
    error: '',
    hotelCount,
    hotelsAvailable: hotelCount > 0 ? 'Yes' : 'No',
    hotelNames: namesStr,
    responseCities,
  };
}

function parentCityMatch(parentCity, responseCities) {
  if (!responseCities?.length) return 'N/A';
  const p = String(parentCity || '')
    .toLowerCase()
    .trim();
  if (!p) return 'N/A';
  return responseCities.some((c) => String(c).toLowerCase().trim() === p) ? 'Yes' : 'No';
}

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

function buildOutRows(rows, idx, nameCache) {
  return rows.map((r) => {
    const name = String(r[idx.name] || '').trim();
    const parentCity = String(r[idx.parent_city] || '').trim();
    const p = nameCache[nameKey(name)] || {};
    return {
      name,
      parent_city: parentCity,
      country: r[idx.country] || '',
      country_name: r[idx.country_name] || '',
      latitude: r[idx.latitude] || '',
      longitude: r[idx.longitude] || '',
      place_type: r[idx.place_type] || '',
      dist_km: r[idx.dist_km] || '',
      'Hotels Available (Yes/No)': p.hotelsAvailable || 'No',
      'Hotel Count': p.hotelCount ?? 0,
      'Hotel Names': p.hotelNames || '',
      'Parent City Match': parentCityMatch(parentCity, p.responseCities || []),
      Issue: r[idx.Issue] || p.error || '',
      HTTP_Status: p.httpStatus ?? '',
    };
  });
}

function writeExcel(outRows) {
  fs.mkdirSync(path.dirname(OUT_XLSX), { recursive: true });
  const ws = XLSX.utils.json_to_sheet(outRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Area Hotel Availability');
  XLSX.writeFile(wb, OUT_XLSX);
}

function migrateLegacyProgress(nameCache) {
  const legacy = loadJson(PROGRESS_PATH);
  let added = 0;
  for (const [k, v] of Object.entries(legacy)) {
    const name = String(k.split('||')[0] || '').trim();
    const nk = nameKey(name);
    if (nk && !nameCache[nk] && v && typeof v === 'object') {
      nameCache[nk] = v;
      added++;
    }
  }
  return added;
}

async function main() {
  const { idx, rows } = loadRows();
  const nameCache = loadJson(NAME_CACHE_PATH);
  const migrated = migrateLegacyProgress(nameCache);
  if (migrated) {
    saveJson(NAME_CACHE_PATH, nameCache);
    console.log(`Migrated ${migrated} legacy progress entries into name cache`);
  }

  const uniqueNames = [];
  const seen = new Set();
  for (const r of rows) {
    const name = String(r[idx.name] || '').trim();
    const nk = nameKey(name);
    if (!nk || seen.has(nk)) continue;
    seen.add(nk);
    uniqueNames.push(name);
  }

  const pending = uniqueNames.filter((n) => !nameCache[nameKey(n)]);
  console.log(
    `Rows=${rows.length}, unique names=${uniqueNames.length}, cached=${uniqueNames.length - pending.length}, pending API=${pending.length}`,
  );
  console.log(
    `filter=${PLACE_TYPE_FILTER || 'all'}, concurrency=${CONCURRENCY}, gapMs=${REQUEST_GAP_MS}`,
  );

  let done = 0;
  let backoffMs = 0;
  const started = Date.now();

  await mapPool(pending, CONCURRENCY, async (name) => {
    if (REQUEST_GAP_MS > 0) await sleep(REQUEST_GAP_MS);
    if (backoffMs > 0) await sleep(backoffMs);

    let attempt = 0;
    let result;
    while (attempt < 5) {
      attempt++;
      try {
        result = await searchArea(name);
        if (result.httpStatus === 401 || result.httpStatus === 403) {
          throw new Error(`Auth failed HTTP ${result.httpStatus}: ${result.error}`);
        }
        backoffMs = Math.max(0, backoffMs - 50);
        break;
      } catch (e) {
        if (String(e.message || '').includes('Auth failed')) throw e;
        if (String(e.message || '').startsWith('RATE_LIMIT') || e.status === 429) {
          backoffMs = Math.min(15000, (backoffMs || 1000) * 2);
          console.log(`Rate limited — backing off ${backoffMs}ms`);
          await sleep(backoffMs);
          continue;
        }
        result = {
          httpStatus: 0,
          error: String(e.message || e),
          hotelCount: 0,
          hotelsAvailable: 'No',
          hotelNames: '',
          responseCities: [],
        };
        await sleep(400 * attempt);
      }
    }

    nameCache[nameKey(name)] = result;
    done++;
    if (done % 25 === 0 || done % CHECKPOINT_EVERY === 0 || done === pending.length) {
      if (done % CHECKPOINT_EVERY === 0 || done === pending.length) {
        saveJson(NAME_CACHE_PATH, nameCache);
      }
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`Progress ${done}/${pending.length} (${elapsed}s) cache=${Object.keys(nameCache).length}`);
    }
    if (done % EXCEL_EVERY === 0 || done === pending.length) {
      const outRows = buildOutRows(rows, idx, nameCache);
      writeExcel(outRows);
      const yes = outRows.filter((x) => x['Hotels Available (Yes/No)'] === 'Yes').length;
      console.log(`Excel checkpoint Yes=${yes}/${outRows.length} -> ${OUT_XLSX}`);
    }
    return result;
  });

  saveJson(NAME_CACHE_PATH, nameCache);
  const outRows = buildOutRows(rows, idx, nameCache);
  writeExcel(outRows);
  const yes = outRows.filter((x) => x['Hotels Available (Yes/No)'] === 'Yes').length;
  fs.writeFileSync(
    OUT_JSON,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totalRows: outRows.length,
        uniqueNames: uniqueNames.length,
        yes,
        no: outRows.length - yes,
        output: OUT_XLSX,
      },
      null,
      2,
    ),
  );
  console.log(`Done. Yes=${yes}, No=${outRows.length - yes}`);
  console.log(`Excel: ${OUT_XLSX}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
