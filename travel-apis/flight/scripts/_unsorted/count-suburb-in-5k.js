import fs from 'fs';

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

const table = parseCsv(fs.readFileSync('d:/Travel VIP API Automation/tmp/india-areas.csv', 'utf8'));
const h = table[0].map((x) => String(x || '').trim());
const idx = Object.fromEntries(h.map((k, i) => [k, i]));
const cache = JSON.parse(
  fs.readFileSync('d:/Travel VIP API Automation/tmp/zenith-region-autocomplete-cache.json', 'utf8'),
);
const nk = (n) => String(n || '').trim().toLowerCase();

const definitive = new Set(
  Object.entries(cache)
    .filter(([, p]) => p && p.httpStatus === 200 && !p.timedOut)
    .map(([k]) => k),
);

const typeByName = new Map();
let suburbSheetRows = 0;
let probedSheetRows = 0;

for (const r of table.slice(1)) {
  const name = String(r[idx.name] || '').trim();
  if (!name) continue;
  const key = nk(name);
  if (!definitive.has(key)) continue;
  probedSheetRows++;
  const pt = String(r[idx.place_type] || '').toLowerCase().trim() || 'unknown';
  if (pt === 'suburb') suburbSheetRows++;
  if (!typeByName.has(key)) typeByName.set(key, new Set());
  typeByName.get(key).add(pt);
}

const counts = {};
let suburbAny = 0;
let suburbOnly = 0;
let neighbourhoodOnly = 0;
let mixed = 0;

for (const [, types] of typeByName) {
  for (const t of types) counts[t] = (counts[t] || 0) + 1;
  const hasS = types.has('suburb');
  const hasN = types.has('neighbourhood');
  if (hasS) suburbAny++;
  if (hasS && types.size === 1) suburbOnly++;
  else if (hasN && types.size === 1) neighbourhoodOnly++;
  else if (hasS && hasN) mixed++;
}

const suburbYes = [...typeByName.entries()].filter(([k, types]) => {
  const p = cache[k];
  return types.has('suburb') && p?.available === 'Yes';
}).length;
const suburbNo = [...typeByName.entries()].filter(([k, types]) => {
  const p = cache[k];
  return types.has('suburb') && p?.available === 'No';
}).length;

console.log(
  JSON.stringify(
    {
      definitiveUnique: definitive.size,
      uniqueNamesMapped: typeByName.size,
      placeTypeOnUniqueNames: counts,
      suburbUniqueAny: suburbAny,
      suburbUniqueOnly: suburbOnly,
      neighbourhoodUniqueOnly: neighbourhoodOnly,
      mixedSuburbNeighbourhood: mixed,
      suburbUniqueYes: suburbYes,
      suburbUniqueNo: suburbNo,
      probedSheetRows,
      suburbSheetRowsAmongProbed: suburbSheetRows,
    },
    null,
    2,
  ),
);
