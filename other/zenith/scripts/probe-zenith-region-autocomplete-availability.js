/**
 * Zenith autocomplete: check if sheet region `name` appears in search content title.
 * Adds column: API Availability (Yes/No)
 * Chunked + resumable. Stops on auth/timeout storm and asks for fresh curl.
 */
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const ROOT = path.resolve('d:/Travel VIP API Automation');
const CSV_PATH = path.join(ROOT, 'tmp/india-areas.csv');
const NAME_CACHE_PATH = path.join(ROOT, 'tmp/zenith-region-autocomplete-cache.json');
const OUT_XLSX = path.join(ROOT, 'reports/hotel/zenith-region-autocomplete-availability.xlsx');
const OUT_JSON = path.join(ROOT, 'reports/hotel/zenith-region-autocomplete-availability.json');

const TOKEN =
  process.env.ZENITH_BEARER ||
  'Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiI2YTEwMzBkYmQ1NmI2Ni41MjczNDcxMSIsInRva2VuRGF0ZSI6IjIwMjYtMDgtMTAgMDk6MTE6MDEifQ.AZptR9roIpwHyRIVBgSrMrjs7U5pOhmZBgkUuj9asb40V2';

const BASE =
  'https://zenith-api.travelvip.ai/api/hotelbooking/search?key=palsgcvgscvvs&pid=smt&platform=web&client=web&lang=en&currency=INR';

const CONCURRENCY = Number(process.env.CONCURRENCY || 3);
const REQUEST_GAP_MS = Number(process.env.REQUEST_GAP_MS || 120);
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 45000);
const CHECKPOINT_EVERY = Number(process.env.CHECKPOINT_EVERY || 100);
const EXCEL_EVERY = Number(process.env.EXCEL_EVERY || 1000);
const CHUNK_SIZE = Number(process.env.CHUNK_SIZE || 0); // 0 = all pending
const PLACE_TYPE = (process.env.PLACE_TYPE || '').toLowerCase(); // suburb|neighbourhood|empty
const TIMEOUT_STREAK_LIMIT = Number(process.env.TIMEOUT_STREAK_LIMIT || 25);
const TARGET_COUNT = Number(process.env.TARGET_COUNT || 0); // 0 = no early stop

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

function nameKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase();
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\/\-_,.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function loadJson(p) {
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

function saveJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, p);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function evaluateMatch(searchName, content) {
  const list = Array.isArray(content) ? content : [];
  const q = norm(searchName);
  const exact = [];
  const partial = [];

  for (const item of list) {
    const title = String(item.title || '');
    const nt = norm(title);
    if (!nt) continue;
    if (nt === q) exact.push(item);
    else if (nt.includes(q) || q.includes(nt)) partial.push(item);
  }

  const matched = exact.length ? exact : partial;
  const available = matched.length > 0 ? 'Yes' : 'No';
  const matchMode = exact.length ? 'exact' : partial.length ? 'partial' : 'none';

  // duplicate same titles in full content
  const titleCounts = {};
  for (const item of list) {
    const t = norm(item.title);
    if (!t) continue;
    titleCounts[t] = (titleCounts[t] || 0) + 1;
  }
  const dupTitles = Object.entries(titleCounts)
    .filter(([, c]) => c > 1)
    .map(([t, c]) => `${t} x${c}`)
    .slice(0, 5);

  const best = matched[0];
  return {
    available,
    matchMode,
    matchedCount: matched.length,
    matchedType: best?.type || '',
    matchedTitle: best?.title || '',
    matchedCity: best?.city || '',
    matchedEntityId: best?.entityId || '',
    totalContent: list.length,
    duplicateTitles: dupTitles.join(' | '),
  };
}

async function searchName(name) {
  const url = `${BASE}&q=${encodeURIComponent(name)}&page=0`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        authorization: TOKEN,
        origin: 'https://zenith-shop.travelvip.ai',
        'content-type': 'application/json',
      },
    });
    const text = await res.text();
    const ms = Date.now() - t0;
    clearTimeout(timer);

    if (res.status === 401 || res.status === 403) {
      return {
        httpStatus: res.status,
        ms,
        error: `AUTH_FAIL HTTP ${res.status}`,
        authFailed: true,
        available: 'No',
      };
    }
    if (res.status === 429 || res.status === 503) {
      const err = new Error(`RATE_LIMIT_${res.status}`);
      err.status = res.status;
      throw err;
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return {
        httpStatus: res.status,
        ms,
        error: `non-json: ${text.slice(0, 160)}`,
        available: 'No',
      };
    }

    if (!res.ok) {
      return {
        httpStatus: res.status,
        ms,
        error: text.slice(0, 160),
        available: 'No',
      };
    }

    const match = evaluateMatch(name, data.content);
    return {
      httpStatus: res.status,
      ms,
      error: '',
      authFailed: false,
      ...match,
    };
  } catch (e) {
    clearTimeout(timer);
    if (String(e.message || '').startsWith('RATE_LIMIT')) throw e;
    return {
      httpStatus: 0,
      ms: Date.now() - t0,
      error: `fetch_error: ${e.message || e}`,
      available: 'No',
      timedOut: /abort/i.test(String(e.message || '')),
    };
  }
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

