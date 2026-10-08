import fs from 'fs';

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (inQ) {
      if (c === '"' && n === '"') {
        cur += '"';
        i++;
      } else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') {
      row.push(cur);
      cur = '';
    } else if (c === '\n' || (c === '\r' && n === '\n')) {
      if (c === '\r') i++;
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

const t = parseCsv(fs.readFileSync('Final production globaltix sheet - globaltix_products_full (1).csv', 'utf8'));
const h = t[0];
const si = h.indexOf('working_qa_status');
const ci = h.indexOf('category');
const counts = { yes: 0, no: 0, notFound: 0, blank: 0, emptyRow: 0 };
const blankByCat = {};
let blankAttraction = 0;

for (let i = 1; i < t.length; i++) {
  const r = t[i];
  if (!r || r.every((x) => !String(x || '').trim())) {
    counts.emptyRow++;
    continue;
  }
  const st = String(r[si] || '').trim().toLowerCase();
  const cat = String(r[ci] || '').trim() || '(none)';
  if (st === 'yes') counts.yes++;
  else if (st === 'no') counts.no++;
  else if (st === 'not found') counts.notFound++;
  else {
    counts.blank++;
    blankByCat[cat] = (blankByCat[cat] || 0) + 1;
    if (/attraction/i.test(cat)) blankAttraction++;
  }
}

console.log(counts);
console.log('blank Attraction rows', blankAttraction);
console.log(
  'top blank categories',
  Object.entries(blankByCat)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12),
);
