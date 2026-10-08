/**
 * Prod shop listing probe → price-band counts matching Riya-Hotel-Analysis sheet layout.
 *
 * Usage (PowerShell):
 *   $env:SHOP_BEARER='...'; node scripts/probe-riya-hotel-price-bands-prod.js
 *
 * Does not book. Writes reports/riya-hotel-analysis-*.csv + .json (gitignored).
 */
import fs from 'fs';
import path from 'path';

const BASE = 'https://api.travelvip.ai/api/hotelbooking/getHotelResults';
const BEARER = (process.env.SHOP_BEARER || '').trim();
const PAGE_SIZE = Number(process.env.PAGE_SIZE || 50);
const MAX_PAGES = 400;
const SLEEP_MS = Number(process.env.SLEEP_MS || 200);

const CITIES = [
  { key: 'DELHI', q: 'delhi', entityId: '227760:IN', entityLabel: 'Delhi , India' },
  { key: 'MUMBAI', q: 'mumbai', entityId: '357389:IN', entityLabel: 'Mumbai , India' },
  { key: 'Bangalore', q: 'bangalore', entityId: '341153:IN', entityLabel: 'Bangalore , India' },
];

// Sheet travel dates (labels) — year 2026 to match Aug-2026 analysis + curl (2025 would be past).
const DATES = [
  { label: '25 Aug 2025', checkin: '2026-08-25', checkout: '2026-08-26' },
  { label: '05 Sept 2025', checkin: '2026-09-05', checkout: '2026-09-06' },
  { label: '20 Sept 2025', checkin: '2026-09-20', checkout: '2026-09-21' },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function hotelPrice(h) {
  const pd = h?.data?.roomDetail?.priceDetail || h?.priceDetail || h?.price || {};
  const candidates = [
    pd.totalPrice,
    pd.payablePrice,
    pd.finalPrice,
    pd.maxTotalPrice,
    h?.price?.totalAmount,
    h?.totalAmount,
  ];
  for (const c of candidates) {
    const n = money(c);
    if (n != null && n > 0) return n;
  }
  return null;
}

function isPanMandatory(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (typeof obj.IsPANMandatory === 'boolean') return obj.IsPANMandatory;
  if (typeof obj.isPANMandatory === 'boolean') return obj.isPANMandatory;
  if (typeof obj.isPanMandatory === 'boolean') return obj.isPanMandatory;
  return null;
}

function roomsOf(h) {
  const rooms = h?.data?.roomDetail?.Rooms || h?.rooms || h?.roomList || [];
  return Array.isArray(rooms) ? rooms : [];
}

function bandOf(price) {
  if (price == null) return null;
  if (price <= 5000) return 'below5000';
  if (price <= 7500) return 'mid5001_7500';
  return 'above7501';
}

function emptyBand() {
  return {
    totalHotels: 0,
    hotelsWithoutPan: 0,
    hotelsPanUnknown: 0,
    totalRooms: 0,
    roomsWithoutPan: 0,
    roomsPanUnknown: 0,
    hotelsMissingPrice: 0,
  };
}

async function fetchPage({ city, checkin, checkout, page, offset }) {
  const qs = new URLSearchParams({
    key: 'palsgcvgscvvs',
    pid: 'smt',
    platform: 'web',
    client: 'web',
    lang: 'en',
    currency: 'INR',
    q: city.q,
    page: String(page),
    offset: String(offset),
    perpage: String(PAGE_SIZE),
    size: String(PAGE_SIZE),
  });
  const url = `${BASE}?${qs.toString()}`;
  const body = {
    checkin,
    checkout,
    type: 'TBOCITY',
    entityId: city.entityId,
    nationality: 'IN',
    nationalityLabel: 'Indian',
    entityLabel: city.entityLabel,
    requestId: '',
    pid: 'smt',
    rt: 'compact',
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
    fq: { df_long_star_rating: [] },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json',
      authorization: `Bearer ${BEARER}`,
      origin: 'https://shop.travelvip.ai',
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 500) };
  }
  return { status: res.status, data, text };
}

function extractHotels(data) {
  if (!data || typeof data !== 'object') {
    return { hotels: [], total: null, last: null, totalPages: null, size: null };
  }
  const hotels = data.content || data.results || data.hotels || [];
  return {
    hotels: Array.isArray(hotels) ? hotels : [],
    total: data.totalElements ?? data.totalSearchResults ?? data.availableResults ?? data.total ?? null,
    last: data.last ?? null,
    totalPages: data.totalPages ?? data.totalSearchPages ?? null,
    size: data.size ?? data.numberOfElements ?? null,
  };
}

function tokenLooksExpired(status, data) {
  const msg = JSON.stringify(data || {}).toLowerCase();
  if (status === 401 || status === 403) return true;
  if (/token|expired|unauthorized|jwt|session/i.test(msg) && status >= 400) return true;
  return false;
}

