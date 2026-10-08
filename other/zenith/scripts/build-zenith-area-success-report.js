/**
 * Build Excel report from successful Zenith area search results only
 * (excludes errors / timeouts / non-200).
 */
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const ROOT = path.resolve('d:/Travel VIP API Automation');
const CSV_PATH = path.join(ROOT, 'tmp/india-areas.csv');
const NAME_CACHE_PATH = path.join(ROOT, 'tmp/zenith-area-hotel-name-cache.json');
const OUT_XLSX = path.join(
  ROOT,
  'reports/hotel/zenith-area-hotel-availability-SUCCESS-only.xlsx',
);
const OUT_JSON = path.join(
  ROOT,
  'reports/hotel/zenith-area-hotel-availability-SUCCESS-only.json',
);

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

function parentCityMatch(parentCity, responseCities) {
  if (!responseCities?.length) return 'N/A';
  const p = String(parentCity || '')
    .toLowerCase()
    .trim();
  if (!p) return 'N/A';
  return responseCities.some((c) => String(c).toLowerCase().trim() === p) ? 'Yes' : 'No';
}

function isSuccess(p) {
  return Boolean(p) && !p.error && Number(p.httpStatus) === 200;
}

const table = parseCsv(fs.readFileSync(CSV_PATH, 'utf8'));
const header = table[0].map((h) => String(h || '').trim());
const idx = Object.fromEntries(header.map((k, i) => [k, i]));
const nameCache = JSON.parse(fs.readFileSync(NAME_CACHE_PATH, 'utf8'));

const outRows = [];
for (const r of table.slice(1)) {
  const name = String(r[idx.name] || '').trim();
  if (!name) continue;
  const p = nameCache[nameKey(name)];
  if (!isSuccess(p)) continue;

  const parentCity = String(r[idx.parent_city] || '').trim();
  outRows.push({
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
    Issue: r[idx.Issue] || '',
  });
}

fs.mkdirSync(path.dirname(OUT_XLSX), { recursive: true });
const ws = XLSX.utils.json_to_sheet(outRows);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Success Only');
XLSX.writeFile(wb, OUT_XLSX);

const yes = outRows.filter((x) => x['Hotels Available (Yes/No)'] === 'Yes').length;
const summary = {
  generatedAt: new Date().toISOString(),
  successRowsInReport: outRows.length,
  hotelsAvailableYes: yes,
  hotelsAvailableNo: outRows.length - yes,
  uniqueNamesProbedSuccess: new Set(outRows.map((r) => nameKey(r.name))).size,
  cacheTotal: Object.keys(nameCache).length,
  cacheSuccess: Object.values(nameCache).filter(isSuccess).length,
  cacheFailedOrTimeout: Object.values(nameCache).filter((p) => !isSuccess(p)).length,
  output: OUT_XLSX,
};
fs.writeFileSync(OUT_JSON, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
