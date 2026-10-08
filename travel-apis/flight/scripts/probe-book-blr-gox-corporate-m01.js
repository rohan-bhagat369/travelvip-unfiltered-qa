/**
 * M01 — Book OW BLR→SXV CORPORATE with gstDetails.
 * Rotates passenger names + tries multiple searchIds per search.
 * Accepts Confirmed / InProgress / Pending for DB GST (rows written early).
 *
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-book-blr-gox-corporate-m01.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildOneWaySearchBody,
  buildIssueTicketPayload,
  isTerminalBookingStatus,
  isSearchProgressComplete,
  extractSearchIds,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = 'reports/db-m01-blr-sxv-corporate-canary.json';
const Q = { ...FLIGHT_QUERY };

const VALID_GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

const PAX_POOL = [
  { title: 'Mr', firstName: 'Amit', lastName: 'Sharma', gender: 'Male', dob: '1985-03-12' },
  { title: 'Mr', firstName: 'Vikram', lastName: 'Patil', gender: 'Male', dob: '1990-07-21' },
  { title: 'Mr', firstName: 'Suresh', lastName: 'Nair', gender: 'Male', dob: '1988-11-05' },
  { title: 'Mrs', firstName: 'Priya', lastName: 'Iyer', gender: 'Female', dob: '1992-01-18' },
  { title: 'Mr', firstName: 'Karan', lastName: 'Mehta', gender: 'Male', dob: '1986-09-30' },
  { title: 'Ms', firstName: 'Neha', lastName: 'Reddy', gender: 'Female', dob: '1994-04-08' },
  { title: 'Mr', firstName: 'Rohit', lastName: 'Desai', gender: 'Male', dob: '1989-12-14' },
  { title: 'Mr', firstName: 'Ankit', lastName: 'Joshi', gender: 'Male', dob: '1991-06-25' },
];

function brief(d, n = 400) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

function sumBreakup(list) {
  if (!Array.isArray(list)) return 0;
  return list.reduce((acc, x) => acc + Number(x?.amount ?? 0), 0);
}

function gstFromPricing(data) {
  const gstBreakup = Array.isArray(data?.gstBreakup) ? data.gstBreakup : [];
  const sum = sumBreakup(gstBreakup);
  const total = data?.pricing?.gstTotal ?? data?.gstTotal ?? (gstBreakup.length ? sum : null);
  const hasExplicitTotal = data?.pricing?.gstTotal != null || data?.gstTotal != null;
  return {
    addGstInfo: data?.addGstInfo ?? null,
    gstBreakup,
    gstTotal: total,
    sumBreakup: sum,
    hasExplicitGstTotal: hasExplicitTotal,
    parity: total != null && gstBreakup.length ? Number(total) === sum : null,
  };
}

function attachGstIfRequired(payload, pricingData) {
  const needsGst = pricingData?.addGstInfo === true
    || (Array.isArray(pricingData?.gstBreakup) && pricingData.gstBreakup.length > 0);
  if (!needsGst) {
    payload.data.includeGst = false;
    payload.data.gstDetails = null;
    return { attached: false };
  }
  payload.data.includeGst = true;
  payload.data.addGstInfo = true;
  payload.data.gstDetails = { ...VALID_GST };
  return { attached: true };
}

function isUsableForDbGst(status) {
  const s = String(status || '');
  return /confirm|inprogress|pending/i.test(s) && !/fail|cancel/i.test(s);
}

/** Poll briefly; return as soon as Pending/InProgress (DB rows exist) or terminal. */
async function waitStatusEarly(flight, br) {
  let last = null;
  for (let i = 0; i < 8; i += 1) {
    const st = await flight.getBookingStatus(br);
    last = String(st.data?.status || '');
    console.log('    status', i + 1, last);
    if (isTerminalBookingStatus(last)) return last;
    if (/inprogress|pending/i.test(last) && i >= 1) return last;
    await sleep(2000);
  }
  return last;
}

