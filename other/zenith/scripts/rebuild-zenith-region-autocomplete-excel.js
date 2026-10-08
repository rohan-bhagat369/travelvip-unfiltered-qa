import fs from 'fs';
import XLSX from 'xlsx';

const ROOT = 'd:/Travel VIP API Automation';
const CSV = `${ROOT}/tmp/india-areas.csv`;
const CACHE = `${ROOT}/tmp/zenith-region-autocomplete-cache.json`;
const OUT = `${ROOT}/reports/hotel/zenith-region-autocomplete-availability.xlsx`;

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

const table = parseCsv(fs.readFileSync(CSV, 'utf8'));
const header = table[0].map((h) => String(h || '').trim());
const idx = Object.fromEntries(header.map((k, i) => [k, i]));
const cache = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
const nk = (n) => String(n || '').trim().toLowerCase();

const out = table
  .slice(1)
  .filter((r) => (r[idx.name] || '').trim())
  .map((r) => {
    const name = String(r[idx.name] || '').trim();
    const p = cache[nk(name)] || {};
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
      'API Availability': p.available || '',
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

const probed = out.filter((r) => r['API Availability'] === 'Yes' || r['API Availability'] === 'No');
const yes = probed.filter((r) => r['API Availability'] === 'Yes').length;

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(out), 'Region Autocomplete');
XLSX.utils.book_append_sheet(
  wb,
  XLSX.utils.json_to_sheet([
    { Metric: 'Sheet rows', Value: out.length },
    { Metric: 'Probed rows', Value: probed.length },
    { Metric: 'API Availability Yes', Value: yes },
    { Metric: 'API Availability No', Value: probed.length - yes },
    { Metric: 'Status', Value: 'PARTIAL - run aborted' },
    { Metric: 'Generated At', Value: new Date().toISOString() },
  ]),
  'Summary',
);
XLSX.writeFile(wb, OUT);
console.log(JSON.stringify({ rows: out.length, probed: probed.length, yes, no: probed.length - yes, out: OUT }, null, 2));
