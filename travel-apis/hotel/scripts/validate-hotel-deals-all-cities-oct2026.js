/**
 * CITY deals listing for every city on Oct 2026 sheet — paginate, find hotels not on sheet.
 *
 *   set -a; source .env.shop_bearer; set +a
 *   node travel-apis/hotel/scripts/validate-hotel-deals-all-cities-oct2026.js
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const BASE = 'https://preprod-next-api.travelvip.ai/api/hotelbooking';
const RESULTS = `${BASE}/getHotelResults`;
const BEARER = (process.env.SHOP_BEARER || '').trim();
const SHEET =
  process.env.SHEET ||
  '/Users/atulugale/Downloads/Copy of Taj - ITC -Oberoi - Hotel deals .xlsx';
const TAB = process.env.SHEET_TAB || 'Oct 2026';
const KNOWN_CITY = {
  // from user curl
  'New Delhi': { entityId: '131679', entityLabel: 'NEW DELHI' },
};
const SLEEP_MS = Number(process.env.SLEEP_MS || 300);

if (!BEARER) {
  console.error('Set SHOP_BEARER');
  process.exit(2);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadSheet() {
  const py = `
import openpyxl, json
wb = openpyxl.load_workbook(${JSON.stringify(SHEET)}, data_only=True)
ws = wb[${JSON.stringify(TAB)}]
rows = []
for r in range(2, ws.max_row + 1):
    hotel = ws.cell(r, 3).value
    meta = ws.cell(r, 7).value
    if not hotel and not meta: continue
    meta_s = str(int(meta)) if isinstance(meta, float) else str(meta or '').strip()
    rows.append({
        'sr': ws.cell(r, 1).value,
        'hotel': str(hotel or '').strip(),
        'city': str(ws.cell(r, 4).value or '').strip(),
        'metaId': meta_s,
    })
print(json.dumps(rows))
`;
  const res = spawnSync('python3', ['-c', py], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(res.stderr || res.stdout);
  return JSON.parse(res.stdout);
}

async function api(url, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json',
      authorization: `Bearer ${BEARER}`,
      'user-agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { _raw: text.slice(0, 400) };
  }
  return { status: res.status, ok: res.ok, data };
}

async function resolveCity(cityName) {
  if (KNOWN_CITY[cityName]) return { ...KNOWN_CITY[cityName], source: 'known' };

  const queries = [
    cityName,
    cityName === 'Gurugram' ? 'Gurgaon' : null,
    cityName === 'Bengaluru' ? 'Bangalore' : null,
    cityName === 'New Delhi' ? 'Delhi' : null,
  ].filter(Boolean);

  const paths = [
    (q) => `${BASE}/autoComplete?key=palsgcvgscvvs&pid=smt&platform=web&client=web&lang=en&q=${encodeURIComponent(q)}`,
    (q) => `${BASE}/autocomplete?key=palsgcvgscvvs&pid=smt&platform=web&client=web&lang=en&q=${encodeURIComponent(q)}`,
    (q) => `${BASE}/getAutoComplete?key=palsgcvgscvvs&pid=smt&q=${encodeURIComponent(q)}`,
    (q) => `${BASE}/searchAutoComplete?key=palsgcvgscvvs&pid=smt&q=${encodeURIComponent(q)}`,
  ];

  const tried = [];
  for (const q of queries) {
    for (const make of paths) {
      const url = make(q);
      const res = await api(url);
      tried.push({ url: url.replace(BEARER, '***'), status: res.status, keys: Object.keys(res.data || {}).slice(0, 8) });
      if (res.status === 401 || res.status === 403) {
        return { authExpired: true, tried };
      }
      const hits = flattenHits(res.data);
      const cityHit = pickCityHit(hits, cityName);
      if (cityHit) {
        return {
          entityId: String(cityHit.entityId || cityHit.id),
          entityLabel: String(cityHit.entityLabel || cityHit.title || cityHit.label || cityName).toUpperCase(),
          source: 'autocomplete',
          title: cityHit.title || cityHit.label,
          tried,
        };
      }
      await sleep(100);
    }
  }
  return { entityId: null, tried };
}

function flattenHits(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  for (const k of ['content', 'results', 'data', 'suggestions', 'autoComplete', 'autocomplete']) {
    if (Array.isArray(data[k])) return data[k];
    if (data[k] && Array.isArray(data[k].content)) return data[k].content;
  }
  return [];
}

function pickCityHit(hits, cityName) {
  const want = cityName.toLowerCase();
  const aliases = {
    gurugram: ['gurugram', 'gurgaon'],
    bengaluru: ['bengaluru', 'bangalore'],
    'new delhi': ['new delhi', 'delhi'],
    ranthambhore: ['ranthambhore', 'ranthambore', 'sawai madhopur'],
  };
  const names = aliases[want] || [want];

  const cities = hits.filter((h) => {
    const t = String(h.type || h.entityType || h.resultType || '').toUpperCase();
    return t.includes('CITY') || t === 'LOCATION' || (!t && (h.entityId || h.id));
  });
  const pool = cities.length ? cities : hits;
  for (const n of names) {
    const exact = pool.find((h) => {
      const title = String(h.title || h.label || h.entityLabel || h.name || '').toLowerCase();
      return title === n || title.startsWith(n + ' ') || title.startsWith(n + ',') || title.includes(n + ' ,');
    });
    if (exact) return exact;
  }
  for (const n of names) {
    const soft = pool.find((h) => String(h.title || h.label || h.entityLabel || h.name || '').toLowerCase().includes(n));
    if (soft) return soft;
  }
  return null;
}

async function paginateCityDeals(city) {
  const hotelsById = new Map();
  const pages = [];
  let requestId = null;
  let offset = 0;
  let page = 0;

  for (;;) {
    const body = {
      type: 'CITY',
      entityId: String(city.entityId),
      entityLabel: city.entityLabel || city.key,
      searchType: 'deals',
      dealType: 'discount',
      pid: 'smt',
      rt: 'compact',
      nationality: 'IN',
      rooms: [{ adults: 1, children: 0, childrenAges: [] }],
      filters: { refundable: 0, noOfRooms: 0, mealType: 0 },
      includeRooms: true,
    };
    if (requestId) body.requestId = requestId;

    const qs = new URLSearchParams({
      key: 'palsgcvgscvvs',
      pid: 'smt',
      platform: 'web',
      client: 'web',
      lang: 'en',
      currency: 'USD',
      offset: String(offset),
    });
    const res = await api(`${RESULTS}?${qs}`, { method: 'POST', body });
    if (res.status === 401 || res.status === 403) {
      return { hotelsById, pages, authExpired: true };
    }
    if (!requestId) requestId = res.data?.request?.requestId || res.data?.requestId || null;

    const batch = Array.isArray(res.data?.content) ? res.data.content : [];
    const pageHotels = [];
    for (const h of batch) {
      const id = String(h.entityId || h.id || '');
      if (!id) continue;
      const entry = {
        entityId: id,
        title: String(h.title || h.name || ''),
        city: h.city || '',
        page,
        offset,
      };
      pageHotels.push(entry);
      if (!hotelsById.has(id)) hotelsById.set(id, entry);
    }
    pages.push({
      page,
      offset,
      status: res.status,
      count: batch.length,
      last: res.data?.last,
      availableResults: res.data?.availableResults,
      totalPages: res.data?.totalPages,
      hotels: pageHotels,
    });
    console.log(
      `  ${city.key} page ${page} offset=${offset} http=${res.status} count=${batch.length} last=${res.data?.last} available=${res.data?.availableResults}`,
    );

    if (batch.length === 0 || res.data?.last === true) break;
    offset += batch.length;
    page += 1;
    if (page > 50) break;
    await sleep(SLEEP_MS);
  }
  return { hotelsById, pages, requestId, authExpired: false };
}

async function main() {
  const rows = loadSheet();
  const sheetMeta = new Set(rows.map((r) => r.metaId).filter(Boolean));
  const sheetByCity = new Map();
  for (const r of rows) {
    if (!sheetByCity.has(r.city)) sheetByCity.set(r.city, new Map());
    const m = sheetByCity.get(r.city);
    if (!m.has(r.metaId)) m.set(r.metaId, r.hotel);
  }
  const cities = [...sheetByCity.keys()].sort();
  console.log(`Sheet cities (${cities.length}): ${cities.join(', ')}`);

  const cityReports = [];
  const allExtra = [];
  let tokenExpired = false;

  for (const cityName of cities) {
    console.log(`\n=== ${cityName} ===`);
    const resolved = await resolveCity(cityName);
    if (resolved.authExpired) {
      tokenExpired = true;
      cityReports.push({ city: cityName, status: 'TOKEN_EXPIRED', resolved });
      break;
    }
    if (!resolved.entityId) {
      console.log(`  could not resolve CITY entityId`);
      cityReports.push({
        city: cityName,
        status: 'CITY_ID_NOT_FOUND',
        resolved,
        sheetHotels: [...sheetByCity.get(cityName)].map(([id, name]) => ({ metaId: id, hotel: name })),
      });
      continue;
    }
    console.log(`  entityId=${resolved.entityId} label=${resolved.entityLabel} source=${resolved.source}`);

    const listing = await paginateCityDeals({
      key: cityName,
      entityId: resolved.entityId,
      entityLabel: resolved.entityLabel,
    });
    if (listing.authExpired) {
      tokenExpired = true;
      cityReports.push({ city: cityName, status: 'TOKEN_EXPIRED', entityId: resolved.entityId });
      break;
    }

    const apiHotels = [...listing.hotelsById.values()];
    const extra = apiHotels.filter((h) => !sheetMeta.has(h.entityId));
    const inSheet = apiHotels.filter((h) => sheetMeta.has(h.entityId));
    const sheetOnly = [...sheetByCity.get(cityName).entries()]
      .filter(([id]) => !listing.hotelsById.has(id))
      .map(([id, name]) => ({ metaId: id, hotel: name }));

    for (const h of extra) {
      allExtra.push({ searchedCity: cityName, ...h });
    }

    cityReports.push({
      city: cityName,
      status: 'OK',
      entityId: resolved.entityId,
      entityLabel: resolved.entityLabel,
      source: resolved.source,
      pages: listing.pages.length,
      pageDetail: listing.pages.map((p) => ({
        page: p.page,
        offset: p.offset,
        status: p.status,
        count: p.count,
        last: p.last,
        availableResults: p.availableResults,
      })),
      apiHotelCount: apiHotels.length,
      inSheetCount: inSheet.length,
      extraCount: extra.length,
      apiHotels,
      extrasNotInSheet: extra,
      sheetHotelsMissingFromCityListing: sheetOnly,
    });
    console.log(
      `  API hotels=${apiHotels.length} inSheet=${inSheet.length} EXTRA=${extra.length} sheetMissingFromListing=${sheetOnly.length}`,
    );
    await sleep(SLEEP_MS);
  }

  const report = {
    ranAt: new Date().toISOString(),
    tokenExpired,
    sheetRows: rows.length,
    sheetHotels: sheetMeta.size,
    citiesChecked: cityReports.filter((c) => c.status === 'OK').length,
    citiesFailed: cityReports.filter((c) => c.status !== 'OK').length,
    totalExtraHotels: allExtra.length,
    extrasNotInSheet: allExtra,
    cityReports,
  };

  const outJson = path.join(ROOT, 'travel-apis/hotel/reports/hotel-deals-oct2026-all-cities.json');
  const outMd = path.join(ROOT, 'travel-apis/hotel/reports/hotel-deals-oct2026-all-cities.md');
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2));

  const lines = [];
  lines.push('# Hotel deals Oct 2026 — all cities CITY listing');
  lines.push('');
  lines.push(`Ran: ${report.ranAt}`);
  lines.push(`Token expired: **${tokenExpired ? 'YES' : 'NO'}**`);
  lines.push(`Cities OK: ${report.citiesChecked} · failed: ${report.citiesFailed}`);
  lines.push(`Extra hotels (in API, not on sheet): **${allExtra.length}**`);
  lines.push('');
  lines.push('## Per city');
  lines.push('');
  lines.push('| City | EntityId | Pages | API hotels | In sheet | Extra |');
  lines.push('|---|---|---:|---:|---:|---:|');
  for (const c of cityReports) {
    if (c.status !== 'OK') {
      lines.push(`| ${c.city} | ${c.entityId || '-'} | - | - | - | ${c.status} |`);
      continue;
    }
    lines.push(
      `| ${c.city} | ${c.entityId} | ${c.pages} | ${c.apiHotelCount} | ${c.inSheetCount} | ${c.extraCount} |`,
    );
  }
  lines.push('');
  lines.push('## Extra hotels (API only — not on Oct 2026 sheet)');
  lines.push('');
  if (!allExtra.length) {
    lines.push('_None_');
  } else {
    lines.push('| Searched city | MetaId | Title | API city | Page |');
    lines.push('|---|---|---|---|---:|');
    for (const h of allExtra) {
      lines.push(`| ${h.searchedCity} | ${h.entityId} | ${h.title} | ${h.city || ''} | ${h.page} |`);
    }
  }
  fs.writeFileSync(outMd, lines.join('\n'));

  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify({
    tokenExpired,
    citiesChecked: report.citiesChecked,
    citiesFailed: report.citiesFailed,
    totalExtraHotels: allExtra.length,
    extras: allExtra.map((h) => `${h.searchedCity}: ${h.entityId} ${h.title}`),
  }, null, 2));
  console.log(`Wrote ${outJson}`);
  console.log(`Wrote ${outMd}`);
  if (tokenExpired) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