async function searchUntilIds(flight, body, { maxPoll = 8, limit = 6 } = {}) {
  let last = null;
  for (let i = 0; i < maxPoll; i += 1) {
    last = await flight.search(body);
    const ids = extractSearchIds(last.data, limit);
    console.log('  search', i + 1, last.data?.progress?.state, `ids=${ids.length}`);
    if (ids.length) return { data: last.data, ids };
    if (isSearchProgressComplete(last.data)) break;
    await sleep(2500);
  }
  return { data: last?.data, ids: extractSearchIds(last?.data, limit) };
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('M01 BLR→SXV CORPORATE (multi pax / multi searchId) on', config.baseUrl);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const dayOffsets = [18, 19, 21, 23, 25, 26, 28, 30, 32, 33, 40];
  let fixture = null;
  let pricingGst = null;
  let lastIssueError = null;
  let paxIdx = 0;
  const attempts = [];

  for (const days of dayOffsets) {
    if (fixture) break;
    console.log(`\n=== SEARCH OW CORPORATE BLR→SXV d+${days} ===`);
    const body = buildOneWaySearchBody(days, {
      origin: 'BLR',
      destination: 'SXV',
      fareType: 'CORPORATE',
      maxStops: 0,
    });
    body.travellers = { adults: 1, children: 0, infants: 0 };

    const { ids } = await searchUntilIds(flight, body, { limit: 6 });
    if (!ids.length) {
      console.log('  no searchIds');
      continue;
    }
    console.log('  trying searchIds:', ids.map((id) => id.slice(0, 18)).join(', '));

    for (let si = 0; si < ids.length; si += 1) {
      if (fixture) break;
      const sid = ids[si];
      const paxBase = PAX_POOL[paxIdx % PAX_POOL.length];
      paxIdx += 1;
      const tag = `${Date.now().toString(36).slice(-4)}${si}`;
      const passengerProfile = {
        ...paxBase,
        lastName: `${paxBase.lastName}${tag}`,
      };

      console.log(`\n  -- option ${si + 1}/${ids.length} sid=${sid.slice(0, 22)}… pax=${passengerProfile.firstName} ${passengerProfile.lastName}`);

      const pricing = await flight.getPricing([sid], 'ONE_WAY');
      if (!pricing.data?.priceId) {
        console.log('  pricing fail', brief(pricing.data, 180));
        attempts.push({ days, sid, ok: false, stage: 'pricing', err: brief(pricing.data, 120) });
        continue;
      }

      const gst = gstFromPricing(pricing.data);
      console.log(
        '  GST addGst=', pricing.data.addGstInfo,
        'total', gst.gstTotal, 'sum', gst.sumBreakup,
        'codes', gst.gstBreakup.map((x) => x.code),
        'fare', pricing.data?.pricing?.totalAmount,
      );
      if (!gst.gstBreakup.length) {
        console.log('  skip — no gstBreakup');
        continue;
      }
      pricingGst = gst;

      const payload = buildIssueTicketPayload({
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        searchIds: [sid],
        journeyType: 'ONE_WAY',
        passengerProfile,
      });
      attachGstIfRequired(payload, pricing.data);

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
        lastIssueError = issue.data;
        console.log('  issue fail', brief(issue.data, 280));
        attempts.push({ days, sid, ok: false, stage: 'issue', err: brief(issue.data, 200), pax: passengerProfile.firstName });
        if (issue.data?.error?.code === 'INSUFFICIENT_BALANCE') {
          throw Object.assign(new Error('INSUFFICIENT_BALANCE'), { lastIssueError });
        }
        continue;
      }

      // Capture early — Pending/InProgress already has journey GST in DB
      const status = await waitStatusEarly(flight, br);
      const detail = await flight.getBookingDetail(br);
      const detailStatus = detail.data?.status || status;
      const pnr = (detail.data?.bookingResponse?.itinerary || []).find((x) => x.pnr)?.pnr || null;

      attempts.push({
        days, sid, br, status: detailStatus, pnr,
        pax: `${passengerProfile.firstName} ${passengerProfile.lastName}`,
        total: pricing.data?.pricing?.totalAmount,
        gstSum: gst.sumBreakup,
      });

      if (!isUsableForDbGst(detailStatus)) {
        console.log('  not usable', detailStatus, '— try next searchId/pax');
        continue;
      }

      fixture = {
        br,
        route: 'BLR-SXV',
        days,
        searchId: sid,
        pnr,
        status: detailStatus,
        passenger: passengerProfile,
        dbGstUsable: true,
        note: /confirm/i.test(String(detailStatus))
          ? 'Confirmed'
          : 'InProgress/Pending — journey GST rows expected in DB',
        priceId: pricing.data.priceId,
        addGstInfo: pricing.data.addGstInfo,
        pricingGst: gst,
      };
      console.log('  FIXTURE OK', br, detailStatus, passengerProfile.firstName, passengerProfile.lastName);
      break;
    }
  }

  if (!fixture) {
    const err = new Error('No usable BLR→SXV CORPORATE booking (Confirmed/InProgress/Pending)');
    err.lastIssueError = lastIssueError;
    err.attempts = attempts;
    throw err;
  }

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    scenario: 'M01',
    checks: ['V089', 'V090'],
    fixture,
    pricingGst,
    attempts,
    table: [
      {
        rule: '1. M01 GST parity (pricing)',
        how: 'SUM(gstBreakup) vs gstTotal',
        status: pricingGst?.parity === true ? 'PASS' : (pricingGst?.parity === false ? 'BUG' : 'PASS*'),
        actual: `sum=${pricingGst?.sumBreakup} breakup=${JSON.stringify(pricingGst?.gstBreakup)}`,
      },
      {
        rule: '2. gstDetails + multi searchId/pax',
        how: 'Rotated pax names; tried multiple searchIds',
        status: 'PASS',
        actual: `BR ${fixture.br} status=${fixture.status} pax=${fixture.passenger.firstName} ${fixture.passenger.lastName}`,
      },
      {
        rule: '3. M01 GST parity (DB)',
        how: 'gst_total == SUM(breakup) — valid for InProgress too',
        status: 'NOT TESTED',
        note: `Run dbSql for ${fixture.br}`,
      },
    ],
    dbSql: [
      'USE travelx;',
      `SET @br := '${fixture.br}';`,
      '',
      '-- M01 / V089: gst_total == SUM(gst_breakup[].amount)',
      `SELECT fj.id, fj.direction, fj.origin, fj.destination, fj.airline_pnr,
       fj.gst_total, fj.gst_breakup,
       (SELECT COALESCE(SUM(jt.amount),0)
        FROM JSON_TABLE(IFNULL(fj.gst_breakup, JSON_ARRAY()), '$[*]' COLUMNS (amount DECIMAL(18,2) PATH '$.amount')) jt
       ) AS breakup_sum,
       CASE
         WHEN fj.gst_total = (
           SELECT COALESCE(SUM(jt.amount),0)
           FROM JSON_TABLE(IFNULL(fj.gst_breakup, JSON_ARRAY()), '$[*]' COLUMNS (amount DECIMAL(18,2) PATH '$.amount')) jt
         ) THEN 'PASS' ELSE 'FAIL'
       END AS m01_parity
FROM flight_journey fj
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br;`,
    ].join('\n'),
  };

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== RESULT ===');
  console.log(fixture.br, fixture.status, fixture.pnr, `${fixture.passenger.firstName} ${fixture.passenger.lastName}`);
  console.log('Report', OUT);
  console.log(`SQL: SET @br := '${fixture.br}';`);
}

main().catch((e) => {
  console.error(e.message || e);
  if (e.lastIssueError) console.error('lastIssueError', brief(e.lastIssueError, 400));
  if (e.attempts) {
    fs.mkdirSync('reports', { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ ranAt: new Date().toISOString(), failed: true, attempts: e.attempts, lastIssueError: e.lastIssueError }, null, 2));
  }
  process.exit(1);
});
