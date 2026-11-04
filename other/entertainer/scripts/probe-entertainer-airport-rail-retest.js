import fs from 'node:fs';

const countries = [
  'Australia',
  'Canada',
  'China',
  'Papua New Guinea',
  'Brazil',
  'Indonesia',
  'Russia',
  'Germany',
  'France',
  'Colombia',
  'Norway',
  'Spain',
  'Mexico',
];

const known = [
  { code: 'LZS', country: 'Austria', name: 'Linz Hauptbahnhof Rail Station' },
  { code: 'EAG', country: 'France', name: 'Agde Station' },
  { code: 'XHE', country: 'France', name: 'TGV Haute Picardie Station' },
  { code: 'XRZ', country: 'France', name: 'Arras Station' },
  { code: 'GBO', country: 'United States', name: 'Baltimore Greenbelt T Station' },
  { code: 'ZML', country: 'United States', name: 'Intermodal Station (Milwaukee)' },
];

const headers = {
  Authorization: 'Bearer ' + process.env.TV_TOKEN,
  Accept: 'application/json',
};

const BUS = /\b(bus|buses|coach)\s*(stop|station|terminal|stand|depot)s?\b|\bbusbahnhof\b|\brodovi[aá]ria\b|\bhalte\b/i;
const RAIL = /\b(railway|railroad)\b|\b(rail|train)\s+station\b|\bhauptbahnhof\b|\bbahnhof\b|\btgv\b|\bgare\b|\bintermodal\s+station\b|\bT Station\b/i;
const STATION_NAME = /\bstation\b/i;
const AIR_FACILITY = /airport|airfield|air base|air station|airstrip|aerodrome|heliport|seaplane|naval air|raf |usaf |afb\b/i;

function classify(row) {
  const text = [row.airportName, row.city, row.tag].filter(Boolean).join(' ');
  const bus = BUS.test(text);
  const rail = RAIL.test(text) || (STATION_NAME.test(text) && !AIR_FACILITY.test(text));
  return { bus, rail };
}

async function fetchPage(airport, page) {
  const u =
    'https://api.travelvip.ai/api/airportServices/getAirportList?key=hdbchdgvdffdh&pid=ent&platform=web&client=web&lang=en&currency=GBP&airport=' +
    encodeURIComponent(airport) +
    '&page=' + page + '&perpage=20';
  const r = await fetch(u, { headers });
  const j = await r.json();
  return { http: r.status, body: j };
}

async function scanCountry(country) {
  const seen = new Set();
  const rows = [];
  const busHits = [];
  const railHits = [];
  let page = 0;
  let emptyStreak = 0;
  while (page < 200) {
    const { http, body } = await fetchPage(country, page);
    if (http !== 200) throw new Error(country + ' HTTP ' + http + ' ' + JSON.stringify(body).slice(0, 200));
    const list = Array.isArray(body.result) ? body.result : [];
    if (!list.length || body.status === '-1' || body.info === 'Data not found') {
      emptyStreak += 1;
      if (emptyStreak >= 1) break;
    } else {
      emptyStreak = 0;
    }
    for (const row of list) {
      const key = [row.airportCode, row.airportName, row.city, row.country].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
      const { bus, rail } = classify(row);
      const hit = {
        code: row.airportCode,
        name: row.airportName,
        city: row.city,
        country: row.country,
        entityType: row.entityType,
        page,
      };
      if (bus) busHits.push(hit);
      if (rail) railHits.push(hit);
    }
    page += 1;
  }
  return {
    country,
    pages: page,
    rows: rows.length,
    busHits,
    railHits,
    status: busHits.length || railHits.length ? 'BUG' : 'PASS',
  };
}

async function findKnown(item) {
  const queries = [item.code, item.name.split(' ')[0], item.name];
  const hits = [];
  for (const q of queries) {
    for (let page = 0; page < 5; page += 1) {
      const { body } = await fetchPage(q, page);
      const list = Array.isArray(body.result) ? body.result : [];
      if (!list.length) break;
      for (const row of list) {
        if (String(row.airportCode).toUpperCase() === item.code) {
          hits.push({
            query: q,
            page,
            code: row.airportCode,
            name: row.airportName,
            city: row.city,
            country: row.country,
            entityType: row.entityType,
          });
        }
      }
    }
  }
  const uniq = [];
  const seen = new Set();
  for (const h of hits) {
    const k = [h.code, h.name, h.country].join('|');
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(h);
  }
  return { ...item, stillPresent: uniq.length > 0, hits: uniq };
}

const countryResults = [];
for (const c of countries) {
  const r = await scanCountry(c);
  countryResults.push(r);
  console.log(r.status, c, 'pages', r.pages, 'rows', r.rows, 'bus', r.busHits.length, 'rail', r.railHits.length);
  for (const h of r.railHits) console.log('  RAIL', h.code, h.country, h.name);
  for (const h of r.busHits) console.log('  BUS', h.code, h.country, h.name);
}

const knownResults = [];
for (const k of known) {
  const r = await findKnown(k);
  knownResults.push(r);
  console.log(r.stillPresent ? 'STILL' : 'GONE', r.code, r.country, r.name, JSON.stringify(r.hits));
}

const out = {
  at: new Date().toISOString(),
  env: 'https://api.travelvip.ai',
  path: '/api/airportServices/getAirportList?pid=ent',
  countryResults,
  knownResults,
};
fs.writeFileSync('reports/entertainer-airport-rail-retest.json', JSON.stringify(out, null, 2));
console.log('WROTE reports/entertainer-airport-rail-retest.json');
