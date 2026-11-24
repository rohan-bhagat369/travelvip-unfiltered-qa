/**
 * One-hit check: different dates + different flight searchIds than the
 * throttled 6E 5175 / 7017+932 pair. No book. fareType = "Normal, Corporate, SME".
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
const OUT = path.join(__dirname, '../reports/preprod-mixed-fare-pr1505/onehit-diff-dates-diff-flights.json');

const ONWARD_DAYS = Number(process.env.FLIGHT_ONWARD_DAYS || '25');
const RETURN_DAYS = Number(process.env.FLIGHT_RETURN_DAYS || String(ONWARD_DAYS + 2));
const ONWARD_DATE = process.env.FLIGHT_SEARCH_DATE || futureDate(ONWARD_DAYS);
const RETURN_DATE = process.env.FLIGHT_RETURN_DATE || futureDate(RETURN_DAYS);
const SKIP_ONWARD = String(process.env.SKIP_ONWARD_FN || '5175');
const SKIP_RETURN = String(process.env.SKIP_RETURN_FN || '7017,932').split(',').map((s) => s.trim()).filter(Boolean);

function cat(f) {
  const c = String(f?.fareCategory || f?.fareType || '').toUpperCase();
  if (!c) return null;
  if (c.includes('CORPORATE') || c === 'CORP') return 'CORPORATE';
  if (c.includes('SME')) return 'SME';
  if (c.includes('STUDENT')) return 'STUDENT';
  if (c.includes('DEFENCE') || c.includes('DEFENSE')) return 'DEFENCE';
  if (c.includes('SENIOR')) return 'SENIOR_CITIZEN';
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

function fns(opt) {
  return (opt?.segments || []).map((s) => String(s.flightNumber || '').replace(/\s+/g, '')).join('|');
}

function airports(opt) {
  return (opt?.segments || []).map((s) => ({
    from: s.departure?.airportCode || s.origin,
    to: s.arrival?.airportCode || s.destination,
    fn: s.flightNumber,
  }));
}

function pickByCat(options, want, { excludeFns = [] } = {}) {
  for (const opt of options || []) {
    const fkey = fns(opt);
    if (excludeFns.some((x) => fkey.includes(String(x)))) continue;
    for (const f of opt.fares || []) {
      if (cat(f) === want && (f.searchId || opt.searchId)) {
        return {
          searchId: f.searchId || opt.searchId,
          category: want,
          fareType: f.fareType,
          fareCategory: f.fareCategory,
          airline: airline(opt),
          label: label(opt),
          fns: fkey,
          airports: airports(opt),
        };
      }
    }
  }
  return null;
}

function catsIn(options) {
  return [...new Set((options || []).flatMap((o) => (o.fares || []).map(cat)).filter(Boolean))].sort();
}

async function searchUntil(flight, body, max = 16) {
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

async function refineReturn(flight, body, onwardId, max = 12) {
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
    throw new Error(`Refuse non-preprod host: ${config.baseUrl}`);
  }

  console.log('=== ONE HIT: different dates + different flight searchIds ===');
  console.log('BASE', config.baseUrl, 'tier', config.tierId);
  console.log('DATES', ONWARD_DATE, '→', RETURN_DATE, `(+${ONWARD_DAYS}/+${RETURN_DAYS})`);
  console.log('fareType: Normal, Corporate, SME');
  console.log('skip prior combo fns onward~', SKIP_ONWARD, 'return~', SKIP_RETURN.join('/'));

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const flight = new FlightService(session.client);

  const body = {
    itinerary: [
      { origin: 'DEL', destination: 'BOM', date: ONWARD_DATE },
      { origin: 'BOM', destination: 'DEL', date: RETURN_DATE },
    ],
    travellers: { adults: 1, children: 0, infants: 0 },
    cabinClass: 'ECONOMY',
    journeyType: 'ROUND_TRIP',
    currency: 'INR',
    language: 'en',
    preferences: { airlines: [], maxStops: null, refundableOnly: false },
    appliedFilters: {},
    selection: { selectedSearchIds: [] },
    fareType: 'Normal, Corporate, SME',
  };

  const initial = await searchUntil(flight, body);
  const onwardOpts = collectOptions(initial.data, 'ONWARD');
  console.log('search', initial.status, 'onward', onwardOpts.length, 'cats', catsIn(onwardOpts).join(','));

  const onward = pickByCat(onwardOpts, 'SME', { excludeFns: [SKIP_ONWARD] })
    || pickByCat(onwardOpts, 'CORPORATE', { excludeFns: [SKIP_ONWARD] })
    || pickByCat(onwardOpts, 'NORMAL', { excludeFns: [SKIP_ONWARD] })
    || pickByCat(onwardOpts, 'SME')
    || pickByCat(onwardOpts, 'NORMAL');

  if (!onward) throw new Error('No onward pick');
  console.log('onward', onward.category, onward.label, onward.searchId);

  const retRes = await refineReturn(flight, body, onward.searchId);
  const returnOpts = collectOptions(retRes.data, 'RETURN');
  console.log('return', returnOpts.length, 'cats', catsIn(returnOpts).join(','));

  const mixOrder = ['NORMAL', 'CORPORATE', 'SME'].filter((c) => c !== onward.category);
  let ret = null;
  for (const c of mixOrder) {
    const cand = pickByCat(returnOpts, c, { excludeFns: SKIP_RETURN });
    if (cand && cand.searchId !== onward.searchId) {
      ret = cand;
      break;
    }
  }
  if (!ret) {
    for (const c of [...mixOrder, onward.category]) {
      for (const opt of returnOpts) {
        if (SKIP_RETURN.some((x) => fns(opt).includes(x))) continue;
        if (fns(opt) === onward.fns) continue;
        const f = (opt.fares || []).find((x) => cat(x) === c) || (opt.fares || [])[0];
        const sid = f?.searchId || opt.searchId;
        if (!sid || sid === onward.searchId) continue;
        ret = {
          searchId: sid,
          category: cat(f),
          fareType: f?.fareType,
          fareCategory: f?.fareCategory,
          airline: airline(opt),
          label: label(opt),
          fns: fns(opt),
          airports: airports(opt),
        };
        break;
      }
      if (ret) break;
    }
  }
  if (!ret) throw new Error('No different return pick');
  console.log('return', ret.category, ret.label, ret.searchId);
  console.log('searchIds', [onward.searchId, ret.searchId]);

  // backoff so we do not re-hit Riya throttle from earlier script traffic
  console.log('cooldown 4s then ONE pricing hit…');
  await sleep(4000);

  const details = await flight.getDetails([onward.searchId, ret.searchId], 'ROUND_TRIP');
  const pricing = await flight.getPricing([onward.searchId, ret.searchId], 'ROUND_TRIP');
  console.log('details', details.status, details.data?.error?.code || details.data?.fareType || 'ok');
  console.log('pricing', pricing.status, pricing.data?.error?.code || pricing.data?.priceId || 'ok', 'fareType=', pricing.data?.fareType);

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

  const out = {
    when: new Date().toISOString(),
    baseUrl: config.baseUrl,
    correlationId: session.client.correlationId,
    dates: { onward: ONWARD_DATE, return: RETURN_DATE },
    fareTypeFilter: 'Normal, Corporate, SME',
    skippedPriorFns: { onward: SKIP_ONWARD, return: SKIP_RETURN },
    onwardCats: catsIn(onwardOpts),
    returnCats: catsIn(returnOpts),
    onward,
    return: ret,
    searchIds: [onward.searchId, ret.searchId],
    note: 'Different dates + different flight searchIds vs throttled 6E 5175 / 7017+932 vendor hit',
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
    ssr: ssr ? { http: ssr.status, code: ssr.data?.error?.code || null } : { skipped: true },
    seatmap: seat
      ? { http: seat.status, code: seat.data?.error?.code || null, requestStatus: seat.data?.requestStatus || null }
      : { skipped: true },
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log('saved', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
