import fs from 'fs';
import XLSX from 'xlsx';

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

function nk(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function nameCityKey(r) {
  return `${nk(r.name)}||${nk(r.parent_city)}`;
}

const UNMATCHED = 'c:/Users/Rohan Bhagat/Downloads/india-260723_areas.unmatched-areas.csv';
const AREAS = 'd:/Travel VIP API Automation/tmp/india-areas.csv';
const CACHE = 'd:/Travel VIP API Automation/tmp/zenith-region-autocomplete-cache.json';

const unmatchedTable = parseCsv(fs.readFileSync(UNMATCHED, 'utf8'));
const uh = unmatchedTable[0].map((x) => String(x || '').trim());
const uidx = Object.fromEntries(uh.map((k, i) => [k, i]));
const exclude = new Set();
for (const r of unmatchedTable.slice(1)) {
  const name = r[uidx.name];
  const city = r[uidx.parent_city];
  if (!name) continue;
  exclude.add(nameCityKey({ name, parent_city: city }));
}

const areas = parseCsv(fs.readFileSync(AREAS, 'utf8'));
const ah = areas[0].map((x) => String(x || '').trim());
const aidx = Object.fromEntries(ah.map((k, i) => [k, i]));

// unique suburb names (and a representative parent_city) from full sheet
const suburbMap = new Map(); // nameKey -> {name, parent_city, keys:[nameCity]}
for (const r of areas.slice(1)) {
  if (String(r[aidx.place_type] || '').toLowerCase() !== 'suburb') continue;
  const name = String(r[aidx.name] || '').trim();
  if (!name) continue;
  const parent = String(r[aidx.parent_city] || '').trim();
  const key = nk(name);
  if (!suburbMap.has(key)) {
    suburbMap.set(key, { name, parent_city: parent, nameCityKeys: new Set() });
  }
  suburbMap.get(key).nameCityKeys.add(nameCityKey({ name, parent_city: parent }));
}

const cache = JSON.parse(fs.readFileSync(CACHE, 'utf8'));

let totalUnique = suburbMap.size;
let expectedUnavailable = 0; // unique names where ALL sheet suburb rows for that name are in unmatched list
let inScope = 0;
let appearing = 0;
let notAppearing = 0;
let missingResult = 0;

const notAppearingSamples = [];
const appearingSamples = [];

for (const [key, info] of suburbMap) {
  const allExcluded = [...info.nameCityKeys].every((k) => exclude.has(k));
  // also if any nameCity for this unique name is excluded and it's the only occurrence
  const anyExcluded = [...info.nameCityKeys].some((k) => exclude.has(k));

  // Count unique name as expected-unavailable if every (name,parent_city) pair is in unmatched
  if (allExcluded) {
    expectedUnavailable++;
    continue;
  }

  inScope++;
  const p = cache[key];
  const ok = p && p.httpStatus === 200 && !p.timedOut;
  if (!ok) {
    missingResult++;
    continue;
  }
  if (p.available === 'Yes') {
    appearing++;
    if (appearingSamples.length < 5) appearingSamples.push(`${info.name} (${info.parent_city})`);
  } else {
    notAppearing++;
    if (notAppearingSamples.length < 15) {
      notAppearingSamples.push(`${info.name} (${info.parent_city})`);
    }
  }
}

// Also compute using FILTERED excel unique counts for channel message consistency
const filteredPath =
  'd:/Travel VIP API Automation/reports/hotel/zenith-suburb-autocomplete-availability-FILTERED.xlsx';
let filtered = null;
if (fs.existsSync(filteredPath)) {
  const wb = XLSX.readFile(filteredPath);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Suburb Results'] || wb.Sheets[wb.SheetNames[0]]);
  const uYes = new Set();
  const uNo = new Set();
  for (const r of rows) {
    const k = nk(r.name);
    if (r['API Availability'] === 'Yes') uYes.add(k);
    if (r['API Availability'] === 'No') uNo.add(k);
  }
  filtered = {
    rows: rows.length,
    uniqueYes: uYes.size,
    uniqueNo: uNo.size,
    uniqueTotal: new Set([...uYes, ...uNo]).size,
  };
}

console.log(
  JSON.stringify(
    {
      totalUniqueSuburbs: totalUnique,
      unmatchedListRows: exclude.size,
      expectedUnavailableUnique: expectedUnavailable,
      inScopeUnique: inScope,
      appearingInSearch: appearing,
      notAppearingInSearch: notAppearing,
      missingApiResult: missingResult,
      appearingPct: inScope ? ((appearing / inScope) * 100).toFixed(1) : null,
      notAppearingSamples,
      appearingSamples,
      filteredExcel: filtered,
    },
    null,
    2,
  ),
);
