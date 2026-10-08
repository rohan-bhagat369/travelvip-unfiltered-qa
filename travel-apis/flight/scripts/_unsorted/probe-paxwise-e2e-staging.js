/**
 * Full paxwise E2E on api-staging:
 *  - §4 payload validations (prefer 2ADT fixture)
 *  - OW multipax partial cancels (different pax)
 *  - RT single-leg cancel + multipax different pax on different legs
 *
 *   BASE_URL=https://api-staging.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-paxwise-e2e-staging.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../../shared/lib/authService.js';
import { config } from '../../../../shared/config/env.js';
import { FlightService } from '../../src/service.js';
import {
  FLIGHT_QUERY,
  buildOneWaySearchBody,
  buildRoundTripSearchBody,
  buildIssueTicketPayload,
  isTerminalBookingStatus,
} from '../../src/helpers.js';
import { sleep } from '../../../../shared/lib/testUtils.js';

const OUT = 'reports/paxwise-e2e-staging.json';
const Q = { ...FLIGHT_QUERY };

// Fresh fixtures from prior book run (reuse if still Confirmed)
const SEED = {
  OW1: { br: 'BR1786538901965364', pnr: 'Q2RBFZ', adults: 1 },
  OW2: { br: 'BR1786538928807053', pnr: 'A77FPK', adults: 2 },
  OW3: { br: 'BR1786538954955917', pnr: 'OV4KKV', adults: 2, children: 1 },
};

function brief(d, n = 350) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}
function errCode(r) {
  return r?.data?.error?.code || r?.data?.code || null;
}
function cancelStatus(r) {
  return r?.data?.cancellationRequest?.status
    || r?.data?.data?.cancellationRequest?.status
    || null;
}
function paxScope(r) {
  return r?.data?.paxScope || r?.data?.data?.paxScope || null;
}
function ok(r) {
  return Boolean(r?.ok || (r?.status >= 200 && r?.status < 300));
}

function adultProfiles(n) {
  const base = [
    ['Amit', 'Sharma', 'Mr', 'Male', '1995-08-15'],
    ['Neha', 'Sharma', 'Mrs', 'Female', '1996-03-12'],
    ['Vikram', 'Patil', 'Mr', 'Male', '1990-01-22'],
  ];
  return base.slice(0, n).map(([firstName, lastName, title, gender, dob], i) => ({
    paxId: `PAX${i + 1}`,
    type: 'adult',
    isLead: i === 0,
    profile: { title, firstName, lastName, gender, dob, nationality: 'IN' },
    city: { cityCode: 'Pune', cityName: 'Pune' },
    passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
    ssr: { baggage: [], meals: [], seats: [] },
  }));
}

function fixGst(payload, pricingData) {
  payload.data.includeGst = false;
  payload.data.gstDetails = null;
  if (pricingData?.addGstInfo === true || pricingData?.pricing?.addGstInfo === true) {
    payload.data.includeGst = true;
    payload.data.gstDetails = {
      gstNumber: '27AABCU9603R1ZM',
      companyName: 'TravelVIP QA',
      email: config.flight.contactEmail,
      phone: config.flight.contactMobile,
    };
  }
  return payload;
}

async function waitStatus(flight, br) {
  let last;
  for (let i = 0; i < 12; i += 1) {
    last = await flight.getBookingStatus(br);
    const st = String(last.data?.status || '');
    console.log('  status', br, i + 1, st);
    if (isTerminalBookingStatus(st)) return st;
    if (/inprogress/i.test(st) && i >= 4) return st;
    await sleep(3500);
  }
  return last?.data?.status;
}

function legsOf(detail) {
  return (detail?.bookingResponse?.itinerary || []).map((l) => ({
    direction: String(l.direction || '').toUpperCase(),
    pnr: l.pnr || null,
  }));
}

async function loadFixture(flight, seed) {
  const detail = await flight.getBookingDetail(seed.br);
  const status = detail.data?.status;
  const legs = legsOf(detail.data);
  const pnr = seed.pnr || legs[0]?.pnr;
  const pax = (detail.data?.bookingResponse?.passengers || []).map((p) => p.paxId);
  const usable = /confirm/i.test(String(status)) && pnr && pnr !== 'FVRVRV';
  return {
    ...seed, status, legs, pnr, pax, usable,
    onwardPnr: legs.find((l) => /ONWARD/.test(l.direction))?.pnr || pnr,
    returnPnr: legs.find((l) => /RETURN/.test(l.direction))?.pnr || null,
  };
}

async function bookRt(flight, client, { label, adults, origin, destination, dayPairs, airlineSets }) {
  console.log(`\nBOOK ${label} RT ${origin}<->${destination} adults=${adults}`);
  for (const [od, rd] of dayPairs) {
    for (const airlines of airlineSets) {
      console.log(`  try ${od}/${rd} ${airlines.join(',') || 'any'}`);
      const body = buildRoundTripSearchBody(od, rd, {
        origin, destination, fareType: 'NORMAL', maxStops: 0,
      });
      body.travellers = { adults, children: 0, infants: 0 };
      if (airlines.length) body.preferences.airlines = airlines;
      let search;
      try {
        search = await flight.searchRoundTripUntilComplete(body);
      } catch (e) {
        console.log('  search fail', e.message);
        continue;
      }
      if (!search.searchIds || search.searchIds.length < 2) continue;
      const pricing = await flight.getPricing(search.searchIds, 'ROUND_TRIP');
      if (!pricing.data?.priceId) {
        console.log('  pricing fail', brief(pricing.data));
        continue;
      }
      const payload = buildIssueTicketPayload({
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        searchIds: search.searchIds,
        journeyType: 'ROUND_TRIP',
      });
      payload.data.passengers = adultProfiles(adults);
      fixGst(payload, pricing.data);
      const issue = await client.request({
        method: 'POST',
        path: '/api/v2/flights/booking/issue-ticket',
        query: { ...Q, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 },
        body: payload,
        correlation: true,
        partnerKey: client.partnerKey,
      });
      const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
      if (!br) {
        console.log('  issue fail', brief(issue.data));
        continue;
      }
      const status = await waitStatus(flight, br);
      const detail = await flight.getBookingDetail(br);
      const legs = legsOf(detail.data);
      const pax = (detail.data?.bookingResponse?.passengers || []).map((p) => p.paxId);
      const onwardPnr = legs.find((l) => /ONWARD/.test(l.direction))?.pnr;
      const returnPnr = legs.find((l) => /RETURN/.test(l.direction))?.pnr;
      const usable = /confirm/i.test(String(detail.data?.status || status))
        && onwardPnr && returnPnr && onwardPnr !== 'FVRVRV';
      console.log('  ->', br, detail.data?.status || status, `ONWARD:${onwardPnr} RETURN:${returnPnr}`);
      if (usable) {
        return {
          label, br, status: detail.data?.status || status, adults, legs, pax,
          onwardPnr, returnPnr, route: `${origin}-${destination}`, usable: true,
        };
      }
    }
  }
  return { label, usable: false, error: 'no confirmed RT' };
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('Base', config.baseUrl);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    fixtures: {},
    validations: [],
    functional: [],
    score: { PASS: 0, BUG: 0, NOT_TESTED: 0 },
  };

  const add = (section, row) => {
    report[section].push(row);
    if (report.score[row.status] != null) report.score[row.status] += 1;
    console.log(`[${row.status}] ${row.id} — ${row.actual}`);
  };
  const expect = (section, cond, id, how, expected, actual, note = '', extra = {}) => {
    add(section, {
      id, how, expected, actual, status: cond ? 'PASS' : 'BUG', note, ...extra,
    });
  };

  // ---- Load / book fixtures ----
  report.fixtures.OW1 = await loadFixture(flight, SEED.OW1);
  report.fixtures.OW2 = await loadFixture(flight, SEED.OW2);
  report.fixtures.OW3 = await loadFixture(flight, SEED.OW3);
  console.log('OW fixtures', {
    OW1: report.fixtures.OW1.usable && report.fixtures.OW1.br,
    OW2: report.fixtures.OW2.usable && report.fixtures.OW2.br,
    OW3: report.fixtures.OW3.usable && report.fixtures.OW3.br,
  });

  report.fixtures.RT1 = await bookRt(flight, client, {
    label: 'RT1_1ADT',
    adults: 1,
    origin: 'DEL',
    destination: 'BOM',
    dayPairs: [[90, 97], [95, 102]],
    airlineSets: [['IX'], ['SG'], []],
  });

  report.fixtures.RT2 = await bookRt(flight, client, {
    label: 'RT2_2ADT',
    adults: 2,
    origin: 'BLR',
    destination: 'DEL',
    dayPairs: [[92, 99], [98, 105]],
    airlineSets: [['IX'], []],
  });

  const cancelApi = (br, body) => client.request({
    method: 'POST',
    path: `/v1/flights/booking/${br}/cancel`,
    query: Q,
    body,
    correlation: true,
    partnerKey: client.partnerKey,
  });

  // ============================================================
  // §4 validations — use OW2 (2ADT) so 4.12 is fair
  // ============================================================
  console.log('\n=== §4 VALIDATIONS ===');
  const V = report.fixtures.OW2.usable ? report.fixtures.OW2
    : (report.fixtures.OW1.usable ? report.fixtures.OW1 : null);

  if (!V) {
    add('validations', {
      id: '4.x', how: 'fixture', expected: '2ADT confirmed', actual: 'missing', status: 'NOT_TESTED',
    });
  } else {
    const base = { action: 'CANCEL', pnr: V.pnr };
    const cases = [
      ['4.1a', 'PAX1', 'VALIDATION_ERROR', 400],
      ['4.1c', [['PAX1']], 'VALIDATION_ERROR', 400],
      ['4.2a', [null], 'VALIDATION_ERROR', 400],
      ['4.2b', [true], 'VALIDATION_ERROR', 400],
      ['4.2c', [{}], 'VALIDATION_ERROR', 400],
      ['4.3a', ['ABC'], 'VALIDATION_ERROR', 400],
      ['4.3b', [''], 'VALIDATION_ERROR', 400],
      ['4.3c', [' '], 'VALIDATION_ERROR', 400],
      ['4.3d', ['1.5'], 'VALIDATION_ERROR', 400],
      ['4.3e', [-1], 'VALIDATION_ERROR', 400],
      ['4.3f', [0], 'VALIDATION_ERROR', 400],
      ['4.3g', ['PAX0'], 'VALIDATION_ERROR', 400],
      ['4.3h', ['PAX01'], 'VALIDATION_ERROR', 400],
      ['4.3i', ['2PAX3'], 'VALIDATION_ERROR', 400],
      ['4.4', ['FOO9'], 'VALIDATION_ERROR', 400],
      ['4.6', ['PAX9', 'ABC'], 'VALIDATION_ERROR', 400],
      ['4.7a', ['PAX1', 'PAX1'], 'VALIDATION_ERROR', 400],
      ['4.7b', ['PAX1', '1'], 'VALIDATION_ERROR', 400],
      ['4.7c', ['PAX1', 'pax_1'], 'VALIDATION_ERROR', 400],
      ['4.7d', [1, 1], 'VALIDATION_ERROR', 400],
      ['4.7e', [' PAX1 ', 'PAX1'], 'VALIDATION_ERROR', 400],
      ['4.8', ['PAX1', 'PAX1', 'PAX2', 'PAX2'], 'VALIDATION_ERROR', 400],
      ['4.9', ['ABC', 'PAX1', 'PAX1'], 'VALIDATION_ERROR', 400],
    ];

    for (const [id, list, code, http] of cases) {
      const r = await cancelApi(V.br, { ...base, cancellationPaxList: list });
      expect(
        'validations',
        r.status === http && errCode(r) === code,
        id,
        `list=${JSON.stringify(list)}`,
        `${http} ${code}`,
        `${r.status} ${errCode(r) || cancelStatus(r)}`,
        brief(r.data?.error || r.data, 160),
      );
    }

    {
      const r = await cancelApi(V.br, { ...base, cancellationPaxList: { 0: 'PAX1' } });
      expect(
        'validations',
        r.status === 400 && errCode(r) === 'VALIDATION_ERROR',
        '4.1b',
        'object {0:"PAX1"}',
        '400 VALIDATION_ERROR',
        `${r.status} ${errCode(r) || cancelStatus(r)}`,
        brief(r.data, 220),
        { request: { cancellationPaxList: { 0: 'PAX1' } }, response: r.data },
      );
    }

    {
      const r = await cancelApi(V.br, {
        action: 'PENALTY', pnr: V.pnr, cancellationPaxList: [' PAX1 '],
      });
      expect(
        'validations',
        errCode(r) !== 'VALIDATION_ERROR',
        '4.5',
        '[" PAX1 "] PENALTY',
        'not VALIDATION_ERROR',
        `${r.status} ${errCode(r) || cancelStatus(r)}`,
        brief(r.data, 180),
      );
    }

    // 4.10 on 2ADT: 3 entries => TOO_LARGE
    {
      const r = await cancelApi(V.br, {
        ...base, cancellationPaxList: ['PAX1', 'PAX2', 'PAX3'],
      });
      expect(
        'validations',
        r.status === 400 && errCode(r) === 'PAX_LIST_TOO_LARGE',
        '4.10',
        '3 entries on 2-pax',
        '400 PAX_LIST_TOO_LARGE',
        `${r.status} ${errCode(r)}`,
      );
    }

    {
      const list = Array.from({ length: 51 }, (_, i) => `PAX${i + 1}`);
      const r = await cancelApi(V.br, { ...base, cancellationPaxList: list });
      expect(
        'validations',
        r.status === 400 && errCode(r) === 'PAX_LIST_TOO_LARGE',
        '4.11',
        '51 entries',
        '400 PAX_LIST_TOO_LARGE',
        `${r.status} ${errCode(r)}`,
      );
    }

    {
      const r = await cancelApi(V.br, {
        ...base, cancellationPaxList: ['PAX1', 'PAX9'],
      });
      const pass = V.adults >= 2
        ? (r.status === 422 && errCode(r) === 'PAX_NOT_IN_BOOKING')
        : (r.status === 400 && errCode(r) === 'PAX_LIST_TOO_LARGE');
      expect(
        'validations',
        pass,
        '4.12',
        '["PAX1","PAX9"]',
        V.adults >= 2 ? '422 PAX_NOT_IN_BOOKING' : '400 PAX_LIST_TOO_LARGE (1-pax fixture)',
        `${r.status} ${errCode(r)}`,
        brief(r.data?.error || r.data, 200),
        { response: r.data },
      );
    }

    {
      const r = await cancelApi(V.br, {
        action: 'CANCEL', pnr: 'ZZZZZZ', cancellationPaxList: ['PAX1'],
      });
      expect(
        'validations',
        r.status === 422 && (errCode(r) === 'PNR_INVALID' || errCode(r) === 'PNR_NOT_FOUND'),
        '4.pnr-invalid',
        'unknown pnr',
        '422 PNR_INVALID/NOT_FOUND',
        `${r.status} ${errCode(r)}`,
      );
    }

    {
      const r = await cancelApi(V.br, { action: 'NOPE', pnr: V.pnr });
      expect(
        'validations',
        r.status === 400 && errCode(r) === 'VALIDATION_ERROR',
        '4.bad-action',
        'bad action',
        '400 VALIDATION_ERROR',
        `${r.status} ${errCode(r)}`,
      );
    }
  }

  // ============================================================
  // FUNCTIONAL cancels
  // ============================================================
  console.log('\n=== FUNCTIONAL CANCELS ===');

  // OW-P1: cancel PAX2 on 2ADT (fresh — if 4.1b already cancelled PAX1 on OW2, use OW3 for adult cancel)
  // Prefer OW2 if still fully confirmed with both pax; else book note
  let ow2 = await loadFixture(flight, SEED.OW2);
  report.fixtures.OW2_afterValidations = ow2;

  if (ow2.usable) {
    const r = await cancelApi(ow2.br, {
      action: 'CANCEL', pnr: ow2.pnr, cancellationPaxList: ['PAX2'],
    });
    const scope = paxScope(r);
    const st = cancelStatus(r);
    expect(
      'functional',
      ok(r) && /request|cancel/i.test(String(st)) && !/fail/i.test(String(st))
        && scope?.scope === 'PARTIAL_PAX' && scope?.cancellationPaxList?.includes('PAX2'),
      'OW-P1',
      'OW 2ADT CANCEL ["PAX2"]',
      'PARTIAL_PAX PAX2 Requested/Cancelled',
      `${r.status} ${st} scope=${scope?.scope}`,
      brief(r.data, 280),
      { br: ow2.br, pnr: ow2.pnr, leg: 'ONWARD', paxCancelled: ['PAX2'], response: r.data },
    );
    await sleep(3000);
    const after = await flight.getBookingDetail(ow2.br);
    report.functional[report.functional.length - 1].afterStatus = after.data?.status;
  } else {
    add('functional', {
      id: 'OW-P1', how: 'OW 2ADT PAX2', expected: 'PARTIAL_PAX', actual: 'fixture not usable', status: 'NOT_TESTED',
    });
  }

  // OW-P2: cancel child PAX3 on OW3
  let ow3 = await loadFixture(flight, SEED.OW3);
  if (ow3.usable && (ow3.pax || []).includes('PAX3')) {
    const r = await cancelApi(ow3.br, {
      action: 'CANCEL', pnr: ow3.pnr, cancellationPaxList: ['PAX3'],
    });
    const scope = paxScope(r);
    const st = cancelStatus(r);
    expect(
      'functional',
      ok(r) && /request|cancel/i.test(String(st)) && !/fail/i.test(String(st))
        && (scope?.scope === 'PARTIAL_PAX' || scope?.cancellationPaxList?.includes('PAX3')),
      'OW-P2',
      'OW 2ADT+1CHD CANCEL ["PAX3"] child',
      'PARTIAL_PAX PAX3',
      `${r.status} ${st} scope=${scope?.scope}`,
      brief(r.data, 280),
      { br: ow3.br, pnr: ow3.pnr, leg: 'ONWARD', paxCancelled: ['PAX3'], response: r.data },
    );
    await sleep(3000);
    const after = await flight.getBookingDetail(ow3.br);
    report.functional[report.functional.length - 1].afterStatus = after.data?.status;
  } else {
    add('functional', {
      id: 'OW-P2', how: 'cancel CHD', expected: 'PARTIAL_PAX PAX3', actual: 'fixture missing', status: 'NOT_TESTED',
    });
  }

  // RT-P1: cancel RETURN leg full (1ADT, no list)
  const rt1 = report.fixtures.RT1;
  if (rt1?.usable && rt1.returnPnr) {
    const r = await cancelApi(rt1.br, { action: 'CANCEL', pnr: rt1.returnPnr });
    const st = cancelStatus(r);
    expect(
      'functional',
      ok(r) && /request|cancel/i.test(String(st)) && !/fail/i.test(String(st)),
      'RT-P1',
      'RT 1ADT CANCEL return PNR (no list)',
      'RETURN cancelled; onward live',
      `${r.status} ${st}`,
      brief(r.data, 280),
      {
        br: rt1.br, leg: 'RETURN', pnr: rt1.returnPnr, paxCancelled: 'ALL_ON_PNR', response: r.data,
      },
    );
    await sleep(4000);
    const after = await flight.getBookingDetail(rt1.br);
    report.functional[report.functional.length - 1].afterStatus = after.data?.status;
    report.functional[report.functional.length - 1].afterLegs = legsOf(after.data);
  } else {
    add('functional', {
      id: 'RT-P1', how: 'RT return-leg', expected: 'Partially cancelled', actual: 'RT1 missing', status: 'NOT_TESTED',
    });
  }

  // RT-P2: different pax on different legs — RETURN PAX1, then ONWARD PAX2
  const rt2 = report.fixtures.RT2;
  if (rt2?.usable && rt2.returnPnr && rt2.onwardPnr) {
    const rRet = await cancelApi(rt2.br, {
      action: 'CANCEL', pnr: rt2.returnPnr, cancellationPaxList: ['PAX1'],
    });
    const stRet = cancelStatus(rRet);
    const scopeRet = paxScope(rRet);
    expect(
      'functional',
      ok(rRet) && /request|cancel/i.test(String(stRet)) && !/fail/i.test(String(stRet)),
      'RT-P2a',
      'RT 2ADT CANCEL RETURN ["PAX1"]',
      'PARTIAL/FULL on RETURN for PAX1',
      `${rRet.status} ${stRet} scope=${scopeRet?.scope}`,
      brief(rRet.data, 280),
      {
        br: rt2.br, leg: 'RETURN', pnr: rt2.returnPnr, paxCancelled: ['PAX1'], response: rRet.data,
      },
    );
    await sleep(4000);

    const rOn = await cancelApi(rt2.br, {
      action: 'CANCEL', pnr: rt2.onwardPnr, cancellationPaxList: ['PAX2'],
    });
    const stOn = cancelStatus(rOn);
    const scopeOn = paxScope(rOn);
    expect(
      'functional',
      ok(rOn) && /request|cancel/i.test(String(stOn)) && !/fail/i.test(String(stOn)),
      'RT-P2b',
      'RT 2ADT CANCEL ONWARD ["PAX2"]',
      'PARTIAL on ONWARD for PAX2',
      `${rOn.status} ${stOn} scope=${scopeOn?.scope}`,
      brief(rOn.data, 280),
      {
        br: rt2.br, leg: 'ONWARD', pnr: rt2.onwardPnr, paxCancelled: ['PAX2'], response: rOn.data,
      },
    );
    await sleep(4000);
    const after = await flight.getBookingDetail(rt2.br);
    report.functional[report.functional.length - 1].afterStatus = after.data?.status;
    report.functional[report.functional.length - 1].afterLegs = legsOf(after.data);
  } else {
    add('functional', {
      id: 'RT-P2', how: 'diff pax diff legs', expected: 'RETURN PAX1 + ONWARD PAX2', actual: 'RT2 missing', status: 'NOT_TESTED',
    });
  }

  // OW1 full cancel control (optional)
  const ow1 = await loadFixture(flight, SEED.OW1);
  if (ow1.usable) {
    const r = await cancelApi(ow1.br, { action: 'CANCEL', pnr: ow1.pnr });
    const st = cancelStatus(r);
    expect(
      'functional',
      ok(r) && /request|cancel/i.test(String(st)) && !/fail/i.test(String(st)),
      'OW-FULL',
      'OW 1ADT full cancel no list',
      'Cancelled / Requested',
      `${r.status} ${st}`,
      brief(r.data, 220),
      { br: ow1.br, leg: 'ONWARD', paxCancelled: 'ALL', response: r.data },
    );
  }

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nSCORE', report.score);
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
