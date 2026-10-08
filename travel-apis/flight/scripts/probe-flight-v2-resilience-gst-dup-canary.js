/**
 * Follow-up for resilience handover: GST + exact duplicate replay + search smoke.
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm \
 *     node scripts/probe-flight-v2-resilience-gst-dup-canary.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildIssueTicketPayload,
  buildOneWaySearchBody,
  extractFirstSearchId,
  isSearchProgressComplete,
} from '../src/helpers.js';
import { collectOptions, pickFareSearchId } from '../src/searchPicker.js';
import { uniqueTag } from '../src/passengerBuilder.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = path.join('reports', 'flight-v2-resilience-gst-dup-canary.json');
const Q = { ...FLIGHT_QUERY, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 };
const GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

const rows = [];
function add(id, rule, how, expected, status, actual, extra = {}) {
  rows.push({ id, rule, how, expected, status, actual, ...extra });
  console.log(`[${status === 'NOT TESTED' ? 'NT  ' : status === 'BUG' ? 'BUG ' : 'PASS'}] ${id} ${rule}`);
  if (status === 'BUG') console.log('      ', String(actual).slice(0, 300));
}
function brief(d, n = 400) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}
function codeOf(d) {
  return d?.error?.code || d?.reason || d?.data?.reason || d?.failureReason || null;
}
function msgOf(d) {
  return d?.error?.message || d?.message || '';
}

function buildPax(tag) {
  return [{
    paxId: 'PAX1',
    type: 'adult',
    isLead: true,
    profile: {
      title: 'Mr', firstName: 'Rohan', lastName: `Bhagat${tag}`,
      gender: 'Male', dob: '1988-05-12', nationality: 'IN',
    },
    city: { cityCode: 'Pune', cityName: 'Pune' },
    passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
    ssr: { baggage: [], meals: [], seats: [] },
  }];
}

async function priceOne(flight, { day = 45, fareType = 'NORMAL', airlines = ['IX', 'SG', '6E'] } = {}) {
  const body = buildOneWaySearchBody(day, {
    origin: 'DEL', destination: 'BOM', fareType, maxStops: 0,
  });
  body.preferences = { airlines, maxStops: 0 };
  let last = null;
  for (let i = 0; i < 8; i += 1) {
    last = await flight.search(body);
    const sid = extractFirstSearchId(last.data);
    if (sid) {
      const opt = collectOptions(last.data, 'ONWARD')[0];
      const searchId = pickFareSearchId(opt, { fareType }) || sid;
      const pricing = await flight.getPricing([searchId], 'ONE_WAY');
      if (pricing.ok && pricing.data?.priceId) {
        return { searchId, pricing: pricing.data, addGstInfo: pricing.data.addGstInfo === true };
      }
    }
    if (isSearchProgressComplete(last.data)) break;
    await sleep(last?.data?.progress?.pollAfterMs || 1500);
  }
  return null;
}

async function findGst(flight) {
  for (const t of [
    { day: 45, fareType: 'CORPORATE', airlines: ['AI', '6E', 'UK'] },
    { day: 52, fareType: 'CORPORATE', airlines: ['AI', 'UK'] },
    { day: 40, fareType: 'NORMAL', airlines: ['6E', 'AI'] },
  ]) {
    console.log(`GST hunt d+${t.day} ${t.fareType}`);
    const body = buildOneWaySearchBody(t.day, {
      origin: 'DEL', destination: 'BOM', fareType: t.fareType, maxStops: 0,
    });
    body.preferences = { airlines: t.airlines, maxStops: 0 };
    let last = null;
    for (let i = 0; i < 5; i += 1) {
      last = await flight.search(body);
      for (const opt of collectOptions(last.data, 'ONWARD').slice(0, 5)) {
        const searchId = pickFareSearchId(opt, { fareType: t.fareType }) || opt.searchId;
        if (!searchId) continue;
        const pricing = await flight.getPricing([searchId], 'ONE_WAY');
        console.log('  addGstInfo=', pricing.data?.addGstInfo, 'airline=', opt.segments?.[0]?.airline?.code);
        if (pricing.ok && pricing.data?.addGstInfo === true) {
          return { searchId, pricing: pricing.data, fareType: t.fareType, day: t.day };
        }
      }
      if (isSearchProgressComplete(last.data)) break;
      await sleep(Math.min(last?.data?.progress?.pollAfterMs || 1500, 2500));
    }
  }
  return null;
}

async function issue(client, pricing, searchId, passengers, mutate = () => {}) {
  const payload = buildIssueTicketPayload({
    bookingContext: pricing.bookingContext,
    priceId: pricing.priceId,
    searchIds: [searchId],
    journeyType: 'ONE_WAY',
    passengerProfile: passengers[0].profile,
  });
  payload.data.passengers = passengers;
  payload.data.passportType = pricing.passportType || 'NONE';
  if (pricing.addGstInfo === true) {
    payload.data.includeGst = true;
    payload.data.gstDetails = { ...GST };
  } else {
    payload.data.includeGst = false;
    payload.data.gstDetails = null;
  }
  mutate(payload);
  const res = await client.request({
    method: 'POST',
    path: '/api/v2/flights/booking/issue-ticket',
    query: Q,
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
  });
  return {
    res,
    br: res.data?.bookingReference || res.data?.bookingReferenceId || null,
    payload,
  };
}

async function main() {
  clearSession();
  process.env.BASE_URL = process.env.BASE_URL || 'https://canary-api.travelvip.ai';
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const flight = new FlightService(session.client);
  const client = session.client;
  console.log('base', process.env.BASE_URL);

  // ---- TC-PRICE-04 exact same payload replay ----
  {
    const fx = await priceOne(flight, { day: 48, fareType: 'NORMAL', airlines: ['IX', 'SG'] });
    if (!fx) {
      add('TC-PRICE-04', 'Exact payload replay duplicate guard', 'need pricing', 'DUPLICATE', 'NOT TESTED', 'no inventory');
    } else {
      const pax = buildPax(uniqueTag());
      const first = await issue(client, fx.pricing, fx.searchId, pax);
      if (!first.br) {
        add('TC-PRICE-04', 'Exact payload replay', 'first issue', 'BR then reject replay', 'NOT TESTED', brief(first.res.data));
      } else {
        // Exact same payload body again (true duplicate)
        const replay = await client.request({
          method: 'POST',
          path: '/api/v2/flights/booking/issue-ticket',
          query: Q,
          body: first.payload,
          correlation: true,
          partnerKey: client.partnerKey,
        });
        const replayBr = replay.data?.bookingReference || replay.data?.bookingReferenceId || null;
        const sameBr = replayBr && replayBr === first.br;
        const dupFlag = replay.data?.duplicate === true;
        const code = String(codeOf(replay.data) || '');
        const rejected = !replayBr && /DUPLICATE/i.test(`${code} ${msgOf(replay.data)}`);
        const ok = rejected || (sameBr && (dupFlag || replay.status < 300));
        const bugNewBr = replayBr && replayBr !== first.br;

        add(
          'TC-PRICE-04',
          'Reuse same issue-ticket payload / bookingReference without rebookToken',
          `first=${first.br}; exact replay`,
          'DUPLICATE_BOOKING_REFERENCE OR same BR + duplicate:true; never a second BR',
          bugNewBr ? 'BUG' : (ok ? 'PASS' : 'BUG'),
          `replay HTTP ${replay.status} br=${replayBr || 'none'} duplicate=${replay.data?.duplicate} code=${code} msg=${msgOf(replay.data).slice(0, 160)}`,
          { firstBr: first.br, replayBr, body: replay.data },
        );

        // Garbage token on a fresh price
        const fx2 = await priceOne(flight, { day: 55, fareType: 'NORMAL', airlines: ['IX'] });
        if (fx2) {
          const pax2 = buildPax(uniqueTag());
          const g = await issue(client, fx2.pricing, fx2.searchId, pax2, (p) => {
            p.data.rebookToken = 'garbage-token-xyz';
          });
          // Garbage token on first submit of a fresh BR is not the same as reusing — note outcome
          add(
            'TC-PRICE-04b',
            'Fresh book with garbage rebookToken field',
            'new priceId + data.rebookToken=garbage',
            'Ignore unknown token OR reject; must not 500',
            g.res.status >= 500 ? 'BUG' : 'PASS',
            `HTTP ${g.res.status} br=${g.br || 'none'} code=${codeOf(g.res.data)}`,
            { br: g.br },
          );
        }
      }
    }
  }

  // ---- GST ----
  const noGst = await priceOne(flight, { day: 42, fareType: 'NORMAL', airlines: ['IX', 'SG', '6E'] });
  if (noGst && !noGst.addGstInfo) {
    const r = await issue(client, noGst.pricing, noGst.searchId, buildPax(uniqueTag()), (p) => {
      p.data.includeGst = false;
      p.data.gstDetails = null;
    });
    add('TC-GST-01', 'addGstInfo=false accepted without GST', 'issue seatless no gstDetails', 'BR', r.br ? 'PASS' : 'BUG', `HTTP ${r.res.status} br=${r.br || 'none'}`);
  } else {
    add('TC-GST-01', 'addGstInfo=false', 'need non-GST fare', 'BR', 'NOT TESTED', `addGstInfo=${noGst?.addGstInfo}`);
  }

  const gst = await findGst(flight);
  if (!gst) {
    for (const id of ['TC-GST-02', 'TC-GST-03', 'TC-GST-03b', 'TC-GST-04', 'TC-GST-05', 'TC-GST-06', 'TC-GST-07']) {
      add(id, 'GST case', 'needs addGstInfo=true', 'see handover', 'NOT TESTED', 'no GST-required fare on canary this run');
    }
  } else {
    add('SETUP.GST', `Found GST fare d+${gst.day} ${gst.fareType}`, 'pricing.addGstInfo=true', 'fixture', 'PASS', `priceId=${gst.pricing.priceId}`);

    const ok = await issue(client, gst.pricing, gst.searchId, buildPax(uniqueTag()));
    add(
      'TC-GST-02',
      'GST required + complete gstDetails → accepted',
      'full GST block',
      'BR',
      ok.br ? 'PASS' : 'BUG',
      `HTTP ${ok.res.status} br=${ok.br || 'none'} ${ok.br ? '' : brief(ok.res.data)}`,
    );

    const gst2 = await findGst(flight);
    const gUse = gst2 || gst;
    const miss = await issue(client, gUse.pricing, gUse.searchId, buildPax(uniqueTag()), (p) => {
      p.data.includeGst = true;
      p.data.gstDetails = null;
    });
    const blob = `${codeOf(miss.res.data) || ''} ${msgOf(miss.res.data)}`.toUpperCase();
    const rejected = !miss.br && miss.res.status === 400 && /GST/.test(blob);
    add(
      'TC-GST-03',
      'GST required + missing gstDetails → 400 GST_INFO_MISSING (no BR/outbox)',
      'includeGst=true gstDetails=null',
      'HTTP 400; reason GST_INFO_MISSING; no bookingReference',
      rejected ? 'PASS' : (miss.br ? 'BUG' : 'BUG'),
      `HTTP ${miss.res.status} br=${miss.br || 'none'} code=${codeOf(miss.res.data)} msg=${msgOf(miss.res.data).slice(0, 200)}`,
      { response: miss.res.data },
    );

    const gst3 = await findGst(flight);
    if (gst3) {
      const blank = await issue(client, gst3.pricing, gst3.searchId, buildPax(uniqueTag()), (p) => {
        p.data.includeGst = true;
        p.data.gstDetails = { ...GST, gstNumber: '' };
      });
      const blob2 = `${codeOf(blank.res.data) || ''} ${msgOf(blank.res.data)}`.toUpperCase();
      const rej2 = !blank.br && blank.res.status >= 400 && /GST|VALID/.test(blob2);
      add(
        'TC-GST-03b',
        'GST required + blank gstNumber → rejected',
        'gstNumber=""',
        '4xx; no BR',
        rej2 ? 'PASS' : 'BUG',
        `HTTP ${blank.res.status} br=${blank.br || 'none'} ${brief(blank.res.data)}`,
      );
    }

    add('TC-GST-04', 'Partner default GST (flag ON)', 'needs use_default_gst_info', 'PARTNER_DEFAULT', 'NOT TESTED', 'cannot toggle partner flag');
    add('TC-GST-05', 'Server default GST', 'needs server default', 'SERVER_DEFAULT', 'NOT TESTED', 'cannot toggle server default');
    add('TC-GST-06', 'Flag ON + nothing configured', 'needs empty defaults', 'GST_INFO_MISSING', 'NOT TESTED', 'cannot clear configs');
    add(
      'TC-GST-07',
      'HTTP path mirrors GST-03 (no BR ⇒ no outbox)',
      'same as TC-GST-03 via issue-ticket',
      'reject; no BR',
      rows.find((r) => r.id === 'TC-GST-03')?.status === 'PASS' ? 'PASS' : 'NOT TESTED',
      'BR absence is partner-visible proxy for no outbox row',
    );
  }

  // Smoke search
  const smoke = await flight.search(buildOneWaySearchBody(40, {
    origin: 'DEL', destination: 'BOM', fareType: 'NORMAL', maxStops: 0,
  }));
  add(
    'REG.SEARCH',
    'Search smoke still healthy',
    'POST /v1/flights/search',
    'HTTP <500',
    smoke.status < 500 ? 'PASS' : 'BUG',
    `HTTP ${smoke.status} opts=${collectOptions(smoke.data).length}`,
  );

  const summary = {
    PASS: rows.filter((r) => r.status === 'PASS').length,
    BUG: rows.filter((r) => r.status === 'BUG').length,
    NOT_TESTED: rows.filter((r) => r.status === 'NOT TESTED').length,
  };
  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: process.env.BASE_URL || config.baseUrl,
    summary,
    rows,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('SUMMARY', summary);
  console.log('Wrote', OUT);
  process.exit(summary.BUG > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
