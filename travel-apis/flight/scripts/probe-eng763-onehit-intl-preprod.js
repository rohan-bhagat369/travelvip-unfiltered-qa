/**
 * ENG-763 intl check — ONE search tree, ONE price hop. No book. No date loop.
 * fareType = "Normal, Corporate, SME". Default RT_INTL bucket DEL↔DXB.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import { isSearchProgressComplete } from '../src/helpers.js';
import { collectOptions } from '../src/searchPicker.js';
import { futureDate, sleep } from '../../../shared/lib/testUtils.js';

process.env.ALLOW_BOOK = 'false';
process.env.BASE_URL = process.env.BASE_URL || 'https://preprod-api.travelvip.ai';
process.env.PARTNER_ID = process.env.PARTNER_ID || 'vgm';
process.env.PARTNER_SECRET = process.env.PARTNER_SECRET || 'vgm_preprod_ojny1swtigd4as';
process.env.TIER_ID = process.env.TIER_ID || '19597201';
process.env.SIGNING_KEY = process.env.SIGNING_KEY || 'sk_live_yg81bca5xno1ypvhla';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '../reports/preprod-mixed-fare-pr1505/onehit-intl-rt.json');

const ORIGIN = process.env.FLIGHT_ORIGIN || 'DEL';
const DEST = process.env.FLIGHT_DESTINATION || 'DXB';
const ONWARD_DAYS = Number(process.env.FLIGHT_ONWARD_DAYS || '40');
const RETURN_DAYS = Number(process.env.FLIGHT_RETURN_DAYS || String(ONWARD_DAYS + 2));
const ONWARD_DATE = process.env.FLIGHT_SEARCH_DATE || futureDate(ONWARD_DAYS);
const RETURN_DATE = process.env.FLIGHT_RETURN_DATE || futureDate(RETURN_DAYS);
const FARE_TYPE = process.env.FLIGHT_FARE_TYPE || 'NORMAL, CORPORATE, SME';
const MAX_STOPS = process.env.FLIGHT_MAX_STOPS != null && process.env.FLIGHT_MAX_STOPS !== ''
  ? Number(process.env.FLIGHT_MAX_STOPS)
  : 0;

function cat(f) {
  const c = String(f?.fareCategory || f?.fareType || '').toUpperCase();
  if (!c) return null;
  if (c.includes('CORPORATE') || c === 'CORP') return 'CORPORATE';
  if (c.includes('SME')) return 'SME';
  if (c.includes('NORMAL') || c.includes('FLEXI') || c.includes('UPFRONT') || c.includes('STRETCH') || c.includes('PUBLISH')) {
    return 'NORMAL';
  }
  return c;
}

function airline(opt) {
  return String(opt?.segments?.[0]?.airline?.code || opt?.segments?.[0]?.airlineCode || '').toUpperCase();
}

function label(opt) {
  return (opt?.segments || [])
    .map((s) => `${String(s.airline?.code || s.airlineCode || '').toUpperCase()} ${s.flightNumber || ''}`.trim())
    .join('/');
}

function pickByCat(options, want) {
  for (const opt of options || []) {
    for (const f of opt.fares || []) {
      if (cat(f) === want && (f.searchId || opt.searchId)) {
        return {
          searchId: f.searchId || opt.searchId,
          category: want,
          fareType: f.fareType,
          fareCategory: f.fareCategory,
          airline: airline(opt),
          label: label(opt),
        };
      }
    }
  }
  return null;
}

function catsIn(options) {
  return [...new Set((options || []).flatMap((o) => (o.fares || []).map(cat)).filter(Boolean))].sort();
}

async function searchUntil(flight, body, max = 18) {
  let last = null;
  for (let i = 0; i < max; i += 1) {
    last = await flight.search(body);
    const opts = collectOptions(last.data, 'ONWARD');
    if (last.ok && opts.length && (isSearchProgressComplete(last.data) || i >= 5)) return last;
    if (!last.ok && last.data?.error) return last;
    await sleep(last.data?.progress?.pollAfterMs || 2500);
  }
  return last;
}

async function refineReturn(flight, body, onwardId, max = 14) {
  const refined = { ...body, selection: { selectedSearchIds: [onwardId] } };
  let last = null;
  for (let i = 0; i < max; i += 1) {
    last = await flight.search(refined);
    if (collectOptions(last.data, 'RETURN').length || isSearchProgressComplete(last.data)) return last;
    await sleep(last.data?.progress?.pollAfterMs || 2500);
  }
  return last;
}

async function main() {
  clearSession();
  if (!/preprod/i.test(String(config.baseUrl))) {
    throw new Error(`Refuse non-preprod: ${config.baseUrl}`);
  }

  console.log('=== INTL ONE HIT — no book / no date loop ===');
  console.log('BASE', config.baseUrl);
  console.log('ROUTE', `${ORIGIN}-${DEST}-${ORIGIN}`, 'DATES', ONWARD_DATE, '→', RETURN_DATE);
  console.log('fareType:', FARE_TYPE, 'maxStops:', MAX_STOPS);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const flight = new FlightService(session.client);

  const body = {
    itinerary: [
      { origin: ORIGIN, destination: DEST, date: ONWARD_DATE },
      { origin: DEST, destination: ORIGIN, date: RETURN_DATE },
    ],
    travellers: { adults: 1, children: 0, infants: 0 },
    cabinClass: 'ECONOMY',
    journeyType: 'ROUND_TRIP',
    currency: 'INR',
    language: 'en',
    preferences: { airlines: [], maxStops: MAX_STOPS, refundableOnly: false },
    appliedFilters: {},
    selection: { selectedSearchIds: [] },
    fareType: FARE_TYPE,
  };

  const initial = await searchUntil(flight, body);
  const onwardOpts = collectOptions(initial.data, 'ONWARD');
  const onwardCats = catsIn(onwardOpts);
  console.log('search', initial.status, 'onward', onwardOpts.length, 'cats', onwardCats.join(',') || '(none)');

  if (!initial.ok || !onwardOpts.length) {
    const out = {
      when: new Date().toISOString(),
      status: 'BUG',
      reason: 'intl search no options',
      search: { http: initial.status, code: initial.data?.error?.code, error: initial.data?.error },
    };
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
    console.log('saved', OUT);
    return;
  }

  const onward = pickByCat(onwardOpts, 'SME')
    || pickByCat(onwardOpts, 'CORPORATE')
    || pickByCat(onwardOpts, 'NORMAL')
    || {
      searchId: onwardOpts[0]?.fares?.[0]?.searchId || onwardOpts[0]?.searchId,
      category: cat(onwardOpts[0]?.fares?.[0]) || 'UNKNOWN',
      airline: airline(onwardOpts[0]),
      label: label(onwardOpts[0]),
    };

  console.log('onward', onward.category, onward.label, onward.searchId);

  const retRes = await refineReturn(flight, body, onward.searchId);
  const returnOpts = collectOptions(retRes.data, 'RETURN');
  const returnCats = catsIn(returnOpts);
  console.log('return', returnOpts.length, 'cats', returnCats.join(',') || '(none)');

  const otherCats = returnCats.filter((c) => c !== onward.category && ['NORMAL', 'CORPORATE', 'SME'].includes(c));
  let mixedRet = null;
  for (const c of otherCats) {
    mixedRet = pickByCat(returnOpts, c);
    if (mixedRet && mixedRet.searchId !== onward.searchId) break;
    mixedRet = null;
  }

  const sameRet = pickByCat(returnOpts, onward.category)
    || (returnOpts[0]
      ? {
        searchId: returnOpts[0].fares?.[0]?.searchId || returnOpts[0].searchId,
        category: cat(returnOpts[0].fares?.[0]),
        airline: airline(returnOpts[0]),
        label: label(returnOpts[0]),
      }
      : null);

  // Prefer mix if available (to see if intl still blocks); else same-cat control — ONE pricing only
  const pick = (mixedRet && mixedRet.searchId !== onward.searchId)
    ? { kind: 'MIXED', ret: mixedRet }
    : (sameRet && sameRet.searchId !== onward.searchId)
      ? { kind: 'SAME', ret: sameRet }
      : null;

  if (!pick) {
    const out = {
      when: new Date().toISOString(),
      status: 'NOT TESTED',
      reason: 'no return pair',
      onward,
      returnCats,
      otherCats,
    };
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
    console.log('saved', OUT);
    return;
  }

  console.log('price kind', pick.kind, pick.ret.category, pick.ret.label);
  console.log('cooldown 4s — ONE pricing hit');
  await sleep(4000);

  const searchIds = [onward.searchId, pick.ret.searchId];
  const details = await flight.getDetails(searchIds, 'ROUND_TRIP');
  const pricing = await flight.getPricing(searchIds, 'ROUND_TRIP');
  const fareRules = await flight.getFareRules(searchIds, 'ROUND_TRIP');
  console.log('details', details.status, details.data?.error?.code || details.data?.fareType || 'ok');
  console.log('pricing', pricing.status, pricing.data?.error?.code || pricing.data?.priceId, 'fareType=', pricing.data?.fareType);
  console.log('fareRules', fareRules.status, fareRules.data?.error?.code || fareRules.data?.fareType || 'ok');

  let ssr = null;
  let seat = null;
  if (pricing.data?.priceId) {
    await sleep(2500);
    ssr = await flight.getSsr(pricing.data.priceId);
    console.log('ssr', ssr.status, ssr.data?.error?.code || 'ok');
  }
  if (pricing.data?.bookingContext) {
    await sleep(2500);
    seat = await flight.getSeatMap(pricing.data.bookingContext);
    console.log('seatmap', seat.status, seat.data?.error?.code || seat.data?.requestStatus || 'ok');
  }

  // AC: International unchanged — mixed should NOT be newly allowed the same way as domestic
  // Score observationally
  const rows = [];
  rows.push({
    id: 'INTL-S0',
    rule: 'Intl RT search with Normal, Corporate, SME yields options',
    status: onwardOpts.length ? 'PASS' : 'BUG',
    actual: `n=${onwardOpts.length} cats=${onwardCats.join(',')}`,
  });
  rows.push({
    id: 'INTL-S1',
    rule: 'After onward pick, return options exist',
    status: returnOpts.length ? 'PASS' : 'BUG',
    actual: `returnN=${returnOpts.length} cats=${returnCats.join(',')}`,
  });
  rows.push({
    id: 'INTL-MIX-INV',
    rule: 'Other fare cats on intl return (inventory)',
    status: otherCats.length ? 'PASS' : 'NOT TESTED',
    actual: `other=${otherCats.join(',') || '(none)'}`,
    note: 'AC: intl unchanged — mix inventory may be absent',
  });

  if (pick.kind === 'MIXED') {
    const blocked = pricing.data?.error?.code === 'INVALID_COMBINATION'
      || details.data?.error?.code === 'INVALID_COMBINATION';
    const ok = pricing.status === 200 && pricing.data?.priceId;
    rows.push({
      id: 'INTL-763-MIX',
      rule: 'Intl mixed fare pair pricing (expect unchanged vs domestic allow)',
      status: blocked ? 'PASS' : (ok ? 'BUG' : (pricing.data?.error?.code === 'VENDOR_ERROR' ? 'NOT TESTED' : 'BUG')),
      expected: 'INVALID_COMBINATION or pre-PR behavior (intl unchanged)',
      actual: `details=${details.status}/${details.data?.error?.code || 'ok'} pricing=${pricing.status}/${pricing.data?.error?.code || pricing.data?.priceId}`,
      note: ok
        ? 'Mixed intl pricing SUCCEEDED — verify if intentional; AC said intl unchanged'
        : undefined,
    });
  } else {
    const ok = pricing.status === 200 && pricing.data?.priceId;
    rows.push({
      id: 'INTL-SAME',
      rule: 'Intl same-category RT prices (baseline unchanged)',
      status: ok ? 'PASS' : (pricing.data?.error?.code === 'VENDOR_ERROR' ? 'NOT TESTED' : 'BUG'),
      actual: `pricing=${pricing.status}/${pricing.data?.error?.code || pricing.data?.priceId} fareType=${pricing.data?.fareType}`,
    });
  }

  rows.push({
    id: 'INTL-SSR',
    rule: 'SSR after intl pricing',
    status: !ssr ? 'NOT TESTED' : (ssr.status >= 200 && ssr.status < 300 ? 'PASS' : 'BUG'),
    actual: ssr ? `http=${ssr.status} code=${ssr.data?.error?.code || 'ok'}` : 'no priceId',
  });
  rows.push({
    id: 'INTL-SEAT',
    rule: 'Seatmap after intl pricing',
    status: !seat ? 'NOT TESTED' : (seat.status >= 200 && seat.status < 300 ? 'PASS' : 'BUG'),
    actual: seat ? `http=${seat.status} code=${seat.data?.error?.code || seat.data?.requestStatus || 'ok'}` : 'no bookingContext',
  });
  rows.push({ id: 'NO-BOOK', rule: 'No issue-ticket', status: 'PASS' });
  rows.push({
    id: 'L2B',
    rule: 'Single intl OD+date pin, no date loop',
    status: 'PASS',
    actual: `${ORIGIN}-${DEST} ${ONWARD_DATE}/${RETURN_DATE}`,
  });

  const counts = rows.reduce((a, r) => {
    a[r.status] = (a[r.status] || 0) + 1;
    return a;
  }, {});

  const out = {
    when: new Date().toISOString(),
    baseUrl: config.baseUrl,
    correlationId: session.client.correlationId,
    route: `${ORIGIN}-${DEST}-${ORIGIN}`,
    dates: { onward: ONWARD_DATE, return: RETURN_DATE },
    fareTypeFilter: FARE_TYPE,
    maxStops: MAX_STOPS,
    onwardCats,
    returnCats,
    otherCats,
    pairKind: pick.kind,
    onward,
    return: pick.ret,
    searchIds,
    details: {
      http: details.status,
      code: details.data?.error?.code || null,
      fareType: details.data?.fareType || null,
      mixedFareType: details.data?.mixedFareType ?? null,
      error: details.data?.error || null,
    },
    pricing: {
      http: pricing.status,
      code: pricing.data?.error?.code || null,
      priceId: pricing.data?.priceId || null,
      fareType: pricing.data?.fareType || null,
      mixedFareType: pricing.data?.mixedFareType ?? null,
      error: pricing.data?.error || null,
    },
    fareRules: {
      http: fareRules.status,
      code: fareRules.data?.error?.code || null,
      fareType: fareRules.data?.fareType || null,
    },
    ssr: ssr ? { http: ssr.status, code: ssr.data?.error?.code || null } : { skipped: true },
    seatmap: seat
      ? { http: seat.status, code: seat.data?.error?.code || null, requestStatus: seat.data?.requestStatus || null }
      : { skipped: true },
    counts,
    rows,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

  const md = [
    '# ENG-763 intl one-hit (no book)',
    '',
    `- When: ${out.when}`,
    `- Route/dates: ${out.route} · ${ONWARD_DATE} / ${RETURN_DATE}`,
    `- fareType: ${FARE_TYPE} · maxStops: ${MAX_STOPS}`,
    `- Pair: ${pick.kind} ${onward.category}+${pick.ret.category}`,
    `- Counts: ${JSON.stringify(counts)}`,
    '',
    '| ID | Rule | Status | Actual |',
    '|----|------|--------|--------|',
    ...rows.map((r) => `| ${r.id} | ${r.rule} | **${r.status}** | ${String(r.actual || '').replace(/\|/g, '/').slice(0, 160)} |`),
    '',
    'Raw: `onehit-intl-rt.json`',
  ].join('\n');
  fs.writeFileSync(OUT.replace(/\.json$/, '.md'), `${md}\n`);
  console.log('Counts', counts);
  console.log('saved', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
