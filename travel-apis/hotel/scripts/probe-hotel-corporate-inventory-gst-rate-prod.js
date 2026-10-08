/**
 * Prod hotel dump: GST Claimable + Rate per Night for corporate inventory CSV.
 * Search + details only — NO book / prebook / finalize.
 *
 *   BASE_URL=https://api.travelvip.ai node scripts/probe-hotel-corporate-inventory-gst-rate-prod.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';

process.env.BASE_URL = process.env.BASE_URL || 'https://api.travelvip.ai';
process.env.PARTNER_ID = process.env.PARTNER_ID || 'vgm';
process.env.PARTNER_SECRET = process.env.PARTNER_SECRET || 'vgm_preprod_ojny1swtigd4as';
process.env.SIGNING_KEY = process.env.SIGNING_KEY || 'sk_live_yg81bca5xno1ypvhla';
process.env.TIER_ID = process.env.TIER_ID || '19597201';

const CHECKIN = process.env.HOTEL_CHECKIN || '2026-10-20';
const CHECKOUT = process.env.HOTEL_CHECKOUT || '2026-10-21';
const PID = 'vgm';
const IN_CSV = path.join(
  process.cwd(),
  'Corporate-Relevvant-Hotels-Sept-2026 - Corporate hotel inventory.csv',
);
const OUT_CSV = path.join('reports', 'corporate-hotels-gst-rate-prod.csv');
const OUT_JSON = path.join('reports', 'corporate-hotels-gst-rate-prod.json');
const LIMIT = Number(process.env.LIMIT || 0); // 0 = all
const OFFSET = Number(process.env.OFFSET || 0);

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function escapeCsv(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function loadRows(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  // skip blank header row ",,,,,,,"
  let start = 0;
  if (lines[0] && !/^Sr\.?\s*No/i.test(lines[0])) start = 1;
  const header = parseCsvLine(lines[start]);
  const rows = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    if (!cols[0] || !/^\d+$/.test(cols[0])) continue;
    rows.push({
      sr: cols[0],
      city: cols[1] || '',
      priceBand: cols[2] || '',
      hotel: cols[3] || '',
      category: cols[4] || '',
      location: cols[5] || '',
      gst: cols[6] || '',
      rate: cols[7] || '',
    });
  }
  return { header, rows };
}

function parseBand(band) {
  const s = String(band || '').replace(/₹/g, '').replace(/,/g, '').toLowerCase();
  if (/below/.test(s)) {
    const m = s.match(/(\d+)/);
    return { kind: 'below', max: m ? Number(m[1]) : 3000 };
  }
  if (/above/.test(s)) {
    const m = s.match(/(\d+)/);
    return { kind: 'above', min: m ? Number(m[1]) : 7500 };
  }
  const range = s.match(/(\d+)\s*[–\-]\s*(\d+)/);
  if (range) return { kind: 'range', min: Number(range[1]), max: Number(range[2]) };
  return { kind: 'any' };
}

function inBand(amount, band) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return false;
  if (band.kind === 'below') return n < band.max;
  if (band.kind === 'above') return n > band.min;
  if (band.kind === 'range') return n >= band.min && n <= band.max;
  return true;
}

/** Parse sheet Category → allowed star ratings (and soft tags). */
function parseCategoryFilter(category) {
  const s = String(category || '').toLowerCase();
  const stars = new Set();
  for (const m of s.matchAll(/(\d)\s*[- ]?\s*star/g)) stars.add(Number(m[1]));
  // "3-Star/4-Star" or "4-Star style"
  for (const m of s.matchAll(/(\d)\s*★/g)) stars.add(Number(m[1]));
  const tags = {
    budget: /budget|hostel/.test(s),
    hostel: /hostel/.test(s),
    serviced: /serviced\s*apartment|apartment/.test(s),
  };
  return {
    stars: [...stars].sort(),
    requireStar: stars.size > 0,
    tags,
    raw: String(category || '').trim(),
  };
}

function starMatches(starRating, catFilter) {
  if (!catFilter?.requireStar) return true; // no star constraint in sheet
  const n = Number(starRating);
  if (!Number.isFinite(n) || n <= 0) {
    // Budget/hostel often unrated — allow if category is budget/hostel only
    if (!catFilter.requireStar) return true;
    if (catFilter.tags.budget || catFilter.tags.hostel) return true;
    return false;
  }
  return catFilter.stars.includes(n);
}