async function collectCityDate(city, dateRow) {
  const bands = {
    below5000: emptyBand(),
    mid5001_7500: emptyBand(),
    above7501: emptyBand(),
  };
  let pages = 0;
  let fetched = 0;
  let totalReported = null;
  let totalPages = null;
  let sampleKeys = null;
  let sampleHotel = null;
  let roomFieldsSeen = false;
  let pageSizeUsed = PAGE_SIZE;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const offset = page * pageSizeUsed;
    const { status, data } = await fetchPage({
      city,
      checkin: dateRow.checkin,
      checkout: dateRow.checkout,
      page,
      offset,
    });

    if (tokenLooksExpired(status, data)) {
      return {
        ok: false,
        tokenExpired: true,
        status,
        error: data?.error || data?.message || data,
        bands,
        pages,
        fetched,
      };
    }

    if (status >= 400) {
      return {
        ok: false,
        tokenExpired: false,
        status,
        error: data?.error || data?.message || data,
        bands,
        pages,
        fetched,
      };
    }

    const extracted = extractHotels(data);
    if (totalReported == null && extracted.total != null) totalReported = Number(extracted.total);
    if (totalPages == null && extracted.totalPages != null) totalPages = Number(extracted.totalPages);
    if (extracted.size) pageSizeUsed = Number(extracted.size) || pageSizeUsed;
    pages += 1;

    const hotels = extracted.hotels;
    if (!hotels.length) break;

    if (!sampleHotel && hotels[0]) {
      sampleHotel = hotels[0];
      sampleKeys = Object.keys(hotels[0]);
    }

    for (const h of hotels) {
      fetched += 1;
      const price = hotelPrice(h);
      const bandKey = bandOf(price);
      if (!bandKey) continue;
      const b = bands[bandKey];
      b.totalHotels += 1;

      const rooms = roomsOf(h);
      if (rooms.length) {
        roomFieldsSeen = true;
        b.totalRooms += rooms.length;
        let hotelRequiresPan = false;
        let hotelPanKnown = false;
        for (const r of rooms) {
          const panR = isPanMandatory(r);
          if (panR === true) {
            hotelRequiresPan = true;
            hotelPanKnown = true;
          } else if (panR === false) {
            hotelPanKnown = true;
            b.roomsWithoutPan += 1;
          } else {
            b.roomsPanUnknown += 1;
          }
        }
        if (hotelPanKnown && !hotelRequiresPan) b.hotelsWithoutPan += 1;
        else if (!hotelPanKnown) b.hotelsPanUnknown += 1;
      } else {
        const panH = isPanMandatory(h?.data?.roomDetail) ?? isPanMandatory(h);
        if (panH === false) b.hotelsWithoutPan += 1;
        else if (panH == null) b.hotelsPanUnknown += 1;
      }
    }

    if (extracted.last === true) break;
    if (totalPages != null && page + 1 >= totalPages) break;
    if (totalReported != null && fetched >= totalReported) break;
    if (hotels.length < pageSizeUsed) break;

    await sleep(SLEEP_MS);
  }

  return {
    ok: true,
    tokenExpired: false,
    pages,
    fetched,
    totalReported,
    totalPages,
    pageSizeUsed,
    roomFieldsSeen,
    sampleKeys,
    samplePriceFields: sampleHotel
      ? {
        totalPrice: sampleHotel?.data?.roomDetail?.priceDetail?.totalPrice,
        IsPANMandatory: roomsOf(sampleHotel)[0]?.IsPANMandatory ?? null,
        roomsLen: roomsOf(sampleHotel).length,
      }
      : null,
    bands,
  };
}

function sheetNumber(n) {
  if (n == null || n === '') return '';
  return Number(n).toLocaleString('en-IN');
}

