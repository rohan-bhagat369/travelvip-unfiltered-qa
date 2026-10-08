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

const t = parseCsv(fs.readFileSync('d:/Travel VIP API Automation/tmp/india-areas.csv', 'utf8'));
const h = t[0].map((x) => String(x || '').trim());
const idx = Object.fromEntries(h.map((k, i) => [k, i]));

const suburbNames = new Set();
const allNames = new Set();
const types = {};
let suburbRows = 0;

for (const r of t.slice(1)) {
  const name = String(r[idx.name] || '').trim();
  if (!name) continue;
  allNames.add(name.toLowerCase());
  const pt = String(r[idx.place_type] || '').toLowerCase().trim() || 'unknown';
  types[pt] = (types[pt] || 0) + 1;
  if (pt === 'suburb') {
    suburbRows++;
    suburbNames.add(name.toLowerCase());
  }
}

console.log(
  JSON.stringify(
    {
      totalRows: t.length - 1,
      suburbRows,
      uniqueSuburbNames: suburbNames.size,
      uniqueAllNames: allNames.size,
      rowsByPlaceType: types,
    },
    null,
    2,
  ),
);