function filterOk(rate, starRating, band, catFilter) {
  return inBand(rate, band) && starMatches(starRating, catFilter);
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreHit(hit, hotelName, city, location) {
  const title = norm(hit.title || hit.name || '');
  const h = norm(hotelName);
  if (!title || !h) return 0;
  let score = 0;
  if (title === h) score += 100;
  else if (title.includes(h) || h.includes(title)) score += 60;
  else {
    const tw = new Set(title.split(' '));
    const hw = h.split(' ').filter((w) => w.length > 2);
    const overlap = hw.filter((w) => tw.has(w)).length;
    score += overlap * 8;
  }
  const type = String(hit.type || '').toUpperCase();
  if (type === 'HOTEL') score += 25;
  const blob = `${title} ${norm(hit.subtitle || hit.address || hit.city || '')}`;
  const loc = norm(location);
  const cityN = norm(city).replace(/\s*ncr\s*/g, ' ');
  if (loc && blob.includes(loc.split(' ')[0])) score += 10;
  if (cityN && blob.includes(cityN.split(' ')[0])) score += 8;
  return score;
}

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function roomRate(room) {
  return money(
    room?.price?.totalAmount
      ?? room?.price?.baseFare
      ?? room?.totalAmount
      ?? room?.baseFare,
  );
}

function roomGst(room) {
  if (room?.isGSTClaimable === true || room?.isGstClaimable === true) return true;
  if (room?.isGSTClaimable === false || room?.isGstClaimable === false) return false;
  return null;
}

function preferIndia(hits) {
  const inHits = hits.filter((x) => String(x.hit.entityId || '').endsWith(':IN') || /india|mumbai|delhi|bengaluru|bangalore|hyderabad|noida|gurugram|gurgaon|indore|pune|chennai|kolkata/i.test(`${x.hit.subtitle || ''} ${x.hit.title || ''}`));
  return inHits.length ? inHits : hits;
}

async function resolveHotel(hotelSvc, row) {
  // Autocomplete page must be 0 (page 1 often empty). Prefer hotel name alone —
  // appending location often returns 0 hits on prod.
  const queries = [
    row.hotel,
    row.hotel.replace(/,.*$/, '').trim(),
    row.hotel.split(/[-–@]/)[0].trim(),
    `${row.hotel} ${String(row.city || '').replace(/NCR/i, '').trim()}`.trim(),
  ].filter((q, i, a) => q && a.indexOf(q) === i);

  let best = null;
  let usedQuery = '';
  for (const q of queries) {
    const auto = await hotelSvc.autocomplete(q, 0, 20);
    const content = Array.isArray(auto.data?.content) ? auto.data.content : [];
    const ranked = preferIndia(
      content
        .map((h) => ({ hit: h, score: scoreHit(h, row.hotel, row.city, row.location) }))
        .sort((a, b) => b.score - a.score),
    );
    if (ranked[0] && ranked[0].score >= 15) {
      best = ranked[0];
      usedQuery = q;
      break;
    }
    if (!best && ranked[0]) {
      best = ranked[0];
      usedQuery = q;
    }
  }

  if (!best || best.score < 12) {
    return {
      ok: false,
      reason: 'NO_MATCH',
      query: queries[0],
      top: best ? [{ title: best.hit.title, type: best.hit.type, score: best.score }] : [],
    };
  }
  return {
    ok: true,
    entityId: String(best.hit.entityId),
    matchedName: best.hit.title || best.hit.name,
    type: best.hit.type,
    score: best.score,
    query: usedQuery,
  };
}

async function searchHotel(hotelSvc, entityId) {
  const body = {
    checkin: CHECKIN,
    checkout: CHECKOUT,
    entityId: String(entityId),
    nationality: 'IN',
    type: 'HOTEL',
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
    currency: 'INR',
    lang: 'en',
    language: 'en',
    pid: PID,
    rt: 'compact',
    filters: { refundable: 0, noOfRooms: 0, mealType: 0 },
    fq: [],
    requestId: '',
  };
  return hotelSvc.search(body, { pid: PID, page: 0, perpage: 20 });
}

async function detailsHotel(hotelSvc, entityId) {
  const body = {
    checkin: CHECKIN,
    checkout: CHECKOUT,
    entityId: String(entityId),
    nationality: 'IN',
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
  };
  return hotelSvc.getDetails(body);
}

function pickFromSearch(searchRes, band, catFilter) {
  const h = (searchRes.data?.results || [])[0] || null;
  if (!h) return null;
  const rate = money(h.price?.totalAmount ?? h.price?.baseFare);
  const gst = h.isGSTClaimable === true || h.isGstClaimable === true
    ? true
    : h.isGSTClaimable === false || h.isGstClaimable === false
      ? false
      : null;
  const star = Number(h.starRating ?? h.star ?? NaN);
  return {
    source: 'search',
    hotelId: h.id,
    name: h.name,
    rate,
    gst,
    starRating: Number.isFinite(star) ? star : null,
    available: h.available !== false && rate != null,
    inBand: rate != null ? inBand(rate, band) : false,
    starOk: starMatches(star, catFilter),
    filterOk: rate != null ? filterOk(rate, star, band, catFilter) : false,
  };
}

function pickFromDetails(detailsRes, band, catFilter, searchStar) {
  const hotel = (detailsRes.data?.results || [])[0] || detailsRes.data || {};
  const hotelStar = Number(
    hotel.starRating ?? hotel.star ?? searchStar ?? NaN,
  );
  const rooms = Array.isArray(hotel.rooms) ? hotel.rooms : [];
  const priced = rooms
    .map((r) => ({
      room: r,
      rate: roomRate(r),
      gst: roomGst(r),
      name: r.roomType || r.name || r.roomName || '',
      star: Number(r.starRating ?? hotelStar ?? NaN),
    }))
    .filter((x) => x.rate != null)
    .sort((a, b) => a.rate - b.rate);

  if (!priced.length) {
    return {
      source: 'details',
      rate: null,
      gst: null,
      starRating: Number.isFinite(hotelStar) ? hotelStar : null,
      starOk: starMatches(hotelStar, catFilter),
      roomCount: rooms.length,
    };
  }

  // Prefer room whose rate is in price band AND hotel star matches category
  const both = priced.filter((x) => filterOk(x.rate, hotelStar, band, catFilter));
  const bandOnly = priced.filter((x) => inBand(x.rate, band));
  const pick = both[0] || bandOnly[0] || priced[0];
  const starOk = starMatches(hotelStar, catFilter);
  return {
    source: 'details',
    rate: pick.rate,
    gst: pick.gst,
    roomName: pick.name,
    roomCount: rooms.length,
    starRating: Number.isFinite(hotelStar) ? hotelStar : null,
    starOk,
    inBand: inBand(pick.rate, band),
    filterOk: filterOk(pick.rate, hotelStar, band, catFilter),
    usedFilterMatch: both.length > 0,
    usedBandMatch: bandOnly.length > 0,
    bandMinRate: priced[0].rate,
    bandMaxRate: priced[priced.length - 1].rate,
  };
}

function gstYesNo(v) {
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  return '';
}

async function main() {
  console.log('=== Corporate hotels GST + rate (prod, search+details, no book) ===');
  console.log('BASE', process.env.BASE_URL, CHECKIN, '→', CHECKOUT);
  const { rows } = loadRows(IN_CSV);
  const slice = rows.slice(OFFSET, LIMIT > 0 ? OFFSET + LIMIT : undefined);
  console.log(`Hotels: ${slice.length} (offset=${OFFSET} of ${rows.length})`);

  clearSession();
  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const hotelSvc = new HotelService(session.client);

  const results = [];
  fs.mkdirSync('reports', { recursive: true });

  // write header immediately
  const headerLine = [
    'Sr. No',
    'City',
    'Price Band',
    'Hotel',
    'Category',
    'Location',
    'GST Claimable (Yes/No)',
    'Rate per Night (20 Oct 2026)',
    'Matched Hotel',
    'EntityId',
    'API Star Rating',
    'In Price Band',
    'Star Match',
    'Filter Match',
    'Status',
    'Notes',
  ].join(',');
  fs.writeFileSync(OUT_CSV, `${headerLine}\n`);

  for (let i = 0; i < slice.length; i += 1) {
    const row = slice[i];
    const band = parseBand(row.priceBand);
    const catFilter = parseCategoryFilter(row.category);
    process.stdout.write(
      `\n[${i + 1}/${slice.length}] #${row.sr} ${row.hotel} (${row.city.trim()} / ${row.priceBand.trim()} / ${row.category.trim()}) `,
    );

    const out = {
      ...row,
      gstOut: '',
      rateOut: '',
      matchedName: '',
      entityId: '',
      apiStar: '',
      inBand: '',
      starMatch: '',
      filterMatch: '',
      status: '',
      notes: '',
    };

    try {
      const resolved = await resolveHotel(hotelSvc, row);
      if (!resolved.ok) {
        out.status = 'NOT_FOUND';
        out.notes = resolved.reason;
        console.log('NOT_FOUND');
      } else {
        out.entityId = resolved.entityId;
        out.matchedName = resolved.matchedName;
        const searchRes = await searchHotel(hotelSvc, resolved.entityId);
        const fromSearch = pickFromSearch(searchRes, band, catFilter);

        let fromDetails = null;
        if (searchRes.ok) {
          const det = await detailsHotel(hotelSvc, resolved.entityId);
          if (det.ok) fromDetails = pickFromDetails(det, band, catFilter, fromSearch?.starRating);
          else out.notes = `details http=${det.status}`;
        } else {
          out.notes = `search http=${searchRes.status} code=${searchRes.data?.error?.code || ''}`;
        }

        let rate = null;
        let gst = null;
        let star = fromDetails?.starRating ?? fromSearch?.starRating ?? null;
        let inB = false;
        let starOk = false;
        let filtOk = false;

        // Prefer details room matching BOTH price band + star category
        if (fromDetails?.usedFilterMatch) {
          rate = fromDetails.rate;
          gst = fromDetails.gst ?? fromSearch?.gst;
          star = fromDetails.starRating;
          inB = true;
          starOk = true;
          filtOk = true;
          out.notes = `details room match band+star (${fromDetails.roomName || 'room'}; ★${star ?? '-'})`;
        } else if (fromSearch?.filterOk) {
          rate = fromSearch.rate;
          gst = fromSearch.gst ?? fromDetails?.gst;
          star = fromSearch.starRating;
          inB = true;
          starOk = true;
          filtOk = true;
          out.notes = `search match band+star (★${star ?? '-'})`;
        } else if (fromDetails?.usedBandMatch && fromDetails?.starOk) {
          rate = fromDetails.rate;
          gst = fromDetails.gst ?? fromSearch?.gst;
          star = fromDetails.starRating;
          inB = true;
          starOk = true;
          filtOk = true;
          out.notes = `details band+star ok (${fromDetails.roomName || 'room'})`;
        } else if (fromDetails?.rate != null) {
          rate = fromDetails.rate;
          gst = fromDetails.gst ?? fromSearch?.gst;
          star = fromDetails.starRating;
          inB = inBand(rate, band);
          starOk = starMatches(star, catFilter);
          filtOk = filterOk(rate, star, band, catFilter);
          const wantStars = catFilter.stars.length ? catFilter.stars.join('/') : 'any';
          out.notes = filtOk
            ? 'details cheapest'
            : `no band+star room (api★=${star ?? 'n/a'} want★=${wantStars}; rates ${fromDetails.bandMinRate}–${fromDetails.bandMaxRate})`;
        } else if (fromSearch?.rate != null) {
          rate = fromSearch.rate;
          gst = fromSearch.gst;
          star = fromSearch.starRating;
          inB = inBand(rate, band);
          starOk = starMatches(star, catFilter);
          filtOk = filterOk(rate, star, band, catFilter);
          out.notes = filtOk ? 'search only' : `search outside filter (api★=${star ?? 'n/a'})`;
        } else {
          out.status = 'NO_AVAIL';
          out.notes = out.notes || 'no priced rooms';
        }

        if (rate != null) {
          out.rateOut = rate;
          out.gstOut = gstYesNo(gst);
          out.apiStar = star ?? '';
          out.inBand = inB ? 'Yes' : 'No';
          out.starMatch = catFilter.requireStar ? (starOk ? 'Yes' : 'No') : 'N/A';
          out.filterMatch = filtOk ? 'Yes' : 'No';
          if (filtOk) out.status = 'OK';
          else if (!starOk && catFilter.requireStar && inB) out.status = 'STAR_MISMATCH';
          else if (!inB && starOk) out.status = 'OUT_OF_BAND';
          else if (!inB && !starOk) out.status = 'FILTER_MISMATCH';
          else out.status = 'FILTER_MISMATCH';
        } else if (!out.status) {
          out.status = 'NO_AVAIL';
        }
        console.log(
          `${out.status} gst=${out.gstOut || '-'} rate=${out.rateOut || '-'} ★${out.apiStar || '-'} match=${out.matchedName}`,
        );
      }
    } catch (e) {
      out.status = 'ERROR';
      out.notes = String(e?.message || e).slice(0, 200);
      console.log('ERROR', out.notes);
    }

    results.push(out);
    const line = [
      out.sr,
      out.city,
      out.priceBand,
      out.hotel,
      out.category,
      out.location,
      out.gstOut,
      out.rateOut,
      out.matchedName,
      out.entityId,
      out.apiStar,
      out.inBand,
      out.starMatch,
      out.filterMatch,
      out.status,
      out.notes,
    ].map(escapeCsv).join(',');
    fs.appendFileSync(OUT_CSV, `${line}\n`);

    // checkpoint json every 25
    if ((i + 1) % 25 === 0 || i === slice.length - 1) {
      fs.writeFileSync(
        OUT_JSON,
        JSON.stringify({
          at: new Date().toISOString(),
          base: process.env.BASE_URL,
          checkin: CHECKIN,
          checkout: CHECKOUT,
          noBook: true,
          filterMode: 'priceBand + category/starRating',
          done: i + 1,
          total: slice.length,
          summary: {
            OK: results.filter((r) => r.status === 'OK').length,
            OUT_OF_BAND: results.filter((r) => r.status === 'OUT_OF_BAND').length,
            STAR_MISMATCH: results.filter((r) => r.status === 'STAR_MISMATCH').length,
            FILTER_MISMATCH: results.filter((r) => r.status === 'FILTER_MISMATCH').length,
            NOT_FOUND: results.filter((r) => r.status === 'NOT_FOUND').length,
            NO_AVAIL: results.filter((r) => r.status === 'NO_AVAIL').length,
            ERROR: results.filter((r) => r.status === 'ERROR').length,
          },
          results,
        }, null, 2),
      );
    }
  }

  // clean sheet with only original columns + filled G/H (only when band+star filter matches)
  const cleanPath = path.join('reports', 'corporate-hotels-gst-rate-prod-sheet.csv');
  const clean = [
    'Sr. No,City,Price Band,Hotel,Category,Location,GST Claimable (Yes/No),Rate per Night (20 Oct 2026)',
  ];
  for (const r of results) {
    const fill = r.status === 'OK';
    clean.push(
      [r.sr, r.city, r.priceBand, r.hotel, r.category, r.location, fill ? r.gstOut : '', fill ? r.rateOut : '']
        .map(escapeCsv)
        .join(','),
    );
  }
  fs.writeFileSync(cleanPath, `${clean.join('\n')}\n`);

  console.log('\n=== DONE ===');
  console.log(JSON.stringify({
    OK: results.filter((r) => r.status === 'OK').length,
    OUT_OF_BAND: results.filter((r) => r.status === 'OUT_OF_BAND').length,
    STAR_MISMATCH: results.filter((r) => r.status === 'STAR_MISMATCH').length,
    FILTER_MISMATCH: results.filter((r) => r.status === 'FILTER_MISMATCH').length,
    NOT_FOUND: results.filter((r) => r.status === 'NOT_FOUND').length,
    NO_AVAIL: results.filter((r) => r.status === 'NO_AVAIL').length,
    ERROR: results.filter((r) => r.status === 'ERROR').length,
  }));
  console.log('Sheet:', cleanPath);
  console.log('Detailed:', OUT_CSV);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
