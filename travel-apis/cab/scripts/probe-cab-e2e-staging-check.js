/**
 * Cab E2E on staging with proper auth + A4 response shape checks.
 */
import fs from 'fs';
import { authenticate } from '../../../shared/lib/authService.js';
import { CabService } from '../src/service.js';
import { runCabBookingE2e } from '../src/e2eFlow.js';
import {
  buildAirportSearchBody,
  buildFinalizeBody,
  pickCab,
} from '../src/helpers.js';

function rowsFromE2e(label, ctx, fareData, statusData) {
  const rows = [];
  const details = statusData?.data?.details || statusData?.data || {};
  const progress = details.progress || {};
  const pickup = details.pickup || {};
  const drop = details.drop || {};
  const assignment = details.assignment || {};

  rows.push({ section: label, n: 1, rule: 'Search returns cabs', how: 'POST /v1/airportServices/cabs/search', status: ctx.steps[0]?.ok ? 'PASS' : 'BUG', actual: `HTTP ${ctx.steps[0]?.status} cabs=${ctx.steps[0]?.cabCount}` });
  rows.push({ section: label, n: 2, rule: 'Fare returns bookingReference + priceId', how: 'POST /v1/airportServices/cabs/fare', status: ctx.steps[1]?.ok ? 'PASS' : 'BUG', actual: `HTTP ${ctx.steps[1]?.status} priceId=${ctx.steps[1]?.priceId ? 'yes' : 'no'}` });
  rows.push({ section: label, n: 3, rule: 'Finalize returns BR', how: 'POST finalize-booking', status: ctx.bookingRefId ? 'PASS' : 'BUG', actual: `BR=${ctx.bookingRefId || '-'} HTTP ${ctx.steps[2]?.status}` });
  rows.push({ section: label, n: 4, rule: 'Status after book', how: `GET …/${ctx.bookingRefId}/status`, status: ctx.steps[3]?.ok ? 'PASS' : 'BUG', actual: `status=${ctx.bookingStatus}` });
  rows.push({ section: label, n: 5, rule: 'Cancel', how: 'GET …/cancel', status: ctx.steps[4]?.ok ? 'PASS' : 'BUG', actual: `HTTP ${ctx.steps[4]?.status}` });

  // A4 shape checks on status/details if present
  const hasExtraKmRate = details.extraKmRate != null || fareData?.extraKmRate != null;
  const hasOldLabel = details.extraKmFareLabel != null || fareData?.extraKmFareLabel != null;
  rows.push({
    section: `${label}-A4`, n: 1, rule: 'extraKmRate present (rupees number)', how: 'fare or status details',
    status: hasExtraKmRate ? 'PASS' : (fareData?.vehicle ? 'NOT TESTED' : 'BUG'),
    actual: `extraKmRate=${details.extraKmRate ?? fareData?.extraKmRate ?? 'missing'} extraKmFareLabel=${hasOldLabel ? 'STILL PRESENT' : 'gone'}`,
  });
  rows.push({
    section: `${label}-A4`, n: 2, rule: 'pickup/drop.address fields', how: 'status details',
    status: pickup.address || drop.address ? 'PASS' : 'NOT TESTED',
    actual: `pickup.address=${pickup.address ? 'yes' : 'no'} drop.address=${drop.address ? 'yes' : 'no'}`,
  });
  rows.push({
    section: `${label}-A4`, n: 3, rule: 'airportCode on leg only (DEPARTURE → drop)', how: 'status details',
    status: pickup.airportCode || drop.airportCode ? 'PASS' : 'NOT TESTED',
    actual: `pickup.airportCode=${pickup.airportCode || '-'} drop.airportCode=${drop.airportCode || '-'} top=${details.airportCode || '-'}`,
  });
  rows.push({
    section: `${label}-A4`, n: 4, rule: 'assignment.tripOtp must be gone', how: 'status details',
    status: assignment.tripOtp == null ? 'PASS' : 'BUG',
    actual: `assignment.tripOtp=${assignment.tripOtp ?? 'absent'} details.otp=${details.otp ?? 'n/a'}`,
  });
  rows.push({
    section: `${label}-A4`, n: 5, rule: 'progress block present', how: 'status details',
    status: Object.keys(progress).length ? 'PASS' : 'NOT TESTED',
    actual: JSON.stringify(progress),
  });
  rows.push({
    section: `${label}-A4`, n: 6, rule: 'vehicle + operator blocks in fare', how: '/fare response',
    status: fareData?.vehicle?.type && fareData?.operator?.name ? 'PASS' : 'BUG',
    actual: `vehicle=${fareData?.vehicle?.type}/${fareData?.vehicle?.model} operator=${fareData?.operator?.name}`,
  });

  return rows;
}

