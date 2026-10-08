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

const t = parseCsv(fs.readFileSync('d:/Travel VIP API Automation/tmp/india-areas.csv', 'utf8'));
const h = t[0].map((x) => String(x || '').trim());
const idx = Object.fromEntries(h.map((k, i) => [k, i]));
const unavailable = [];
for (const r of t.slice(1)) {
  const pt = String(r[idx.place_type] || '').toLowerCase().trim();
  const avail = String(r[idx['Available (Yes/No)']] || '').toLowerCase().trim();
  if (pt === 'suburb' && avail === 'no') {
    unavailable.push({
      name: r[idx.name],
      parent_city: r[idx.parent_city],
      available: avail,
    });
  }
}
console.log('suburb Available=no count', unavailable.length);
console.log(unavailable.slice(0, 40).map((x) => `${x.name} | ${x.parent_city}`).join('\n'));