function loadRows() {
  const table = parseCsv(fs.readFileSync(CSV_PATH, 'utf8'));
  const header = table[0].map((h) => String(h || '').trim());
  const idx = Object.fromEntries(header.map((k, i) => [k, i]));
  let rows = table.slice(1).filter((r) => (r[idx.name] || '').trim());
  if (PLACE_TYPE) {
    rows = rows.filter((r) => String(r[idx.place_type] || '').toLowerCase() === PLACE_TYPE);
  }
  return { idx, rows };
}

function buildOutRows(sheetRows, idx, nameCache) {
  return sheetRows.map((r) => {
    const name = String(r[idx.name] || '').trim();
    const p = nameCache[nameKey(name)] || {};
    return {
      name,
      parent_city: r[idx.parent_city] || '',
      country: r[idx.country] || '',
      country_name: r[idx.country_name] || '',
      latitude: r[idx.latitude] || '',
      longitude: r[idx.longitude] || '',
      place_type: r[idx.place_type] || '',
      dist_km: r[idx.dist_km] || '',
      'Available (Yes/No)': r[idx['Available (Yes/No)']] || '',
      'API Availability': p.available || (p.error ? 'No' : ''),
      'Match Mode': p.matchMode || '',
      'Matched Title': p.matchedTitle || '',
      'Matched Type': p.matchedType || '',
      'Matched City': p.matchedCity || '',
      EntityId: p.matchedEntityId || '',
      'Duplicate Titles': p.duplicateTitles || '',
      'Response Time (ms)': p.ms ?? '',
      Issue: r[idx.Issue] || p.error || '',
      HTTP_Status: p.httpStatus ?? '',
    };
  });
}

