/**
 * Post-deploy: flight_journey_passenger cell model
 * - flight_segment_id DROPPED
 * - 1 cell = 1 passenger × 1 journey (leg), NOT per segment
 *
 * Run after deploy:
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-fjp-cell-model-postdeploy.js
 *
 * Then paste reports/fjp-cell-model-postdeploy.sql in phpMyAdmin.
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../../shared/lib/authService.js';
import { config } from '../../../../shared/config/env.js';
import { FlightService } from '../../src/service.js';
import {
  FLIGHT_QUERY,
  analyzeFlightOptions,
  buildIssueTicketPayload,
  buildOneWaySearchBody,
  buildPassengerProfile,
  buildRoundTripSearchBody,
  extractFirstSearchId,
  isSearchProgressComplete,
  isTerminalBookingStatus,
} from '../../src/helpers.js';
import { sleep } from '../../../../shared/lib/testUtils.js';

const OUT_JSON = 'reports/fjp-cell-model-postdeploy.json';
const OUT_SQL = 'reports/fjp-cell-model-postdeploy.sql';
const Q = { ...FLIGHT_QUERY };

function brief(d, n = 280) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

function isHttp500(res) {
  return Number(res?.status) === 500 || String(res?.data?.status) === '500';
}

function build2Adt(payloadBase, tag) {
  const p1 = buildPassengerProfile({
    title: 'Mr', firstName: 'Kabir', lastName: `Verma${tag}`, gender: 'Male', dob: '1988-05-12',
  });
  const p2 = buildPassengerProfile({
    title: 'Mrs', firstName: 'Ananya', lastName: `Verma${tag}`, gender: 'Female', dob: '1990-10-03',
  });
  payloadBase.data.passengers = [
    {
      paxId: 'PAX1', type: 'adult', isLead: true,
      profile: { title: p1.title, firstName: p1.firstName, lastName: p1.lastName, gender: p1.gender, dob: p1.dob, nationality: 'IN' },
      city: { cityCode: 'Pune', cityName: 'Pune' },
      passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
      ssr: { baggage: [], meals: [], seats: [] },
    },
    {
      paxId: 'PAX2', type: 'adult', isLead: false,
      profile: { title: p2.title, firstName: p2.firstName, lastName: p2.lastName, gender: p2.gender, dob: p2.dob, nationality: 'IN' },
      city: { cityCode: 'Pune', cityName: 'Pune' },
      passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
      ssr: { baggage: [], meals: [], seats: [] },
    },
  ];
  return { payload: payloadBase, passengers: [p1, p2] };
}

async function waitConfirmOrPending(flight, br, max = 8) {
  let last = null;
  for (let i = 0; i < max; i += 1) {
    const st = await flight.getBookingStatus(br);
    if (isHttp500(st)) return { status: 'STATUS_API_500', http: 500 };
    last = String(st.data?.status || '');
    console.log('  status', i + 1, last);
    if (isTerminalBookingStatus(last) || /confirm/i.test(last)) return { status: last, http: st.status };
    await sleep(2500);
  }
  return { status: last, http: 200 };
}

async function bookOw2Adt(flight, client, { connecting }) {
  const routes = connecting
    ? [{ o: 'DEL', d: 'GOI' }, { o: 'BOM', d: 'CCU' }]
    : [{ o: 'DEL', d: 'BOM' }, { o: 'BOM', d: 'BLR' }];
  for (const r of routes) {
    for (const days of [21, 28]) {
      console.log(`\nOW ${connecting ? 'CONN' : 'DIR'} ${r.o}-${r.d} d+${days}`);
      const body = buildOneWaySearchBody(days, {
        origin: r.o, destination: r.d, maxStops: connecting ? null : 0, fareType: 'NORMAL',
      });
      body.travellers = { adults: 2, children: 0, infants: 0 };
      body.preferences = { airlines: [], maxStops: connecting ? null : 0, refundableOnly: false };

      let search = null;
      for (let i = 0; i < 8; i += 1) {
        search = await flight.search(body);
        if (extractFirstSearchId(search.data) || isSearchProgressComplete(search.data)) break;
        await sleep(2000);
      }
      const a = analyzeFlightOptions(search.data, 'ONWARD');
      const opt = (connecting ? a.connecting : a.nonStop)[0];
      if (!opt?.searchId) continue;

      const pricing = await flight.getPricing([opt.searchId], 'ONE_WAY');
      if (!pricing.data?.priceId) continue;
      const tag = Date.now().toString(36).slice(-4);
      const base = buildIssueTicketPayload({
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        searchIds: [opt.searchId],
        journeyType: 'ONE_WAY',
      });
      const { payload, passengers } = build2Adt(base, tag);
      if (pricing.data?.addGstInfo === true) {
        payload.data.includeGst = true;
        payload.data.addGstInfo = true;
        payload.data.gstDetails = {
          gstNumber: '27AABCT1429B1Z1',
          gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
          gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
          gstEmailID: 'accounts@travelvip.ai',
          gstMobileNumber: '9921862715',
        };
      }
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
        if (issue.data?.error?.code === 'INSUFFICIENT_BALANCE') return { error: 'INSUFFICIENT_BALANCE', details: issue.data };
        continue;
      }
      const st = await waitConfirmOrPending(flight, br);
      return {
        scenario: connecting ? 'OW_2ADT_CONNECTING' : 'OW_2ADT_DIRECT',
        br,
        route: `${r.o}-${r.d}`,
        expectedCells: 2, // 1 journey × 2 pax
        expectedJourneys: 1,
        expectedPax: 2,
        passengers,
        status: st.status,
        total: pricing.data.pricing?.totalAmount,
      };
    }
  }
  return null;
}

async function bookRt2Adt(flight, client, { connecting }) {
  const routes = connecting
    ? [{ o: 'DEL', d: 'GOI' }, { o: 'BOM', d: 'CCU' }]
    : [{ o: 'DEL', d: 'BOM' }, { o: 'BOM', d: 'BLR' }];
  for (const r of routes) {
    for (const [od, rd] of [[21, 28], [25, 32]]) {
      console.log(`\nRT ${connecting ? 'CONN' : 'DIR'} ${r.o}-${r.d} d+${od}/${rd}`);
      const body = buildRoundTripSearchBody(od, rd, {
        origin: r.o, destination: r.d, maxStops: connecting ? null : 0, fareType: 'NORMAL',
      });
      body.travellers = { adults: 2, children: 0, infants: 0 };
      body.preferences = { airlines: [], maxStops: connecting ? null : 0, refundableOnly: false };

      let searchRes;
      try {
        searchRes = await flight.searchRoundTripUntilComplete(body);
      } catch (e) {
        console.log('  search fail', e.message);
        continue;
      }
      const data = searchRes.response?.data;
      const oa = analyzeFlightOptions(data, 'ONWARD');
      const ra = analyzeFlightOptions(data, 'RETURN');
      const o = (connecting ? oa.connecting : oa.nonStop)[0];
      const ret = (connecting ? ra.connecting : ra.nonStop)[0];
      if (!o?.searchId || !ret?.searchId) continue;

      const pricing = await flight.getPricing([o.searchId, ret.searchId], 'ROUND_TRIP');
      if (!pricing.data?.priceId) continue;
      const tag = Date.now().toString(36).slice(-4);
      const base = buildIssueTicketPayload({
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        searchIds: [o.searchId, ret.searchId],
        journeyType: 'ROUND_TRIP',
      });
      const { payload, passengers } = build2Adt(base, tag);
      if (pricing.data?.addGstInfo === true) {
        payload.data.includeGst = true;
        payload.data.addGstInfo = true;
        payload.data.gstDetails = {
          gstNumber: '27AABCT1429B1Z1',
          gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
          gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
          gstEmailID: 'accounts@travelvip.ai',
          gstMobileNumber: '9921862715',
        };
      }
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
        if (issue.data?.error?.code === 'INSUFFICIENT_BALANCE') return { error: 'INSUFFICIENT_BALANCE', details: issue.data };
        continue;
      }
      const st = await waitConfirmOrPending(flight, br);
      return {
        scenario: connecting ? 'RT_2ADT_CONNECTING' : 'RT_2ADT_DIRECT',
        br,
        route: `${r.o}-${r.d}`,
        expectedCells: 4, // 2 journeys × 2 pax  ★ primary ask
        expectedJourneys: 2,
        expectedPax: 2,
        passengers,
        status: st.status,
        total: pricing.data.pricing?.totalAmount,
      };
    }
  }
  return null;
}

function buildSql(fixtures) {
  const brList = fixtures.filter((f) => f?.br).map((f) => f.br);
  const lines = [
    'USE travelx;',
    '',
    '-- ========== TC0 SCHEMA GATE ==========',
    'SHOW COLUMNS FROM flight_journey_passenger;',
    "-- PASS: no column named flight_segment_id",
    "SELECT COUNT(*) AS flight_segment_id_cols",
    "FROM information_schema.COLUMNS",
    "WHERE TABLE_SCHEMA='travelx' AND TABLE_NAME='flight_journey_passenger' AND COLUMN_NAME='flight_segment_id';",
    '-- expect 0',
    '',
    '-- FK: cell -> journey CASCADE; cell -> passenger CASCADE; NO FK to flight_segment',
    "SELECT k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, r.DELETE_RULE",
    'FROM information_schema.KEY_COLUMN_USAGE k',
    'JOIN information_schema.REFERENTIAL_CONSTRAINTS r',
    '  ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND r.TABLE_NAME=k.TABLE_NAME',
    "WHERE k.TABLE_SCHEMA='travelx' AND k.TABLE_NAME='flight_journey_passenger' AND k.REFERENCED_TABLE_NAME IS NOT NULL;",
    '',
    '-- UNIQUE(flight_journey_id, booking_passenger_id) should still exist (G07)',
    "SHOW INDEX FROM flight_journey_passenger WHERE Key_name != 'PRIMARY';",
    '',
  ];

  for (const f of fixtures) {
    if (!f?.br) continue;
    lines.push(`-- ========== ${f.scenario}  BR=${f.br}  expect cells=${f.expectedCells} ==========`);
    lines.push(`SET @br := '${f.br}';`);
    lines.push('');
    lines.push('-- TC1 cardinality: cells = journeys × passengers');
    lines.push(`SELECT`);
    lines.push(`  (SELECT COUNT(*) FROM flight_journey fj`);
    lines.push(`   JOIN booking_item bi ON bi.id=fj.booking_item_id`);
    lines.push(`   JOIN booking b ON b.id=bi.booking_id WHERE b.booking_reference=@br) AS journeys,`);
    lines.push(`  (SELECT COUNT(*) FROM booking_passenger bp`);
    lines.push(`   JOIN booking b ON b.id=bp.booking_id WHERE b.booking_reference=@br) AS passengers,`);
    lines.push(`  (SELECT COUNT(*) FROM flight_journey_passenger fjp`);
    lines.push(`   JOIN flight_journey fj ON fj.id=fjp.flight_journey_id`);
    lines.push(`   JOIN booking_item bi ON bi.id=fj.booking_item_id`);
    lines.push(`   JOIN booking b ON b.id=bi.booking_id WHERE b.booking_reference=@br) AS cells,`);
    lines.push(`  ${f.expectedCells} AS expected_cells;`);
    lines.push(`-- PASS if cells = expected_cells (= journeys * passengers)`);
    lines.push('');
    lines.push('-- TC2 matrix: every pax × every journey present exactly once');
    lines.push(`SELECT bp.pax_id, bp.first_name, bp.last_name,`);
    lines.push(`       fj.id AS journey_id, fj.direction, fj.sequence, fj.airline_pnr,`);
    lines.push(`       fjp.id AS cell_id, fjp.eticket_number, fjp.pnr_override,`);
    lines.push(`       fjp.current_status_mapping_id, bsm.backend_status, bsm.user_status`);
    lines.push(`FROM flight_journey_passenger fjp`);
    lines.push(`JOIN flight_journey fj ON fj.id = fjp.flight_journey_id`);
    lines.push(`JOIN booking_passenger bp ON bp.id = fjp.booking_passenger_id`);
    lines.push(`JOIN booking_item bi ON bi.id = fj.booking_item_id`);
    lines.push(`JOIN booking b ON b.id = bi.booking_id`);
    lines.push(`LEFT JOIN booking_status_mapping bsm ON bsm.id = fjp.current_status_mapping_id`);
    lines.push(`WHERE b.booking_reference = @br`);
    lines.push(`ORDER BY fj.sequence, bp.pax_id;`);
    lines.push('');
    lines.push('-- TC3 data quality');
    lines.push(`SELECT`);
    lines.push(`  SUM(fjp.flight_journey_id IS NULL) AS null_journey,`);
    lines.push(`  SUM(fjp.booking_passenger_id IS NULL) AS null_passenger,`);
    lines.push(`  SUM(fjp.eticket_number IS NULL OR fjp.eticket_number='') AS null_eticket,`);
    lines.push(`  SUM(fjp.pnr_override IS NOT NULL) AS nonnull_pnr_override,`);
    lines.push(`  COUNT(DISTINCT CONCAT(fjp.flight_journey_id,'-',fjp.booking_passenger_id)) AS distinct_pairs,`);
    lines.push(`  COUNT(*) AS cell_rows`);
    lines.push(`FROM flight_journey_passenger fjp`);
    lines.push(`JOIN flight_journey fj ON fj.id=fjp.flight_journey_id`);
    lines.push(`JOIN booking_item bi ON bi.id=fj.booking_item_id`);
    lines.push(`JOIN booking b ON b.id=bi.booking_id`);
    lines.push(`WHERE b.booking_reference=@br;`);
    lines.push('-- PASS: null_journey=0, null_passenger=0, distinct_pairs=cell_rows');
    lines.push('-- PASS*: eticket populated when Confirmed; pnr_override usually NULL at booking');
    lines.push('');
    lines.push('-- TC4 NOT per-segment: cell count must NOT equal segment_count × pax');
    lines.push(`SELECT`);
    lines.push(`  (SELECT COUNT(*) FROM flight_segment fs`);
    lines.push(`   JOIN flight_journey fj ON fj.id=fs.flight_journey_id`);
    lines.push(`   JOIN booking_item bi ON bi.id=fj.booking_item_id`);
    lines.push(`   JOIN booking b ON b.id=bi.booking_id WHERE b.booking_reference=@br) AS segments,`);
    lines.push(`  (SELECT COUNT(*) FROM booking_passenger bp`);
    lines.push(`   JOIN booking b ON b.id=bp.booking_id WHERE b.booking_reference=@br) AS passengers,`);
    lines.push(`  (SELECT COUNT(*) FROM flight_journey_passenger fjp`);
    lines.push(`   JOIN flight_journey fj ON fj.id=fjp.flight_journey_id`);
    lines.push(`   JOIN booking_item bi ON bi.id=fj.booking_item_id`);
    lines.push(`   JOIN booking b ON b.id=bi.booking_id WHERE b.booking_reference=@br) AS cells;`);
    lines.push('-- For CONNECTING: segments > journeys, but cells must still = journeys × pax (NOT segments × pax)');
    lines.push('');
  }

  if (brList.length) {
    lines.push('-- ========== ALL FIXTURES QUICK COUNT ==========');
    lines.push(`SELECT b.booking_reference, COUNT(DISTINCT fj.id) AS journeys, COUNT(DISTINCT bp.id) AS pax, COUNT(fjp.id) AS cells`);
    lines.push(`FROM booking b`);
    lines.push(`JOIN booking_item bi ON bi.booking_id=b.id`);
    lines.push(`JOIN flight_journey fj ON fj.booking_item_id=bi.id`);
    lines.push(`JOIN booking_passenger bp ON bp.booking_id=b.id`);
    lines.push(`LEFT JOIN flight_journey_passenger fjp ON fjp.flight_journey_id=fj.id AND fjp.booking_passenger_id=bp.id`);
    lines.push(`WHERE b.booking_reference IN (${brList.map((x) => `'${x}'`).join(', ')})`);
    lines.push(`GROUP BY b.booking_reference;`);
  }

  return lines.join('\n');
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('FJP cell-model pack on', config.baseUrl);
  console.log('Ready cases: schema drop + OW/RT 2ADT direct/connecting cardinality');

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const fixtures = [];
  const jobs = [
    () => bookOw2Adt(flight, client, { connecting: false }),
    () => bookOw2Adt(flight, client, { connecting: true }),
    () => bookRt2Adt(flight, client, { connecting: false }),
    () => bookRt2Adt(flight, client, { connecting: true }),
  ];

  // Dry-ready mode: book only if BOOK=1
  const shouldBook = process.env.BOOK === '1';
  if (!shouldBook) {
    console.log('\nBOOK!=1 → writing SQL template only (no live bookings).');
    console.log('After deploy: BOOK=1 node scripts/probe-fjp-cell-model-postdeploy.js');
    const placeholder = [
      { scenario: 'OW_2ADT_DIRECT', br: '<OW_DIRECT_BR>', expectedCells: 2, expectedJourneys: 1, expectedPax: 2 },
      { scenario: 'OW_2ADT_CONNECTING', br: '<OW_CONN_BR>', expectedCells: 2, expectedJourneys: 1, expectedPax: 2 },
      { scenario: 'RT_2ADT_DIRECT', br: '<RT_DIRECT_BR>', expectedCells: 4, expectedJourneys: 2, expectedPax: 2 },
      { scenario: 'RT_2ADT_CONNECTING', br: '<RT_CONN_BR>', expectedCells: 4, expectedJourneys: 2, expectedPax: 2 },
    ];
    const sql = buildSql(placeholder);
    fs.mkdirSync('reports', { recursive: true });
    fs.writeFileSync(OUT_SQL, sql);
    fs.writeFileSync(OUT_JSON, JSON.stringify({
      ranAt: new Date().toISOString(),
      mode: 'TEMPLATE_ONLY',
      note: 'Set BOOK=1 after deploy to create fixtures then re-run',
      testCases,
      sqlFile: OUT_SQL,
    }, null, 2));
    console.log('Wrote', OUT_SQL, OUT_JSON);
    return;
  }

  for (const job of jobs) {
    const f = await job();
    if (!f) {
      fixtures.push({ ok: false, note: 'book failed / no inventory' });
      continue;
    }
    if (f.error === 'INSUFFICIENT_BALANCE') {
      fixtures.push(f);
      console.log('STOP balance');
      break;
    }
    fixtures.push({ ok: true, ...f });
    console.log('=>', f.scenario, f.br, f.status, `expectCells=${f.expectedCells}`);
  }

  const sql = buildSql(fixtures.filter((f) => f.br));
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT_SQL, sql);
  fs.writeFileSync(OUT_JSON, JSON.stringify({
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    mode: 'BOOKED',
    testCases,
    fixtures,
    sqlFile: OUT_SQL,
  }, null, 2));
  console.log('\nFixtures', fixtures.map((f) => ({ s: f.scenario, br: f.br, cells: f.expectedCells })));
  console.log('SQL', OUT_SQL);
}

const testCases = [
  {
    id: 'TC0',
    name: 'Schema: flight_segment_id dropped',
    how: 'SHOW COLUMNS / information_schema',
    pass: 'flight_segment_id absent; FKs only to flight_journey + booking_passenger',
  },
  {
    id: 'TC1',
    name: 'RT 2ADT → exactly 4 cells',
    how: 'Book RT 2ADT; COUNT cells',
    pass: 'cells = 4 = 2 journeys × 2 passengers (PAX1-ONWARD, PAX1-RETURN, PAX2-ONWARD, PAX2-RETURN)',
  },
  {
    id: 'TC2',
    name: 'OW 2ADT → exactly 2 cells',
    how: 'Book OW 2ADT; COUNT cells',
    pass: 'cells = 2 = 1 journey × 2 passengers',
  },
  {
    id: 'TC3',
    name: 'Connecting does NOT multiply cells by segments',
    how: 'Book RT/OW connecting; compare segments vs cells',
    pass: 'cells = journeys × pax (NOT segments × pax)',
  },
  {
    id: 'TC4',
    name: 'Cell data quality',
    how: 'Inspect fjp rows',
    pass: 'flight_journey_id + booking_passenger_id set; unique pair; eticket when Confirmed; pnr_override NULL at book',
  },
  {
    id: 'TC5',
    name: 'UNIQUE constraint still holds',
    how: 'Attempt duplicate (journey_id, passenger_id)',
    pass: 'INSERT fails / unique index present',
  },
];

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