function buildSheetCsv(matrix) {
  // Columns: Travel Date | Delhi(4) | Mumbai(4) | Bangalore(4)
  const cityOrder = ['DELHI', 'MUMBAI', 'Bangalore'];
  const bandBlocks = [
    { title: 'Hotels Below 5000', key: 'below5000' },
    { title: 'Hotels Below 5001- 7500', key: 'mid5001_7500' },
    { title: 'Hotels Above 7501', key: 'above7501' },
  ];

  const lines = [];
  for (const block of bandBlocks) {
    lines.push([block.title, ...Array(12).fill('')].join(','));
    lines.push(['Cities', 'DELHI', '', '', '', 'MUMBAI', '', '', '', 'Bangalore', '', '', ''].join(','));
    lines.push([
      'Travel Date',
      'Total Hotels', 'Hotel without PAN mandatory', 'Total Room Counts', 'Rooms without PAN Mandatory',
      'Total Hotels', 'Hotel without PAN mandatory', 'Total Room Counts', 'Rooms without PAN Mandatory',
      'Total Hotels', 'Hotel without PAN mandatory', 'Total Room Counts', 'Rooms without PAN Mandatory',
    ].join(','));

    for (const d of DATES) {
      const row = [d.label];
      for (const city of cityOrder) {
        const cell = matrix[city]?.[d.label]?.[block.key] || emptyBand();
        row.push(
          sheetNumber(cell.totalHotels),
          sheetNumber(cell.hotelsWithoutPan),
          sheetNumber(cell.totalRooms),
          sheetNumber(cell.roomsWithoutPan),
        );
      }
      lines.push(row.join(','));
    }
    lines.push('');
    lines.push('');
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function buildTsv(matrix) {
  // Tab-separated for easy Google Sheets paste
  return buildSheetCsv(matrix).replace(/,/g, '\t');
}

async function main() {
  if (!BEARER) {
    console.error('Missing SHOP_BEARER env. Set the shop Bearer token and re-run.');
    process.exit(2);
  }

  // Warm probe
  console.log('Probing Mumbai page 0…');
  const probe = await fetchPage({
    city: CITIES[1],
    checkin: DATES[1].checkin,
    checkout: DATES[1].checkout,
    page: 0,
    offset: 0,
  });
  if (tokenLooksExpired(probe.status, probe.data)) {
    console.error(JSON.stringify({
      ok: false,
      tokenExpired: true,
      status: probe.status,
      message: 'Shop Bearer token failed (expired/unauthorized). Paste a fresh token from shop.travelvip.ai and re-run.',
      body: probe.data,
    }, null, 2));
    process.exit(1);
  }
  if (probe.status >= 400) {
    console.error(JSON.stringify({ ok: false, status: probe.status, body: probe.data }, null, 2));
    process.exit(1);
  }

  const { hotels, total, totalPages, size } = extractHotels(probe.data);
  console.log(`Probe OK http=${probe.status} hotelsOnPage=${hotels.length} size=${size} total=${total} totalPages=${totalPages}`);
  if (hotels[0]) {
    console.log('Sample title:', hotels[0].title);
    console.log('Sample totalPrice:', hotels[0]?.data?.roomDetail?.priceDetail?.totalPrice);
    console.log('Sample room IsPANMandatory:', roomsOf(hotels[0])[0]?.IsPANMandatory);
    console.log('Sample rooms len:', roomsOf(hotels[0]).length);
  }

  const matrix = {};
  const runMeta = { ranAt: new Date().toISOString(), base: BASE, cities: {}, notes: [] };

  for (const city of CITIES) {
    matrix[city.key] = {};
    runMeta.cities[city.key] = {};
    for (const d of DATES) {
      console.log(`\n=== ${city.key} ${d.label} (${d.checkin}→${d.checkout}) ===`);
      const result = await collectCityDate(city, d);
      if (result.tokenExpired) {
        console.error(JSON.stringify({
          ok: false,
          tokenExpired: true,
          city: city.key,
          date: d.label,
          status: result.status,
          message: 'Token expired mid-run. Re-auth on shop and re-run with fresh SHOP_BEARER.',
          error: result.error,
        }, null, 2));
        process.exit(1);
      }
      if (!result.ok) {
        console.error('FAILED', city.key, d.label, result.status, result.error);
        matrix[city.key][d.label] = {
          below5000: emptyBand(),
          mid5001_7500: emptyBand(),
          above7501: emptyBand(),
        };
        runMeta.cities[city.key][d.label] = { ok: false, status: result.status, error: result.error };
        continue;
      }

      matrix[city.key][d.label] = result.bands;
      runMeta.cities[city.key][d.label] = {
        ok: true,
        pages: result.pages,
        fetched: result.fetched,
        totalReported: result.totalReported,
        roomFieldsSeen: result.roomFieldsSeen,
        sampleKeys: result.sampleKeys,
        samplePriceFields: result.samplePriceFields,
        bands: result.bands,
      };
      if (!result.roomFieldsSeen) {
        runMeta.notes.push(`${city.key} ${d.label}: compact listing had no rooms[] — room columns left blank`);
      }
      console.log(
        `pages=${result.pages} fetched=${result.fetched} total=${result.totalReported}`
        + ` | <5k=${result.bands.below5000.totalHotels}`
        + ` mid=${result.bands.mid5001_7500.totalHotels}`
        + ` >7.5k=${result.bands.above7501.totalHotels}`
        + ` roomsSeen=${result.roomFieldsSeen}`,
      );
    }
  }

  const outDir = path.join('reports');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const csvPath = path.join(outDir, `riya-hotel-analysis-${stamp}.csv`);
  const tsvPath = path.join(outDir, `riya-hotel-analysis-${stamp}.tsv`);
  const jsonPath = path.join(outDir, `riya-hotel-analysis-${stamp}.json`);

  fs.writeFileSync(csvPath, buildSheetCsv(matrix), 'utf8');
  fs.writeFileSync(tsvPath, buildTsv(matrix), 'utf8');
  fs.writeFileSync(jsonPath, JSON.stringify({ runMeta, matrix }, null, 2), 'utf8');

  console.log('\nWrote:');
  console.log('-', csvPath);
  console.log('-', tsvPath, '(paste into Google Sheets)');
  console.log('-', jsonPath);
  if (runMeta.notes.length) {
    console.log('\nNotes:');
    for (const n of [...new Set(runMeta.notes)]) console.log('-', n);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
