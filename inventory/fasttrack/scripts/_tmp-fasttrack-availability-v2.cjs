const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const TOKEN =
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiI2YWM3NDZiZGMzYTVmNS41MDk2MzE1MyIsInRva2VuRGF0ZSI6IjIwMjYtMTAtMDggMDc6MzE6MTAifQ.v8XAKHRqrUWqjLOCsugLrjXkl_CtCmX1vx7K2FowE8g0V2';
const BASE = 'https://api.travelvip.ai';
const COMMON =
  'key=palsgcvgscvvs&pid=smt&platform=web&client=web&lang=en&currency=INR';

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/json, text/plain, */*',
  'content-type': 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json };
}

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json };
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[–—]/g, '-')
    .trim();
}

/** Sheet often has "International Arrival|Arrival" — prefer the International* token. */
function sideCandidates(direction) {
  const raw = String(direction || '').trim();
  if (!raw) return [];
  const parts = raw
    .split('|')
    .map((p) => p.trim())
    .filter(Boolean);
  const uniq = [...new Set(parts)];
  // prefer more specific first
  uniq.sort((a, b) => {
    const score = (x) =>
      /international/i.test(x) ? 0 : /domestic/i.test(x) ? 1 : 2;
    return score(a) - score(b) || b.length - a.length;
  });
  return uniq;
}

function extractCarouselProducts(carouselJson) {
  const products = [];
  for (const b of carouselJson?.results || []) {
    if (b?.type === 'fasttrack-details' || b?.contentType === 'PRODUCTS') {
      for (const p of b.data || []) products.push(p);
    }
  }
  return products;
}

function optionMatches(opt, terminal, side, security) {
  const tOk = !terminal || norm(opt.terminal) === norm(terminal);
  const sOk = !side || norm(opt.direction) === norm(side);
  const secSheet = String(security || '').replace(/-/g, ' ');
  const secOpt = String(opt.security || '').replace(/-/g, ' ');
  const secOk = !security || norm(secSheet) === norm(secOpt);
  return tOk && sOk && secOk;
}

function titleLooseMatch(apiTitle, sheetTitle, cleanTitle) {
  const a = norm(apiTitle);
  return [sheetTitle, cleanTitle]
    .map(norm)
    .filter(Boolean)
    .some((c) => a.includes(c) || c.includes(a) || a === c);
}

