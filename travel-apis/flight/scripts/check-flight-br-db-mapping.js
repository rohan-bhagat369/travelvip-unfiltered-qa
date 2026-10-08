/**
 * Fetch one BR from staging and emit expected DB mapping + phpMyAdmin SQL.
 *   node scripts/check-flight-br-db-mapping.js BR1790075773101525
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';

process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';

const BR = process.argv[2] || process.env.BR || 'BR1790075773101525';
const OUT_JSON = path.join('reports', `flight-db-map-${BR}.json`);
const OUT_SQL = path.join('reports', `flight-db-map-${BR}.sql`);
const OUT_MD = path.join('reports', `flight-db-map-${BR}.md`);

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function extractExpected(detail, status) {
  const data = detail?.data || detail || {};
  const brsp = data.bookingResponse || data;
  const itinerary = brsp.itinerary || data.itinerary || [];
  const passengers = brsp.passengers || data.passengers || [];
  const sales = brsp.salesSummary || data.salesSummary || {};
  const contact = brsp.contact || data.contact || {};

  const journeys = itinerary.map((leg, i) => {
    const segs = leg.segments || [];
    const first = segs[0] || {};
    const last = segs[segs.length - 1] || {};
    return {
      sequence: i + 1,
      origin: first.departure?.airportCode || first.origin || leg.origin,
      destination: last.arrival?.airportCode || last.destination || leg.destination,
      airlinePnr: leg.pnr || leg.airlinePnr || null,
      stops: leg.totalStops ?? Math.max(0, segs.length - 1),
      segments: segs.map((s) => ({
        airline: s.airline?.code || s.airlineCode,
        flightNumber: s.flightNumber,
        from: s.departure?.airportCode,
        to: s.arrival?.airportCode,
        dep: s.departure?.dateTime || s.departure?.time,
        arr: s.arrival?.dateTime || s.arrival?.time,
      })),
    };
  });

  const pax = passengers.map((p, i) => {
    const profile = p.profile || p;
    const ssr = p.ssr || {};
    return {
      index: i + 1,
      paxId: p.paxId || `PAX${i + 1}`,
      type: p.type || p.paxType || profile.type,
      isLead: Boolean(p.isLead ?? profile.isLead),
      title: profile.title,
      firstName: profile.firstName || p.firstName,
      lastName: profile.lastName || p.lastName,
      gender: profile.gender || p.gender,
      dob: profile.dob || p.dob,
      nationality: profile.nationality || p.nationality,
      eticket: p.eticketNumber || p.eTicket || p.ticketNumber || null,
      vendorPnr: p.pnr || p.vendorPnr || null,
      meals: (ssr.meals || p.meals || []).length,
      seats: (ssr.seats || p.seats || []).length,
      baggage: (ssr.baggage || p.baggage || []).length,
    };
  });

  const journeyCount = journeys.length || 1;
  const paxCount = pax.length;
  const expectedCells = journeyCount * paxCount;

  return {
    br: BR,
    apiStatus: status || data.status || brsp.status,
    totalAmount: money(sales.totalAmount ?? brsp.totalAmount ?? data.totalAmount),
    currency: sales.currency || brsp.currency || 'INR',
    contact: {
      email: contact.email,
      mobile: contact.mobile || contact.mobileNumber,
      countryCode: contact.countryCode,
    },
    journeyType: journeys.length > 1 ? 'ROUND_TRIP_OR_MC' : 'ONE_WAY',
    journeys,
    passengers: pax,
    expected: {
      booking_row: 1,
      booking_item_flight: 1,
      booking_passenger: paxCount,
      flight_journey: journeyCount,
      flight_journey_passenger_cells: expectedCells,
      cell_formula: `${journeyCount} journeys × ${paxCount} pax = ${expectedCells}`,
      item_status: /confirm/i.test(String(status || data.status || '')) ? 'Confirmed' : String(status || data.status || ''),
    },
  };
}

function sqlFor(br) {
  return `-- Flight DB mapping check for ${br}
-- Paste in phpMyAdmin → SQL tab (select travelx / staging schema first)
USE travelx;

SET @br := '${br}';

-- 1) Booking header
SELECT b.id, b.booking_reference, b.confirmed_at, b.cancelled_at, b.created_at
FROM booking b
WHERE b.booking_reference = @br;

-- 2) Booking item + status
SELECT b.booking_reference, bi.id AS booking_item_id, bi.service_type, bi.version,
       bsm.code AS item_status, bi.current_status_mapping_id
FROM booking b
JOIN booking_item bi ON bi.booking_id = b.id
LEFT JOIN booking_status_mapping bsm ON bsm.id = bi.current_status_mapping_id
WHERE b.booking_reference = @br;

-- 3) Passengers
SELECT bp.id, bp.pax_id, bp.title, bp.first_name, bp.last_name, bp.gender, bp.dob,
       bp.passenger_type, bp.is_lead, bp.nationality
FROM booking_passenger bp
JOIN booking b ON b.id = bp.booking_id
WHERE b.booking_reference = @br
ORDER BY bp.id;

-- 4) Journeys
SELECT fj.id, fj.sequence, fj.origin, fj.destination, fj.airline_pnr, fj.stops
FROM flight_journey fj
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY fj.sequence;

-- 5) Segments (if table exists)
SELECT fs.id, fj.sequence AS journey_seq, fs.sequence AS seg_seq,
       fs.airline_code, fs.flight_number, fs.origin, fs.destination,
       fs.departure_at, fs.arrival_at
FROM flight_segment fs
JOIN flight_journey fj ON fj.id = fs.flight_journey_id
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY fj.sequence, fs.sequence;

-- 6) FJP cells (1 pax × 1 journey)
SELECT
  bp.pax_id, bp.first_name, bp.last_name,
  fj.sequence AS journey_seq, fj.origin, fj.destination,
  fjp.id AS cell_id, fjp.eticket_number, fjp.vendor_pnr, fjp.pnr_override,
  bsm.code AS cell_status
FROM flight_journey_passenger fjp
JOIN flight_journey fj ON fj.id = fjp.flight_journey_id
JOIN booking_passenger bp ON bp.id = fjp.booking_passenger_id
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
LEFT JOIN booking_status_mapping bsm ON bsm.id = fjp.current_status_mapping_id
WHERE b.booking_reference = @br
ORDER BY bp.pax_id, fj.sequence;

-- 7) Cell count vs expected
SELECT
  b.booking_reference,
  COUNT(DISTINCT fj.id) AS journeys,
  COUNT(DISTINCT bp.id) AS pax,
  COUNT(fjp.id) AS cells,
  COUNT(DISTINCT fj.id) * COUNT(DISTINCT bp.id) AS expected_cells,
  CASE
    WHEN COUNT(fjp.id) = COUNT(DISTINCT fj.id) * COUNT(DISTINCT bp.id) THEN 'PASS'
    ELSE 'BUG'
  END AS cell_model
FROM booking b
JOIN booking_item bi ON bi.booking_id = b.id AND bi.service_type IN ('flight','flights','FLIGHT','FLIGHTS')
JOIN flight_journey fj ON fj.booking_item_id = bi.id
JOIN booking_passenger bp ON bp.booking_id = b.id
LEFT JOIN flight_journey_passenger fjp
  ON fjp.flight_journey_id = fj.id AND fjp.booking_passenger_id = bp.id
WHERE b.booking_reference = @br
GROUP BY b.booking_reference;

-- 8) SSR
SELECT 'meal' AS kind, pm.* FROM passenger_meal pm
JOIN booking_passenger bp ON bp.id = pm.booking_passenger_id
JOIN booking b ON b.id = bp.booking_id WHERE b.booking_reference = @br;
SELECT 'baggage' AS kind, pb.* FROM passenger_baggage pb
JOIN booking_passenger bp ON bp.id = pb.booking_passenger_id
JOIN booking b ON b.id = bp.booking_id WHERE b.booking_reference = @br;
SELECT 'seat' AS kind, ps.* FROM passenger_seat ps
JOIN booking_passenger bp ON bp.id = ps.booking_passenger_id
JOIN booking b ON b.id = bp.booking_id WHERE b.booking_reference = @br;

-- 9) Payment
SELECT pt.id, pt.status, pt.amount, pt.txn_type, pt.created_at
FROM payment_transaction pt
JOIN booking b ON b.id = pt.booking_id
WHERE b.booking_reference = @br;
`;
}

async function main() {
  clearSession();
  console.log('BASE', process.env.BASE_URL, 'BR', BR);
  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const flight = new FlightService(session.client);

  const st = await flight.getBookingStatus(BR);
  const detail = await flight.getBookingDetail(BR);
  console.log('status http', st.status, st.data?.status);
  console.log('detail http', detail.status, detail.ok);

  if (!detail.ok && detail.status >= 400) {
    console.error('Detail failed', JSON.stringify(detail.data).slice(0, 500));
    process.exit(1);
  }

  const expected = extractExpected(detail, st.data?.status || detail.data?.status);
  const report = {
    at: new Date().toISOString(),
    base: process.env.BASE_URL,
    br: BR,
    api: {
      statusHttp: st.status,
      status: st.data?.status,
      detailHttp: detail.status,
      detailOk: detail.ok,
    },
    expected,
    note: 'No DB credentials in this repo — run reports SQL in phpMyAdmin travelx and compare to expected.',
    rawSnippet: {
      keys: Object.keys(detail.data || {}),
      bookingResponseKeys: Object.keys(detail.data?.bookingResponse || {}),
    },
  };

  // Keep a trimmed API dump for comparison (no huge blobs)
  const brsp = detail.data?.bookingResponse || detail.data || {};
  report.apiSnapshot = {
    status: st.data?.status,
    totalAmount: expected.totalAmount,
    itinerary: (brsp.itinerary || []).map((leg, i) => ({
      i,
      pnr: leg.pnr,
      origin: leg.segments?.[0]?.departure?.airportCode,
      dest: leg.segments?.[(leg.segments?.length || 1) - 1]?.arrival?.airportCode,
      flights: (leg.segments || []).map((s) => `${s.airline?.code || s.airlineCode} ${s.flightNumber}`),
    })),
    passengers: (brsp.passengers || []).map((p) => ({
      paxId: p.paxId,
      name: `${p.profile?.firstName || p.firstName} ${p.profile?.lastName || p.lastName}`,
      type: p.type || p.paxType,
      isLead: p.isLead,
      eticket: p.eticketNumber || p.eTicket || p.ticketNumber,
      pnr: p.pnr,
    })),
    contact: brsp.contact,
    salesSummary: brsp.salesSummary,
  };

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
  fs.writeFileSync(OUT_SQL, sqlFor(BR));

  const md = `# DB mapping check — ${BR}

**API:** ${process.env.BASE_URL}  
**Status:** ${report.api.status}  
**Amount:** ${expected.totalAmount} ${expected.currency}  
**Journeys:** ${expected.journeys.length} · **Pax:** ${expected.passengers.length} · **Expected FJP cells:** ${expected.expected.flight_journey_passenger_cells}

## Expected vs DB (fill after SQL)

| # | Rule | Expected (from API) | DB actual | Status |
|---|---|---|---|---|
| 1 | booking row | 1 row for ${BR} | | |
| 2 | booking_item service_type | flight | | |
| 3 | item status | ${expected.expected.item_status} | | |
| 4 | booking_passenger count | ${expected.passengers.length} | | |
| 5 | passenger names / lead | ${expected.passengers.map((p) => `${p.firstName} ${p.lastName}${p.isLead ? ' (lead)' : ''}`).join('; ')} | | |
| 6 | flight_journey count | ${expected.journeys.length} | | |
| 7 | journey OD / PNR | ${expected.journeys.map((j) => `${j.origin}-${j.destination} pnr=${j.airlinePnr || '-'}`).join('; ')} | | |
| 8 | FJP cells = journeys × pax | ${expected.expected.cell_formula} | | |
| 9 | eticket / vendor_pnr on cells | present if Confirmed | | |
| 10 | payment_transaction | amount ≈ ${expected.totalAmount} | | |

## API snapshot
\`\`\`json
${JSON.stringify(report.apiSnapshot, null, 2)}
\`\`\`

SQL: \`${OUT_SQL}\`
`;
  fs.writeFileSync(OUT_MD, md);

  console.log('\n=== EXPECTED DB MAPPING ===');
  console.log(JSON.stringify(expected, null, 2));
  console.log('\nWrote', OUT_JSON);
  console.log('Wrote', OUT_SQL);
  console.log('Wrote', OUT_MD);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