async function bookAirport(cab, travelType) {
  const body = buildAirportSearchBody();
  body.travelType = travelType;
  if (travelType === 'ARRIVAL') {
    body.pickup = { name: 'IGI Airport-T1', city: 'Delhi', latitude: 28.5588, longitude: 77.0814 };
    body.drop = { name: 'Vasant Kunj, Delhi', city: 'Delhi', latitude: 28.5201, longitude: 77.1591 };
  }
  const search = await cab.search(body);
  const selected = pickCab(search.data?.cabs);
  if (!selected?.searchId) throw new Error(`${travelType} search returned no cab`);
  const fare = await cab.fare(selected.searchId);
  const fin = await cab.finalizeBooking(buildFinalizeBody({
    bookingReference: fare.data.bookingReference,
    priceId: fare.data.priceId,
  }));
  const br = fin.data?.bookingRefId;
  let statusRes = null;
  for (let i = 0; i < 8; i++) {
    statusRes = await cab.getBookingStatus(br);
    const st = String(statusRes.data?.status || '');
    if (st && st.toLowerCase() !== 'pending') break;
    await new Promise((r) => setTimeout(r, 2500));
  }
  const cancel = await cab.cancelBooking(br);
  return { travelType, br, search, fare, fin, statusRes, cancel, body };
}

async function main() {
  process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
  const { client } = await authenticate(true);
  const cab = new CabService(client);
  const allRows = [];
  const dumps = {};

  // Full E2E via helper for AIRPORT DEPARTURE
  try {
    const ctx = await runCabBookingE2e(cab, 'AIRPORT');
    dumps.e2eAirport = ctx;
    const statusFull = await cab.getBookingStatus(ctx.bookingRefId);
    const fareRes = ctx.steps.find((s) => s.step === 'Cab Fare');
    allRows.push(...rowsFromE2e('E2E-AIRPORT', ctx, ctx.selectedCab, statusFull));
  } catch (e) {
    allRows.push({ section: 'E2E-AIRPORT', n: 0, rule: 'runCabBookingE2e AIRPORT', how: 'search→fare→book→status→cancel', status: 'BUG', actual: e.message });
  }

  // ARRIVAL book+cancel for airport_code row check (API side)
  try {
    const arr = await bookAirport(cab, 'ARRIVAL');
    dumps.arrival = {
      br: arr.br,
      fare: { vehicle: arr.fare.data?.vehicle, operator: arr.fare.data?.operator, extraKmRate: arr.fare.data?.extraKmRate, extraKmFareLabel: arr.fare.data?.extraKmFareLabel },
      details: arr.statusRes?.data?.details || arr.statusRes?.data,
      cancelHttp: arr.cancel.status,
    };
    allRows.push(...rowsFromE2e('ARRIVAL', {
      bookingRefId: arr.br,
      bookingStatus: arr.statusRes?.data?.status,
      steps: [
        { ok: arr.search.ok, status: arr.search.status, cabCount: arr.search.data?.cabs?.length },
        { ok: arr.fare.ok, status: arr.fare.status, priceId: arr.fare.data?.priceId },
        { ok: arr.fin.ok, status: arr.fin.status },
        { ok: arr.statusRes?.ok, status: arr.statusRes?.status },
        { ok: arr.cancel.ok, status: arr.cancel.status },
      ],
      selectedCab: arr.fare.data,
    }, arr.fare.data, arr.statusRes));
  } catch (e) {
    allRows.push({ section: 'ARRIVAL', n: 0, rule: 'AIRPORT ARRIVAL book', how: 'search→fare→book→cancel', status: 'BUG', actual: e.message });
  }

  // OUTSTATION + RENTAL full book (search → fare → finalize → status → cancel)
  for (const journeyType of ['OUTSTATION', 'RENTAL']) {
    try {
      const ctx = await runCabBookingE2e(cab, journeyType);
      dumps[journeyType.toLowerCase()] = ctx;
      const statusFull = await cab.getBookingStatus(ctx.bookingRefId);
      allRows.push(...rowsFromE2e(journeyType, ctx, ctx.selectedCab, statusFull));
    } catch (e) {
      allRows.push({
        section: journeyType,
        n: 0,
        rule: `${journeyType} full E2E`,
        how: 'search→fare→book→status→cancel',
        status: 'BUG',
        actual: e.message,
      });
    }
  }

  const counts = allRows.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
  const out = { baseUrl: process.env.BASE_URL, counts, rows: allRows, dumps };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync('reports/cab-e2e-staging-schema-check.json', JSON.stringify(out, null, 2));
  console.log('\n=== CAB E2E + A4 CHECK ===');
  for (const r of allRows) {
    const mark = r.status === 'PASS' ? 'PASS' : r.status === 'BUG' ? 'BUG ' : 'NT  ';
    console.log(`[${mark}] ${r.section}.${r.n} ${r.rule}`);
    if (r.actual) console.log(`       ${String(r.actual).slice(0, 220)}`);
  }
  console.log('\nCounts', counts);
  console.log('Report: reports/cab-e2e-staging-schema-check.json');
  if (counts.BUG) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