(async () => {
  const sheetPath = path.join(
    process.env.USERPROFILE || '',
    'Downloads',
    'FastTrack_Service_Locations_MERGED.xlsx'
  );
  const wb = XLSX.readFile(sheetPath);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
    defval: null,
  });

  const byIata = new Map();
  for (const r of rows) {
    const iata = String(r.IATA || '').trim().toUpperCase();
    if (!iata) continue;
    if (!byIata.has(iata)) byIata.set(iata, []);
    byIata.get(iata).push(r);
  }

  console.log(`Sheet rows: ${rows.length}, unique IATA: ${byIata.size}`);

  const airportMap = {};
  let i = 0;
  for (const iata of byIata.keys()) {
    i++;
    const url = `${BASE}/api/airportServices/airport-services?${COMMON}&q=${encodeURIComponent(
      iata
    )}&page=0&size=20&type=fasttrack`;
    const res = await get(url);
    const results = res.json?.results || [];
    const hit =
      results.find((x) => String(x.airportCode || '').toUpperCase() === iata) ||
      null;
    airportMap[iata] = {
      searchHttp: res.status,
      found: !!hit,
      entityId: hit?.entityId || null,
      title: hit?.title || null,
      availableCount: hit?.availableCount ?? 0,
      terminals: hit?.terminals || [],
      terminalSides: hit?.terminalSides || [],
      terminalInfo: hit?.terminalInfo || [],
    };
    if (i % 25 === 0) console.log(`search ${i}/${byIata.size}`);
    await sleep(100);
  }

  // Build filter keys using each side candidate
  const filterKeys = new Map();
  for (const [iata, list] of byIata.entries()) {
    const air = airportMap[iata];
    if (!air?.entityId) continue;
    for (const r of list) {
      const terminal = String(r.Terminal || r['Vendor Terminal'] || '').trim();
      for (const side of sideCandidates(r['Direction (Arrival/Departure)'])) {
        const key = `${air.entityId}||${terminal}||${side}`;
        if (!filterKeys.has(key)) {
          filterKeys.set(key, { entityId: air.entityId, iata, terminal, side });
        }
      }
    }
  }
  console.log(`Carousel filter combos: ${filterKeys.size}`);

  const carouselCache = {};
  let c = 0;
  for (const [key, f] of filterKeys.entries()) {
    c++;
    const url = `${BASE}/api/airportServices/carousels?${COMMON}&type=tab&slug=fasttrack-list&size=20`;
    const res = await post(url, {
      appliedFilters: {
        airportId: String(f.entityId),
        terminal: f.terminal,
        terminalSide: f.side,
      },
    });
    const products = extractCarouselProducts(res.json);
    carouselCache[key] = {
      http: res.status,
      productCount: products.length,
      products: products.map((p) => ({
        productId: p.productId,
        title: p.title,
        availableOptions: (p.availableOptions || []).map((o) => ({
          optionId: o.optionId,
          title: o.title,
          terminal: o.terminal,
          direction: o.direction,
          security: o.security,
        })),
        startingPrice: p.startingPrice?.totalAmount ?? null,
      })),
    };
    if (c % 30 === 0) console.log(`carousel ${c}/${filterKeys.size}`);
    await sleep(120);
  }

  const reportRows = [];
  for (const r of rows) {
    const iata = String(r.IATA || '').trim().toUpperCase();
    const air = airportMap[iata] || {
      found: false,
      entityId: null,
      availableCount: 0,
      terminals: [],
      terminalSides: [],
      terminalInfo: [],
    };
    const terminal = String(r.Terminal || r['Vendor Terminal'] || '').trim();
    const sides = sideCandidates(r['Direction (Arrival/Departure)']);
    const security = String(r['Security (Pre/Post)'] || '').trim();
    const title = r.Title;
    const clean = r['Clean Title'];
    const rawDirection = String(r['Direction (Arrival/Departure)'] || '').trim();

    let searchStatus = 'NOT FOUND';
    if (air.found && air.availableCount > 0) searchStatus = 'AVAILABLE';
    else if (air.found) searchStatus = 'FOUND ZERO';

    let searchTerminalMatch = 'N/A';
    if (air.found) {
      const termOk = (air.terminals || []).some(
        (t) => norm(t) === norm(terminal)
      );
      const sideOk = sides.some((side) =>
        (air.terminalSides || []).some((s) => norm(s) === norm(side))
      );
      const info = (air.terminalInfo || []).find(
        (ti) => norm(ti.name) === norm(terminal)
      );
      const sideOnTerm =
        info &&
        sides.some((side) =>
          (info.sides || []).some((s) => norm(s) === norm(side))
        );
      if (termOk && sideOk && sideOnTerm) searchTerminalMatch = 'MATCH';
      else if (termOk || sideOk) searchTerminalMatch = 'PARTIAL';
      else searchTerminalMatch = 'MISSING';
    }

    let carouselStatus = 'SKIPPED';
    let matchedOption = null;
    let matchedProduct = null;
    let usedSide = null;

    if (!air.entityId) {
      carouselStatus = 'NO AIRPORT ID';
    } else {
      // try each side candidate until we get a matching option
      let anyProducts = false;
      let anyHttpOk = false;
      for (const side of sides) {
        const key = `${air.entityId}||${terminal}||${side}`;
        const car = carouselCache[key];
        if (!car) continue;
        if (car.http === 200) anyHttpOk = true;
        if (car.products?.length) anyProducts = true;

        for (const p of car.products || []) {
          const hitSec = (p.availableOptions || []).find((o) =>
            optionMatches(o, terminal, side, security)
          );
          if (hitSec) {
            matchedProduct = p;
            matchedOption = hitSec;
            usedSide = side;
            break;
          }
        }
        if (matchedOption) break;
        for (const p of car.products || []) {
          const hit = (p.availableOptions || []).find((o) =>
            optionMatches(o, terminal, side, null)
          );
          if (hit) {
            matchedProduct = p;
            matchedOption = hit;
            usedSide = side;
            carouselStatus = 'AVAILABLE (sec mismatch)';
            break;
          }
        }
        if (matchedOption) break;
      }

      if (matchedOption && carouselStatus === 'SKIPPED') {
        const titleOk = titleLooseMatch(matchedProduct.title, title, clean);
        carouselStatus = titleOk ? 'AVAILABLE' : 'AVAILABLE (title differs)';
      } else if (!matchedOption) {
        if (!anyHttpOk) carouselStatus = 'HTTP ERROR';
        else if (!anyProducts) carouselStatus = 'EMPTY';
        else carouselStatus = 'FILTER HIT NO OPTION';
      }
    }

    reportRows.push({
      vendorId: r.VendorId,
      title,
      cleanTitle: clean,
      iata,
      terminal,
      direction: rawDirection,
      directionUsed: usedSide,
      security,
      searchAirport: searchStatus,
      searchEntityId: air.entityId,
      searchAvailableCount: air.availableCount ?? 0,
      searchTerminalSide: searchTerminalMatch,
      carousel: carouselStatus,
      carouselProductTitle: matchedProduct?.title || null,
      carouselOption: matchedOption
        ? `${matchedOption.terminal} | ${matchedOption.direction} | ${matchedOption.security}`
        : null,
      priceInr: matchedProduct?.startingPrice ?? null,
    });
  }

  const summary = {
    sheetRows: rows.length,
    uniqueIata: byIata.size,
    searchAvailable: reportRows.filter((r) => r.searchAirport === 'AVAILABLE')
      .length,
    searchNotFound: reportRows.filter((r) => r.searchAirport === 'NOT FOUND')
      .length,
    carouselAvailable: reportRows.filter((r) =>
      String(r.carousel).startsWith('AVAILABLE')
    ).length,
    carouselAvailableExact: reportRows.filter((r) => r.carousel === 'AVAILABLE')
      .length,
    carouselTitleDiffers: reportRows.filter(
      (r) => r.carousel === 'AVAILABLE (title differs)'
    ).length,
    carouselSecMismatch: reportRows.filter(
      (r) => r.carousel === 'AVAILABLE (sec mismatch)'
    ).length,
    carouselEmpty: reportRows.filter((r) => r.carousel === 'EMPTY').length,
    carouselNoAirport: reportRows.filter(
      (r) => r.carousel === 'NO AIRPORT ID'
    ).length,
    carouselFilterNoOption: reportRows.filter(
      (r) => r.carousel === 'FILTER HIT NO OPTION'
    ).length,
  };

  const out = {
    generatedAt: new Date().toISOString(),
    env: BASE,
    pid: 'smt',
    summary,
    airportMap,
    rows: reportRows,
  };

  const reportDir = path.join(__dirname, '..', 'reports');
  fs.writeFileSync(
    path.join(reportDir, 'fasttrack-sheet-availability.json'),
    JSON.stringify(out, null, 2)
  );

  const cols = [
    'vendorId',
    'iata',
    'title',
    'terminal',
    'direction',
    'directionUsed',
    'security',
    'searchAirport',
    'searchAvailableCount',
    'searchTerminalSide',
    'carousel',
    'carouselProductTitle',
    'carouselOption',
    'priceInr',
  ];
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  fs.writeFileSync(
    path.join(reportDir, 'fasttrack-sheet-availability.csv'),
    [
      cols.join(','),
      ...reportRows.map((r) => cols.map((c) => esc(r[c])).join(',')),
    ].join('\n')
  );

  console.log(JSON.stringify(summary, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