function writeExcel(outRows) {
  fs.mkdirSync(path.dirname(OUT_XLSX), { recursive: true });
  const ws = XLSX.utils.json_to_sheet(outRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Region Autocomplete');

  const probed = outRows.filter((r) => r['API Availability'] === 'Yes' || r['API Availability'] === 'No');
  const yes = probed.filter((r) => r['API Availability'] === 'Yes').length;
  const summary = [
    { Metric: 'Sheet rows', Value: outRows.length },
    { Metric: 'Probed rows', Value: probed.length },
    { Metric: 'API Availability Yes', Value: yes },
    { Metric: 'API Availability No', Value: probed.length - yes },
    { Metric: 'Generated At', Value: new Date().toISOString() },
    { Metric: 'Env', Value: 'zenith-api.travelvip.ai' },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Summary');

  const tmpPath = OUT_XLSX.replace(/\.xlsx$/i, `.tmp-${process.pid}.xlsx`);
  const fallbackPath = OUT_XLSX.replace(/\.xlsx$/i, `-partial.xlsx`);
  try {
    XLSX.writeFile(wb, tmpPath);
    try {
      fs.renameSync(tmpPath, OUT_XLSX);
    } catch {
      // main file locked (often open in Excel) — keep writing to partial copy
      XLSX.writeFile(wb, fallbackPath);
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // ignore
      }
      console.log(`Excel locked; wrote fallback: ${fallbackPath}`);
    }
  } catch (e) {
    try {
      XLSX.writeFile(wb, fallbackPath);
      console.log(`Excel write failed (${e.code || e.message}); wrote fallback: ${fallbackPath}`);
    } catch (e2) {
      console.log(`Excel write skipped: ${e2.message}`);
    }
  }
}

async function main() {
  const { idx, rows } = loadRows();
  const nameCache = loadJson(NAME_CACHE_PATH);

  const uniqueNames = [];
  const seen = new Set();
  for (const r of rows) {
    const name = String(r[idx.name] || '').trim();
    const nk = nameKey(name);
    if (!nk || seen.has(nk)) continue;
    seen.add(nk);
    uniqueNames.push(name);
  }

  let pending = uniqueNames.filter((n) => {
    const p = nameCache[nameKey(n)];
    // retry timeouts / network failures; keep definitive HTTP 200 Yes/No
    if (!p) return true;
    if (p.timedOut) return true;
    if (p.httpStatus === 0) return true;
    if (p.authFailed) return true;
    return false;
  });
  if (CHUNK_SIZE > 0) pending = pending.slice(0, CHUNK_SIZE);

  const definitive = uniqueNames.filter((n) => {
    const p = nameCache[nameKey(n)];
    return p && p.httpStatus === 200 && !p.timedOut;
  }).length;

  console.log(
    `Sheet rows=${rows.length}, unique names=${uniqueNames.length}, definitive=${definitive}, pending this run=${pending.length}`,
  );
  console.log(
    `concurrency=${CONCURRENCY}, placeType=${PLACE_TYPE || 'all'}, target=${TARGET_COUNT || 'none (run all pending)'}`,
  );

  let done = 0;
  let backoffMs = 0;
  let timeoutStreak = 0;
  const started = Date.now();

  await mapPool(pending, CONCURRENCY, async (name) => {
    if (REQUEST_GAP_MS) await sleep(REQUEST_GAP_MS);
    if (backoffMs) await sleep(backoffMs);

    let attempt = 0;
    let result;
    while (attempt < 4) {
      attempt++;
      try {
        result = await searchName(name);
        if (result.authFailed) {
          nameCache[nameKey(name)] = result;
          saveJson(NAME_CACHE_PATH, nameCache);
          writeExcel(buildOutRows(rows, idx, nameCache));
          console.error('\nAUTH/TOKEN FAILURE — provide a fresh curl.');
          console.error(result.error);
          process.exit(2);
        }
        if (result.timedOut) timeoutStreak++;
        else timeoutStreak = 0;
        if (timeoutStreak >= TIMEOUT_STREAK_LIMIT) {
          nameCache[nameKey(name)] = result;
          saveJson(NAME_CACHE_PATH, nameCache);
          writeExcel(buildOutRows(rows, idx, nameCache));
          console.error('\nTIMEOUT STREAK — API unstable. Provide a fresh curl / retry later.');
          process.exit(3);
        }
        backoffMs = Math.max(0, backoffMs - 40);
        break;
      } catch (e) {
        if (String(e.message || '').startsWith('RATE_LIMIT')) {
          backoffMs = Math.min(12000, (backoffMs || 800) * 2);
          console.log(`Rate limited — backoff ${backoffMs}ms`);
          await sleep(backoffMs);
          continue;
        }
        result = {
          httpStatus: 0,
          ms: 0,
          error: String(e.message || e),
          available: 'No',
        };
        await sleep(300 * attempt);
      }
    }

    nameCache[nameKey(name)] = result;
    // do not keep timeout/network failures as final answers — delete so next run retries
    if (result.timedOut || result.httpStatus === 0) {
      // keep briefly for streak tracking but mark retryable
      result.retryable = true;
    }
    done++;

    const definitiveNow = Object.values(nameCache).filter(
      (x) => x && x.httpStatus === 200 && !x.timedOut,
    ).length;

    if (done % 25 === 0 || done === pending.length) {
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      const yes = Object.values(nameCache).filter((x) => x.available === 'Yes' && x.httpStatus === 200).length;
      console.log(
        `Progress ${done}/${pending.length} (${elapsed}s) definitive=${definitiveNow} Yes=${yes}`,
      );
      // When filtering by place type, count definitive only within this run's uniqueNames
      const scopedDefinitive = uniqueNames.filter((n) => {
        const p = nameCache[nameKey(n)];
        return p && p.httpStatus === 200 && !p.timedOut;
      }).length;
      if (TARGET_COUNT > 0 && scopedDefinitive >= TARGET_COUNT) {
        console.log(
          `\nReached target ${TARGET_COUNT} definitive results for filter (${scopedDefinitive}). Stopping this run.`,
        );
        saveJson(NAME_CACHE_PATH, nameCache);
        writeExcel(buildOutRows(rows, idx, nameCache));
        process.exit(0);
      }
    }
    if (done % CHECKPOINT_EVERY === 0 || done === pending.length) {
      saveJson(NAME_CACHE_PATH, nameCache);
    }
    if (done % EXCEL_EVERY === 0 || done === pending.length) {
      writeExcel(buildOutRows(rows, idx, nameCache));
      console.log(`Excel updated: ${OUT_XLSX}`);
    }
    return result;
  });

  saveJson(NAME_CACHE_PATH, nameCache);
  const outRows = buildOutRows(rows, idx, nameCache);
  writeExcel(outRows);

  const probedUnique = uniqueNames.filter((n) => nameCache[nameKey(n)]);
  const yesUnique = probedUnique.filter((n) => nameCache[nameKey(n)].available === 'Yes').length;
  fs.writeFileSync(
    OUT_JSON,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sheetRows: rows.length,
        uniqueNames: uniqueNames.length,
        probedUnique: probedUnique.length,
        yesUnique,
        noUnique: probedUnique.length - yesUnique,
        output: OUT_XLSX,
      },
      null,
      2,
    ),
  );

  console.log(`\nDone. Unique probed=${probedUnique.length}, Yes=${yesUnique}, No=${probedUnique.length - yesUnique}`);
  console.log(`Excel: ${OUT_XLSX}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
