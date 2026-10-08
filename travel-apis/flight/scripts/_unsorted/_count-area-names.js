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
const h = t[0];
const idx = Object.fromEntries(h.map((k, i) => [k, i]));
const names = new Set();
const suburbNames = new Set();
for (const r of t.slice(1)) {
  const n = (r[idx.name] || '').trim();
  if (!n) continue;
  names.add(n.toLowerCase());
  if (String(r[idx.place_type] || '').toLowerCase() === 'suburb') suburbNames.add(n.toLowerCase());
}
console.log(
  JSON.stringify(
    { rows: t.length - 1, uniqueNames: names.size, uniqueSuburbNames: suburbNames.size },
    null,
    2,
  ),
);
