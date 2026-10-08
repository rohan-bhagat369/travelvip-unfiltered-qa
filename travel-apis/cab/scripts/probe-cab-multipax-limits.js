/**
 * Cab multi-passenger limits + validations for every journey type on api-staging.
 * Types: AIRPORT DEPARTURE, AIRPORT ARRIVAL, OUTSTATION, RENTAL
 *
 * Doc (error contract FB-2l): "Only one passenger is allowed for a cab booking."
 *
 *   BASE_URL=https://api-staging.travelvip.ai node scripts/probe-cab-multipax-limits.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { CabService } from '../src/service.js';
import {
  buildAirportSearchBody,
  buildOutstationSearchBody,
  buildRentalSearchBody,
  pickCab,
  futurePickupDatetime,
  CAB_QUERY,
} from '../src/helpers.js';
import { config } from '../../../shared/config/env.js';

const BASE = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
const OUT = 'reports/cab-multipax-limits.json';

clearSession();
process.env.BASE_URL = BASE;
const { client } = await authenticate(true);
const cab = new CabService(client);

function airportArrival(dt = futurePickupDatetime(20)) {
  return {
    journeyType: 'AIRPORT',
    travelType: 'ARRIVAL',
    airportCode: 'DEL',
    pickup: {
      name: 'IGI Airport-T1',
      city: 'Delhi',
      latitude: 28.5588,
      longitude: 77.0814,
    },
    drop: {
      name: 'Vasant Kunj, Delhi',
      city: 'Delhi',
      latitude: 28.5201,
      longitude: 77.1591,
    },
    distanceKm: 15,
    durationMin: 15,
    pickupDatetime: dt,
  };
}

const TYPES = [
  { id: 'AIRPORT_DEPARTURE', search: () => buildAirportSearchBody(futurePickupDatetime(21)) },
  { id: 'AIRPORT_ARRIVAL', search: () => airportArrival(futurePickupDatetime(22)) },
  { id: 'OUTSTATION', search: () => buildOutstationSearchBody(futurePickupDatetime(23)) },
  { id: 'RENTAL', search: () => buildRentalSearchBody(futurePickupDatetime(24)) },
];

function pax(n, { isLead = false, paxType = 'ADT', firstName, lastName, title, gender, dob, nationality } = {}) {
  return {
    paxId: n,
    paxType,
    isLead,
    profile: {
      title: title || 'Mr',
      firstName: firstName || (isLead ? config.cab.passengerFirstName : `Pax${n}`),
      lastName: lastName || (isLead ? config.cab.passengerLastName : `Test${n}`),
      gender: gender || 'male',
      dob: dob || config.cab.passengerDob,
      nationality: nationality || 'IN',
    },
  };
}

function contact() {
  return {
    email: config.cab.contactEmail,
    countryCode: config.cab.contactCountryCode,
    mobile: config.cab.contactMobile,
  };
}

function buildFinalize({ bookingReference, priceId, passengers }) {
  return {
    bookingReference,
    priceId,
    passengers,
    contact: contact(),
    otherDetails: 'multipax limit probe',
  };
}

async function pricePair(searchBody) {
  const search = await cab.search(searchBody);
  const selected = pickCab(search.data?.cabs);
  if (!selected) {
    return { ok: false, stage: 'search', searchHttp: search.status, err: search.data?.error || search.data };
  }
  const fare = await cab.fare(selected.searchId);
  if (!fare.data?.bookingReference || !fare.data?.priceId) {
    return { ok: false, stage: 'fare', fareHttp: fare.status, fare: fare.data };
  }
  return {
    ok: true,
    bookingReference: fare.data.bookingReference,
    priceId: fare.data.priceId,
    searchId: selected.searchId,
  };
}

async function tryFinalize(priced, passengers, label) {
  const body = buildFinalize({
    bookingReference: priced.bookingReference,
    priceId: priced.priceId,
    passengers,
  });
  const res = await cab.finalizeBooking(body);
  const br = res.data?.bookingRefId || res.data?.bookingReferenceId || null;
  return {
    label,
    passengerCount: Array.isArray(passengers) ? passengers.length : passengers == null ? null : 'non-array',
    http: res.status,
    code: res.data?.error?.code || null,
    message: res.data?.error?.message || res.data?.message || null,
    status: res.data?.status || null,
    br,
    accepted: res.ok === true && !!br,
    data: res.data,
  };
}

function scoreExpectReject(row, expectCodeHint) {
  // Expect 4xx validation — BUG if accepted (booked)
  if (row.accepted) {
    return { ...row, status: 'BUG', expect: 'REJECT 4xx', actual: `ACCEPTED BR=${row.br}` };
  }
  if (row.http >= 400) {
    const codeOk = !expectCodeHint || row.code === expectCodeHint || row.code === 'VALIDATION_ERROR';
    return {
      ...row,
      status: codeOk ? 'PASS' : 'BUG',
      expect: `REJECT ${expectCodeHint || '4xx'}`,
      actual: `HTTP ${row.http} code=${row.code} msg=${row.message}`,
    };
  }
  return {
    ...row,
    status: 'BUG',
    expect: 'REJECT 4xx',
    actual: `HTTP ${row.http} unexpected`,
  };
}

function scoreExpectAccept(row) {
  if (row.accepted) {
    return { ...row, status: 'PASS', expect: 'ACCEPT 1 pax', actual: `BR=${row.br} status=${row.status}` };
  }
  return {
    ...row,
    status: 'BUG',
    expect: 'ACCEPT 1 pax',
    actual: `HTTP ${row.http} code=${row.code} msg=${row.message}`,
  };
}

const rows = [];
const byType = {};

for (const t of TYPES) {
  console.log('\n===', t.id);
  const priced = await pricePair(t.search());
  if (!priced.ok) {
    rows.push({
      id: `${t.id}.SETUP`,
      cabType: t.id,
      rule: 'search→fare baseline for multipax',
      status: 'NOT TESTED',
      detail: priced,
    });
    byType[t.id] = { setup: priced, cases: [] };
    continue;
  }

  const cases = [];

  // Need fresh fare for each finalize attempt (bookingReference one-shot) — re-price each time
  async function fresh() {
    return pricePair(t.search());
  }

  // 1) Valid 1 ADT lead
  {
    const p = await fresh();
    if (!p.ok) {
      cases.push({ id: `${t.id}.P1`, status: 'NOT TESTED', detail: p });
    } else {
      const r = scoreExpectAccept(
        await tryFinalize(p, [pax(1, { isLead: true })], '1 ADT lead'),
      );
      r.id = `${t.id}.P1`;
      r.cabType = t.id;
      r.rule = '1 adult lead passenger → accept';
      cases.push(r);
      rows.push(r);
      console.log('P1', r.status, r.actual);
      // cancel if booked to free wallet noise
      if (r.br) {
        await new Promise((r) => setTimeout(r, 8000));
        await client.request({
          method: 'POST',
          path: `/v1/airportServices/cabs/bookings/${r.br}/cancel`,
          query: CAB_QUERY,
          partnerKey: client.partnerKey,
          body: { cancelledBy: 'USER', cancellationReason: 'multipax probe cleanup' },
        });
      }
    }
  }

  // 2) Zero passengers / omit
  {
    const p = await fresh();
    if (p.ok) {
      const r = scoreExpectReject(await tryFinalize(p, [], '0 passengers'), 'VALIDATION_ERROR');
      r.id = `${t.id}.P0`;
      r.cabType = t.id;
      r.rule = '0 passengers → reject';
      cases.push(r);
      rows.push(r);
      console.log('P0', r.status, r.actual);
    }
  }

  // 3) Missing passengers key
  {
    const p = await fresh();
    if (p.ok) {
      const body = buildFinalize({
        bookingReference: p.bookingReference,
        priceId: p.priceId,
        passengers: undefined,
      });
      delete body.passengers;
      const res = await cab.finalizeBooking(body);
      const row = scoreExpectReject(
        {
          label: 'omit passengers',
          passengerCount: null,
          http: res.status,
          code: res.data?.error?.code || null,
          message: res.data?.error?.message || null,
          br: res.data?.bookingRefId || null,
          accepted: res.ok && !!(res.data?.bookingRefId || res.data?.bookingReferenceId),
          data: res.data,
        },
        'VALIDATION_ERROR',
      );
      row.id = `${t.id}.POMIT`;
      row.cabType = t.id;
      row.rule = 'omit passengers → reject';
      cases.push(row);
      rows.push(row);
      console.log('POMIT', row.status, row.actual);
    }
  }

  // 4) Two adults
  {
    const p = await fresh();
    if (p.ok) {
      const r = scoreExpectReject(
        await tryFinalize(
          p,
          [pax(1, { isLead: true }), pax(2, { isLead: false })],
          '2 ADT',
        ),
        'VALIDATION_ERROR',
      );
      r.id = `${t.id}.P2`;
      r.cabType = t.id;
      r.rule = '2 adults → reject (limit 1)';
      cases.push(r);
      rows.push(r);
      console.log('P2', r.status, r.actual);
    }
  }

  // 5) Three adults
  {
    const p = await fresh();
    if (p.ok) {
      const r = scoreExpectReject(
        await tryFinalize(
          p,
          [pax(1, { isLead: true }), pax(2), pax(3)],
          '3 ADT',
        ),
        'VALIDATION_ERROR',
      );
      r.id = `${t.id}.P3`;
      r.cabType = t.id;
      r.rule = '3 adults → reject (limit 1)';
      cases.push(r);
      rows.push(r);
      console.log('P3', r.status, r.actual);
    }
  }

  // 6) 1 ADT + 1 CHD
  {
    const p = await fresh();
    if (p.ok) {
      const r = scoreExpectReject(
        await tryFinalize(
          p,
          [
            pax(1, { isLead: true }),
            pax(2, { paxType: 'CHD', dob: '2015-01-01' }),
          ],
          '1ADT+1CHD',
        ),
        'VALIDATION_ERROR',
      );
      r.id = `${t.id}.P2MIX`;
      r.cabType = t.id;
      r.rule = '1 ADT + 1 CHD → reject (limit 1)';
      cases.push(r);
      rows.push(r);
      console.log('P2MIX', r.status, r.actual);
    }
  }

  // 7) Two leads
  {
    const p = await fresh();
    if (p.ok) {
      const r = scoreExpectReject(
        await tryFinalize(
          p,
          [pax(1, { isLead: true }), pax(2, { isLead: true })],
          '2 leads',
        ),
        'VALIDATION_ERROR',
      );
      r.id = `${t.id}.P2LEAD`;
      r.cabType = t.id;
      r.rule = '2 passengers both isLead → reject';
      cases.push(r);
      rows.push(r);
      console.log('P2LEAD', r.status, r.actual);
    }
  }

  // 8) 1 pax but isLead false
  {
    const p = await fresh();
    if (p.ok) {
      const raw = await tryFinalize(p, [pax(1, { isLead: false })], '1 ADT not lead');
      // Doc unclear — record actual; prefer reject or accept with note
      const row = {
        ...raw,
        id: `${t.id}.P1NOLEAD`,
        cabType: t.id,
        rule: '1 ADT with isLead=false',
        expect: 'Document behaviour (reject or accept)',
        actual: raw.accepted
          ? `ACCEPTED BR=${raw.br}`
          : `HTTP ${raw.http} code=${raw.code} msg=${raw.message}`,
        status: 'NOTE',
      };
      if (raw.br) {
        await new Promise((r) => setTimeout(r, 8000));
        await client.request({
          method: 'POST',
          path: `/v1/airportServices/cabs/bookings/${raw.br}/cancel`,
          query: CAB_QUERY,
          partnerKey: client.partnerKey,
          body: { cancelledBy: 'USER', cancellationReason: 'multipax probe cleanup' },
        });
      }
      cases.push(row);
      rows.push(row);
      console.log('P1NOLEAD', row.status, row.actual);
    }
  }

  // 9) Invalid paxType
  {
    const p = await fresh();
    if (p.ok) {
      const r = scoreExpectReject(
        await tryFinalize(p, [pax(1, { isLead: true, paxType: 'DOG' })], 'bad paxType'),
        'VALIDATION_ERROR',
      );
      r.id = `${t.id}.PBADTYPE`;
      r.cabType = t.id;
      r.rule = 'invalid paxType DOG → reject';
      cases.push(r);
      rows.push(r);
      console.log('PBADTYPE', r.status, r.actual);
    }
  }

  // 10) Missing profile.firstName
  {
    const p = await fresh();
    if (p.ok) {
      const passengers = [pax(1, { isLead: true })];
      delete passengers[0].profile.firstName;
      const r = scoreExpectReject(await tryFinalize(p, passengers, 'no firstName'), 'VALIDATION_ERROR');
      r.id = `${t.id}.PNOFN`;
      r.cabType = t.id;
      r.rule = 'missing profile.firstName → reject';
      cases.push(r);
      rows.push(r);
      console.log('PNOFN', r.status, r.actual);
    }
  }

  byType[t.id] = { pricedOk: true, cases };
}

const summary = {
  PASS: rows.filter((r) => r.status === 'PASS').length,
  BUG: rows.filter((r) => r.status === 'BUG').length,
  NOTE: rows.filter((r) => r.status === 'NOTE').length,
  'NOT TESTED': rows.filter((r) => r.status === 'NOT TESTED').length,
};

const limitFinding = rows
  .filter((r) => /\.P2$|\.P3$|\.P2MIX$/.test(r.id))
  .map((r) => ({
    id: r.id,
    cabType: r.cabType,
    status: r.status,
    http: r.http,
    code: r.code,
    message: r.message,
    accepted: r.accepted,
  }));

const report = {
  ranAt: new Date().toISOString(),
  baseUrl: BASE,
  docNote: 'Error contract FB-2l: Only one passenger is allowed for a cab booking.',
  summary,
  limitFinding,
  bugs: rows.filter((r) => r.status === 'BUG'),
  byType,
  rows,
};

fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log('\n=== SUMMARY ===', summary);
console.log('Limit rows:', JSON.stringify(limitFinding, null, 2));
console.log('BUGS', report.bugs.map((b) => `${b.id}: ${b.actual}`).join('\n') || '(none)');
console.log('Wrote', OUT);
process.exit(summary.BUG > 0 ? 1 : 0);
