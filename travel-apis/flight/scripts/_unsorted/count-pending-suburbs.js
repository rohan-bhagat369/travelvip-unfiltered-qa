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
const cache = JSON.parse(
  fs.readFileSync('d:/Travel VIP API Automation/tmp/zenith-region-autocomplete-cache.json', 'utf8'),
);
const nk = (n) => String(n || '').trim().toLowerCase();

const suburbNames = new Set();
for (const r of t.slice(1)) {
  const name = String(r[idx.name] || '').trim();
  if (!name) continue;
  if (String(r[idx.place_type] || '').toLowerCase().trim() === 'suburb') {
    suburbNames.add(nk(name));
  }
}

let tested = 0;
let pending = 0;
let yes = 0;
let no = 0;
let retryable = 0;

for (const key of suburbNames) {
  const p = cache[key];
  const definitive = p && p.httpStatus === 200 && !p.timedOut;
  if (definitive) {
    tested++;
    if (p.available === 'Yes') yes++;
    else no++;
  } else {
    pending++;
    if (p && (p.timedOut || p.httpStatus === 0)) retryable++;
  }
}

console.log(
  JSON.stringify(
    {
      uniqueSuburbTotal: suburbNames.size,
      suburbTested: tested,
      suburbPending: pending,
      suburbYes: yes,
      suburbNo: no,
      pendingIncludingTimeoutsToRetry: retryable,
    },
    null,
    2,
  ),
);
