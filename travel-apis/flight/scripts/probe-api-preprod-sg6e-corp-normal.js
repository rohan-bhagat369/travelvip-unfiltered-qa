/**
 * api-preprod: SG + 6E CORPORATE↔NORMAL mix only.
 * One pinned search (DEL↔BOM 26→28), no book, no date step.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import { collectOptions } from '../src/searchPicker.js';
import { sleep } from '../../../shared/lib/testUtils.js';

process.env.ALLOW_BOOK = 'false';
process.env.BASE_URL = process.env.BASE_URL || 'https://api-preprod.travelvip.ai';
process.env.PARTNER_ID = process.env.PARTNER_ID || 'vgm';
process.env.PARTNER_SECRET = process.env.PARTNER_SECRET || 'vgm_preprod_ojny1swtigd4as';
process.env.TIER_ID = process.env.TIER_ID || '19597201';
process.env.SIGNING_KEY = process.env.SIGNING_KEY || 'sk_live_yg81bca5xno1ypvhla';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '../reports/preprod-mixed-fare-pr1505/api-preprod-sg6e-corp-normal.json');

const BODY = {
  itinerary: [
    { origin: 'DEL', destination: 'BOM', date: '2026-11-26' },
    { origin: 'BOM', destination: 'DEL', date: '2026-11-28' },
  ],
  travellers: { adults: 1, children: 0, infants: 0 },
  cabinClass: 'ECONOMY',
  journeyType: 'ROUND_TRIP',
  currency: 'INR',
  language: 'en',
  // Pin SG+6E so CORP/SG rows aren't pushed off page0 by cheaper 6E-only fare sort
  preferences: { airlines: ['SG', '6E'], maxStops: 0, refundableOnly: false },
  appliedFilters: {},
  selection: { selectedSearchIds: [] },
  fareType: 'NORMAL, CORPORATE, SME',
};

function fareCat(f) {
  const c = String(f?.fareCategory || '').toUpperCase();
  if (c) return c;
  const t = String(f?.fareType || '').toUpperCase();
  if (t.includes('CORPORATE') || t === 'CORP') return 'CORPORATE';
  if (t.includes('SME')) return 'SME';
  return t ? 'NORMAL' : null;
}
function airline(o) {
  return String(o?.segments?.[0]?.airline?.code || o?.segments?.[0]?.airlineCode || '').toUpperCase();
}
function label(o) {
  return (o?.segments || [])
    .map((s) => `${String(s.airline?.code || s.airlineCode || '').toUpperCase()} ${s.flightNumber || ''}`.trim())
    .join('/');
}
function pick(options, want, al) {
  const out = [];
  for (const opt of options || []) {
    if (airline(opt) !== al) continue;
    for (const f of opt.fares || []) {
      if (fareCat(f) === want && (f.searchId || opt.searchId)) {
        out.push({
          searchId: f.searchId || opt.searchId,
          category: want,
          fareType: f.fareType || null,
          airline: al,
          label: label(opt),
        });
      }
    }
  }
  return out;
}

function seatSegs(data) {
  return (data?.segments || []).map((s) => ({
    leg: s.legNumber,
    dir: s.direction || null,
    o: s.origin,
    d: s.destination,
    n: Array.isArray(s.seatMap) ? s.seatMap.length : 0,
  }));
}

async function hop(flight, tag, o, r) {
  const ids = [o.searchId, r.searchId];
  console.log(`\n--- ${tag}: ${o.label} (${o.category}/${o.fareType}) → ${r.label} (${r.category}/${r.fareType}) ---`);
  await sleep(2500);
  const details = await flight.getDetails(ids, 'ROUND_TRIP');
  const pricing = await flight.getPricing(ids, 'ROUND_TRIP');
  console.log('details', details.status, details.data?.error?.code || details.data?.fareType || 'ok', 'mixed', details.data?.mixedFareType);
  console.log('pricing', pricing.status, pricing.data?.error?.code || pricing.data?.priceId, pricing.data?.fareType, 'mixed', pricing.data?.mixedFareType);

  let fareRules = null;
  let ssr = null;
  let seat = null;
  if (pricing.status === 200 && pricing.data?.priceId) {
    fareRules = await flight.getFareRules(ids, 'ROUND_TRIP');
    await sleep(1500);
    ssr = await flight.getSsr(pricing.data.priceId);
    if (pricing.data.bookingContext) {
      await sleep(1500);
      seat = await flight.getSeatMap(pricing.data.bookingContext);
    }
  } else if (details.status === 200) {
    fareRules = await flight.getFareRules(ids, 'ROUND_TRIP');
  }

  const segs = seat ? seatSegs(seat.data) : [];
  console.log('fareRules', fareRules?.status, fareRules?.data?.error?.code || fareRules?.data?.fareType,
    (fareRules?.data?.fareRules || []).map((e) => `${e.title}|${e.fareType || e.fareCategory}`));
  console.log('ssr', ssr?.status ?? 'skip', 'seat', seat?.status ?? 'skip', seat?.data?.requestStatus, segs);

  const priced = pricing.status === 200 && pricing.data?.priceId;
  const mixed = String(pricing.data?.fareType || '').toUpperCase() === 'MIXED' || pricing.data?.mixedFareType === true;
  const bothSeats = segs.filter((s) => s.n > 0).length >= 2;

  return {
    tag,
    kind: `${o.category}+${r.category}`,
    airlines: `${o.airline}+${r.airline}`,
    onward: o,
    return: r,
    searchIds: ids,
    details: {
      http: details.status,
      code: details.data?.error?.code || null,
      fareType: details.data?.fareType ?? null,
      mixedFareType: details.data?.mixedFareType ?? null,
    },
    pricing: {
      http: pricing.status,
      code: pricing.data?.error?.code || null,
      priceId: pricing.data?.priceId || null,
      fareType: pricing.data?.fareType ?? null,
      mixedFareType: pricing.data?.mixedFareType ?? null,
    },
    fareRules: fareRules
      ? {
          http: fareRules.status,
          code: fareRules.data?.error?.code || null,
          fareType: fareRules.data?.fareType ?? null,
          entries: (fareRules.data?.fareRules || []).map((e) => ({
            title: e.title,
            fareType: e.fareType || e.fareCategory || null,
          })),
        }
      : null,
    ssr: ssr ? { http: ssr.status, code: ssr.data?.error?.code || null } : null,
    seatmap: seat
      ? {
          http: seat.status,
          code: seat.data?.error?.code || null,
          requestStatus: seat.data?.requestStatus || null,
          segments: segs,
          bothLegsSeats: bothSeats,
        }
      : null,
    verdict: {
      mixAllowed: priced ? (mixed ? 'PASS' : 'BUG') : (pricing.data?.error?.code === 'INVALID_COMBINATION' ? 'BUG' : 'BUG'),
      pricing: priced ? 'PASS' : `FAIL:${pricing.data?.error?.code || pricing.status}`,
      fareRules: fareRules?.status === 200 && (fareRules.data?.fareRules || []).length >= 2 ? 'PASS' : (priced ? 'BUG' : 'NOT TESTED'),
      seatmap: seat?.status === 200
        ? (bothSeats ? 'PASS' : 'BUG')
        : (priced ? 'BUG' : 'NOT TESTED'),
    },
  };
}

async function main() {
  clearSession();
  if (!/api-preprod\.travelvip\.ai/i.test(String(config.baseUrl))) {
    throw new Error(`Wrong host ${config.baseUrl}`);
  }

  console.log('=== SG + 6E CORP↔NORMAL — api-preprod, no book ===');
  console.log('BASE', config.baseUrl);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const flight = new FlightService(session.client);

  let search;
  for (let i = 1; i <= 15; i += 1) {
    search = await flight.client.request({
      method: 'POST',
      path: '/v1/flights/search',
      query: { lang: 'en', currency: 'INR', page: 0, perpage: 50, sortby: 'fare,asc' },
      body: BODY,
      correlation: true,
    });
    console.log('search poll', i, search.status, search.data?.progress?.state);
    if (search.ok && search.data?.progress?.state === 'COMPLETE') break;
    await sleep(3500);
  }

  const onward = collectOptions(search.data, 'ONWARD');
  const ret = collectOptions(search.data, 'RETURN');

  const sgCorpO = pick(onward, 'CORPORATE', 'SG');
  const sgNormO = pick(onward, 'NORMAL', 'SG');
  const e6CorpO = pick(onward, 'CORPORATE', '6E');
  const e6NormO = pick(onward, 'NORMAL', '6E');
  const sgCorpR = pick(ret, 'CORPORATE', 'SG');
  const sgNormR = pick(ret, 'NORMAL', 'SG');
  const e6CorpR = pick(ret, 'CORPORATE', '6E');
  const e6NormR = pick(ret, 'NORMAL', '6E');

  const inventory = {
    onward: {
      SG_CORP: sgCorpO.length, SG_NORMAL: sgNormO.length,
      '6E_CORP': e6CorpO.length, '6E_NORMAL': e6NormO.length,
    },
    return: {
      SG_CORP: sgCorpR.length, SG_NORMAL: sgNormR.length,
      '6E_CORP': e6CorpR.length, '6E_NORMAL': e6NormR.length,
    },
  };
  console.log('inventory', JSON.stringify(inventory));

  // Candidate orders: SG corp→6E normal, 6E corp→SG normal, SG normal→6E corp, 6E normal→SG corp
  const plans = [
    { tag: 'SG-CORP + 6E-NORMAL', oList: sgCorpO, rList: e6NormR },
    { tag: '6E-CORP + SG-NORMAL', oList: e6CorpO, rList: sgNormR },
    { tag: 'SG-NORMAL + 6E-CORP', oList: sgNormO, rList: e6CorpR },
    { tag: '6E-NORMAL + SG-CORP', oList: e6NormO, rList: sgCorpR },
  ];

  const hops = [];
  const rows = [];

  for (const plan of plans) {
    if (!plan.oList.length || !plan.rList.length) {
      rows.push({
        id: plan.tag,
        status: 'NOT TESTED',
        actual: `missing inventory o=${plan.oList.length} r=${plan.rList.length}`,
      });
      console.log(`[·] ${plan.tag} NOT TESTED — no inventory`);
      continue;
    }

    // try up to 2 flight pairs for this order
    let done = null;
    for (let i = 0; i < Math.min(2, plan.oList.length); i += 1) {
      for (let j = 0; j < Math.min(2, plan.rList.length); j += 1) {
        const o = plan.oList[i];
        const r = plan.rList[j];
        if (o.searchId === r.searchId) continue;
        const h = await hop(flight, `${plan.tag}#${i}-${j}`, o, r);
        hops.push(h);
        if (h.pricing.priceId) {
          done = h;
          break;
        }
      }
      if (done) break;
    }

    const h = done || hops.filter((x) => x.tag.startsWith(plan.tag)).pop();
    if (!h) {
      rows.push({ id: plan.tag, status: 'NOT TESTED', actual: 'no hop' });
      continue;
    }
    const ok = h.pricing.priceId && (h.pricing.fareType === 'MIXED' || h.pricing.mixedFareType === true);
    rows.push({
      id: plan.tag,
      status: ok ? 'PASS' : 'BUG',
      actual: `pricing=${h.pricing.http}/${h.pricing.code || h.pricing.priceId} fareType=${h.pricing.fareType} rules=${h.fareRules?.http}/${h.fareRules?.entries?.length} seat=${h.seatmap?.http}/${h.seatmap?.requestStatus} legs=${JSON.stringify(h.seatmap?.segments || [])}`,
      verdict: h.verdict,
    });
    console.log(`[${ok ? '✓' : '✗'}] ${plan.tag} ${ok ? 'PASS' : 'BUG'}`);
  }

  const out = {
    when: new Date().toISOString(),
    baseUrl: config.baseUrl,
    correlationId: session.client.correlationId,
    request: BODY,
    inventory,
    hops,
    rows,
    noBook: true,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log('\nROWS');
  for (const r of rows) console.log('-', r.id, r.status, r.actual);
  console.log('saved', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
