/**
 * Analyze GlobalTix CSV Attraction inventory by country
 * and outline/match plan vs tours-and-attractions search + carousels APIs.
 */
import fs from 'fs';

const CSV = 'Final production globaltix sheet - globaltix_products_full (1).csv';

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

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&amp;/g, '&')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const text = fs.readFileSync(CSV, 'utf8');
const rows = parseCsv(text);
const h = rows[0];
const col = Object.fromEntries(h.map((name, i) => [name, i]));

const counts = {};
const uniqueProducts = {};
const cities = {};

for (let r = 1; r < rows.length; r++) {
  const row = rows[r];
  if (!row || row.length < 5) continue;
  const cat = (row[col.category] || '').trim();
  if (!/attraction/i.test(cat)) continue;
  const country = (row[col.country] || '').trim();
  if (!country) continue;
  counts[country] = (counts[country] || 0) + 1;
  if (!uniqueProducts[country]) uniqueProducts[country] = new Map();
  const pid = row[col.product_id];
  if (!uniqueProducts[country].has(pid)) {
    uniqueProducts[country].set(pid, {
      product_id: pid,
      product_name: row[col.product_name],
      city: row[col.city] || '',
      country,
      category: cat,
      currency: row[col.currency],
      recommended_selling_price: row[col.recommended_selling_price],
      latitude: row[col.latitude],
      longitude: row[col.longitude],
    });
  }
  if (!cities[country]) cities[country] = new Set();
  if (row[col.city]) cities[country].add(row[col.city]);
}

const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
console.log('Attraction ticket-rows by country (top 30):');
for (const [c, n] of sorted.slice(0, 30)) {
  console.log(
    c.padEnd(28),
    'ticketRows=',
    String(n).padStart(5),
    'products=',
    String(uniqueProducts[c].size).padStart(4),
    'cities=',
    cities[c].size,
  );
}

// Popular market pick (India outbound / Asia leisure demand), must exist in sheet as Attraction
const preferred = [
  'Singapore',
  'Thailand',
  'United Arab Emirates',
  'Malaysia',
  'Indonesia',
  'Japan',
  'India',
  'France',
  'United Kingdom',
  'United States',
  'Hong Kong',
  'Vietnam',
  'Saudi Arabia',
  'Italy',
  'Spain',
  'Australia',
];

const picked = [];
for (const name of preferred) {
  if (counts[name]) picked.push(name);
  if (picked.length >= 10) break;
}
// fill from top inventory if needed
for (const [c] of sorted) {
  if (picked.length >= 10) break;
  if (!picked.includes(c)) picked.push(c);
}

console.log('\nSelected 10 popular countries for Attraction QA:');
picked.forEach((c, i) => {
  console.log(
    `${i + 1}. ${c} — ${uniqueProducts[c].size} products, top cities: ${[...cities[c]].slice(0, 5).join(', ')}`,
  );
});

// ID shape note
const sg = [...uniqueProducts.Singapore.values()].slice(0, 5);
console.log('\nCSV product_id shape (Singapore sample):', sg.map((p) => ({ id: p.product_id, name: p.product_name })));

const out = {
  selectedCountries: picked.map((c) => ({
    country: c,
    attractionProducts: uniqueProducts[c].size,
    cities: [...cities[c]].sort(),
    sampleProducts: [...uniqueProducts[c].values()].slice(0, 10).map((p) => ({
      product_id: p.product_id,
      product_name: p.product_name,
      city: p.city,
    })),
  })),
  matchPlan: {
    searchApi: 'GET /api/airportServices/tours-and-attractions/search?q={countryOrCity}',
    carouselsApi: 'POST /api/airportServices/carousels?type=tab&slug=tours-experiences-list',
    carouselsBody: { appliedFilters: { city, country } },
    joinKeyNote:
      'CSV product_id is numeric GlobalTix id; API productId/entityId is opaque hash. Primary match = normalize(product_name) + country (+ city when present).',
    checks: [
      'Search returns CITY entity for country/city',
      'Carousel Attractions block totalCount > 0',
      'Sample API products titles exist in CSV for that country (name match)',
      'API country/city filters align with request',
      'startingPrice present and currency INR (or documented)',
      'working_qa_status YES if country has Attraction CSV products AND carousel returns matching Attraction products; NO if empty/mismatched',
    ],
  },
};

fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync('reports/globaltix-attraction-10-countries-plan.json', JSON.stringify(out, null, 2));
console.log('\nWrote reports/globaltix-attraction-10-countries-plan.json');
