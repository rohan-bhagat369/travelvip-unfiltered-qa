/**
 * Book CORPORATE RT 2ADT on canary → per-pax cancel PAX1 on onward
 * PENALTY + CANCEL — print/save full request & response
 *
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-book-rt-2adt-perpax-cancel.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildRoundTripSearchBody,
  buildIssueTicketPayload,
  buildPassengerProfile,
  analyzeFlightOptions,
  isTerminalBookingStatus,
  isSearchProgressComplete,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = 'reports/book-rt-2adt-corporate-perpax-cancel.json';
const Q = { ...FLIGHT_QUERY };
const GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

function brief(d, n = 700) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

function passengers(tag) {
  const pool = [
    { title: 'Mr', firstName: 'Arnav', lastName: 'Bhandari', gender: 'Male', dob: '1987-03-14' },
    { title: 'Mrs', firstName: 'Kiara', lastName: 'Bhandari', gender: 'Female', dob: '1991-11-22' },
  ];
  return pool.map((p, i) => {
    const prof = buildPassengerProfile({ ...p, lastName: `${p.lastName}${tag}` });
    return {
      paxId: `PAX${i + 1}`,
      type: 'adult',
      isLead: i === 0,
      profile: {
        title: prof.title,
        firstName: prof.firstName,
        lastName: prof.lastName,
        gender: prof.gender,
        dob: prof.dob,
        nationality: 'IN',
      },
      city: { cityCode: 'Pune', cityName: 'Pune' },
      passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
      ssr: { baggage: [], meals: [], seats: [] },
    };
  });
}

function altPassengers(tag, idx) {
  const sets = [
    [
      { title: 'Mr', firstName: 'Reyansh', lastName: 'Khurana', gender: 'Male', dob: '1986-05-09' },
      { title: 'Mrs', firstName: 'Saanvi', lastName: 'Khurana', gender: 'Female', dob: '1990-08-18' },
    ],
    [
      { title: 'Mr', firstName: 'Atharv', lastName: 'Grewal', gender: 'Male', dob: '1985-01-30' },
      { title: 'Mrs', firstName: 'Aadhya', lastName: 'Grewal', gender: 'Female', dob: '1989-07-12' },
    ],
    [
      { title: 'Mr', firstName: 'Shaurya', lastName: 'Bajaj', gender: 'Male', dob: '1988-09-03' },
      { title: 'Mrs', firstName: 'Anvi', lastName: 'Bajaj', gender: 'Female', dob: '1992-02-25' },
    ],
    [
      { title: 'Mr', firstName: 'Vivaan', lastName: 'Chawla', gender: 'Male', dob: '1984-11-17' },
      { title: 'Mrs', firstName: 'Pari', lastName: 'Chawla', gender: 'Female', dob: '1993-04-08' },
    ],
  ];
  const pool = sets[idx % sets.length];
  return pool.map((p, i) => {
    const prof = buildPassengerProfile({ ...p, lastName: `${p.lastName}${tag}` });
    return {
      paxId: `PAX${i + 1}`,
      type: 'adult',
      isLead: i === 0,
      profile: {
        title: prof.title,
        firstName: prof.firstName,
        lastName: prof.lastName,
        gender: prof.gender,
        dob: prof.dob,
        nationality: 'IN',
      },
      city: { cityCode: 'Pune', cityName: 'Pune' },
      passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
      ssr: { baggage: [], meals: [], seats: [] },
    };
  });
}

async function cancelCall(client, br, body) {
  return client.request({
    method: 'POST',
    path: `/v1/flights/booking/${br}/cancel`,
    query: Q,
    body: { retryCount: 2, ...body },
    correlation: true,
    partnerKey: client.partnerKey,
  });
}

async function waitConfirmOrBail(flight, br) {
  let last = null;
  for (let i = 0; i < 5; i += 1) {
    const st = await flight.getBookingStatus(br);
    last = String(st.data?.status || '');
    console.log('  status', i + 1, last);
    if (/confirm/i.test(last)) return { status: last, bail: false };
    if (/inprogress|in.?progress/i.test(last)) {
      console.log('  Inprogress — LEAVE');
      return { status: last, bail: true };
    }
    if (isTerminalBookingStatus(last) && !/pending/i.test(last)) {
      return { status: last, bail: !/confirm/i.test(last) };
    }
    await sleep(2000);
  }
  console.log('  still Pending — LEAVE');
  return { status: last, bail: true };
}

function pickNonStop(analysis) {
  return analysis.nonStop[0] || analysis.connecting[0] || null;
}

function stopsLabel(opt) {
  if (!opt) return null;
  if ((opt.segments || []).length > 1) return 'Connecting';
  if ((opt.legs || []).length > 1) return 'Connecting';
  return 'Direct';
}

async function bookCorporateRt(flight, client) {
  // Broader hunt: CORPORATE RT, fresh names, rotate airlines (empty = any)
  const attempts = [
    { o: 'DEL', d: 'BOM', od: 35, rd: 42, airline: null, nameIdx: 0 },
    { o: 'DEL', d: 'BOM', od: 38, rd: 45, airline: 'SG', nameIdx: 1 },
    { o: 'BOM', d: 'BLR', od: 41, rd: 48, airline: null, nameIdx: 2 },
    { o: 'DEL', d: 'HYD', od: 36, rd: 43, airline: '6E', nameIdx: 3 },
    { o: 'BLR', d: 'DEL', od: 39, rd: 46, airline: null, nameIdx: 0 },
    { o: 'HYD', d: 'BOM', od: 43, rd: 50, airline: '6E', nameIdx: 1 },
    { o: 'DEL', d: 'MAA', od: 47, rd: 54, airline: null, nameIdx: 2 },
    { o: 'BOM', d: 'DEL', od: 33, rd: 40, airline: '6E', nameIdx: 3 },
  ];
  const left = [];

  for (const r of attempts) {
      const airlineLabel = r.airline || 'ANY';
      console.log(`\nBOOK CORPORATE RT 2ADT ${airlineLabel} ${r.o}<->${r.d} +${r.od}/+${r.rd}`);
      const body = buildRoundTripSearchBody(r.od, r.rd, {
        origin: r.o,
        destination: r.d,
        fareType: 'CORPORATE',
        maxStops: null,
      });
      body.travellers = { adults: 2, children: 0, infants: 0 };
      body.preferences.airlines = r.airline ? [r.airline] : [];

      let onwardOpt = null;
      for (let i = 0; i < 12; i += 1) {
        const s = await flight.search(body);
        const onward = analyzeFlightOptions(s.data, 'ONWARD');
        // Prefer matching airline code when possible
        const pool = [...onward.nonStop, ...onward.connecting];
        onwardOpt = (r.airline
          ? pool.find((o) =>
            (o.legs || []).some((l) => String(l.flight || '').toUpperCase().startsWith(r.airline)))
          : null)
          || pickNonStop(onward);
        console.log(`  onward poll ${i + 1}`, s.data?.progress?.state, 'ns', onward.nonStopCount, 'pick', onwardOpt?.legs?.[0]?.flight);
        if (onwardOpt?.searchId || isSearchProgressComplete(s.data)) break;
        await sleep(s.data?.progress?.pollAfterMs || 2500);
      }
      if (!onwardOpt?.searchId) {
        console.log('  no onward');
        continue;
      }

      const refined = { ...body, selection: { selectedSearchIds: [onwardOpt.searchId] } };
      let returnOpt = null;
      for (let i = 0; i < 12; i += 1) {
        const s = await flight.search(refined);
        const ret = analyzeFlightOptions(s.data, 'RETURN');
        const pool = [...ret.nonStop, ...ret.connecting];
        returnOpt = (r.airline
          ? pool.find((o) =>
            (o.legs || []).some((l) => String(l.flight || '').toUpperCase().startsWith(r.airline)))
          : null)
          || pickNonStop(ret);
        console.log(`  return poll ${i + 1}`, s.data?.progress?.state, 'ns', ret.nonStopCount, 'pick', returnOpt?.legs?.[0]?.flight);
        if (returnOpt?.searchId || isSearchProgressComplete(s.data)) break;
        await sleep(s.data?.progress?.pollAfterMs || 2500);
      }
      if (!returnOpt?.searchId) {
        console.log('  no return');
        continue;
      }

      const searchIds = [onwardOpt.searchId, returnOpt.searchId];
      const pricing = await flight.getPricing(searchIds, 'ROUND_TRIP');
      if (!pricing.data?.priceId || !pricing.data?.bookingContext) {
        console.log('  pricing fail', brief(pricing.data, 220));
        continue;
      }
      console.log('  fare', pricing.data.pricing?.totalAmount, 'gst', pricing.data.addGstInfo);

      const tag = `${Date.now().toString(36).slice(-4)}${r.nameIdx}`;
      // Always use alt name sets (not prior Arnav/Kiara Bhandari)
      const pax = altPassengers(tag, r.nameIdx + Date.now() % 3);

      const payload = buildIssueTicketPayload({
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        searchIds,
        journeyType: 'ROUND_TRIP',
      });
      payload.data.passengers = pax;
      payload.data.includeGst = true;
      payload.data.addGstInfo = true;
      payload.data.gstDetails = { ...GST };

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
        console.log('  issue fail', brief(issue.data, 260));
        if (issue.data?.error?.code === 'INSUFFICIENT_BALANCE') {
          return { error: 'INSUFFICIENT_BALANCE', left };
        }
        continue;
      }

      const { status, bail } = await waitConfirmOrBail(flight, br);
      if (bail || !/confirm/i.test(status)) {
        left.push({ br, status, airline: r.airline });
        continue;
      }

      const detail = await flight.getBookingDetail(br);
      const itins = detail.data?.bookingResponse?.itinerary || [];
      const onward = itins.find((l) => /onward/i.test(l.direction)) || itins[0];
      const retLeg = itins.find((l) => /return/i.test(l.direction)) || itins[1];
      console.log('  =>', br, 'onward', onward?.pnr, 'return', retLeg?.pnr,
        'online', onward?.onlineCancellation, retLeg?.onlineCancellation);

      if (!onward?.pnr || !retLeg?.pnr) continue;

      return {
        br,
        status,
        fareType: 'CORPORATE',
        journeyType: 'ROUND_TRIP',
        route: `${r.o}-${r.d}-${r.o}`,
        requestedAirline: r.airline,
        totalAmount: pricing.data.pricing?.totalAmount,
        stops: {
          onward: stopsLabel(onwardOpt),
          return: stopsLabel(returnOpt),
        },
        passengers: pax.map((p) => ({
          paxId: p.paxId,
          name: `${p.profile.firstName} ${p.profile.lastName}`,
        })),
        onward: {
          pnr: onward.pnr,
          onlineCancellation: onward.onlineCancellation,
          airline: onward.segments?.[0]?.airlineCode || r.airline,
          flight: onwardOpt.legs?.[0]?.flight,
        },
        return: {
          pnr: retLeg.pnr,
          onlineCancellation: retLeg.onlineCancellation,
          airline: retLeg.segments?.[0]?.airlineCode || r.airline,
          flight: returnOpt.legs?.[0]?.flight,
        },
        left,
      };
  }
  return { error: 'NO_CONFIRMED_RT', left };
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('RT 2ADT CORPORATE per-pax cancel on', config.baseUrl);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const fixture = await bookCorporateRt(flight, client);
  if (!fixture?.br || fixture.error) {
    fs.writeFileSync(OUT, JSON.stringify({
      ranAt: new Date().toISOString(),
      baseUrl: config.baseUrl,
      ok: false,
      fixture,
    }, null, 2));
    console.error('Could not book Confirmed CORPORATE RT 2ADT', fixture);
    process.exit(1);
  }

  const cancelPnr = fixture.onward.pnr;
  const paxList = ['PAX1'];

  const penaltyReq = {
    retryCount: 2,
    action: 'PENALTY',
    pnr: cancelPnr,
    cancellationPaxList: paxList,
    cancellationReason: 'RT 2ADT CORPORATE per-pax PAX1',
  };
  const cancelReq = {
    retryCount: 2,
    action: 'CANCEL',
    pnr: cancelPnr,
    cancellationPaxList: paxList,
    cancellationReason: 'RT 2ADT CORPORATE per-pax PAX1',
  };

  console.log('\n=== PENALTY request ===');
  console.log(JSON.stringify(penaltyReq, null, 2));
  const pen = await cancelCall(client, fixture.br, {
    action: 'PENALTY',
    pnr: cancelPnr,
    cancellationPaxList: paxList,
    cancellationReason: penaltyReq.cancellationReason,
  });
  console.log('PENALTY HTTP', pen.status);
  console.log(JSON.stringify(pen.data, null, 2).slice(0, 2500));

  await sleep(1500);

  console.log('\n=== CANCEL request ===');
  console.log(JSON.stringify(cancelReq, null, 2));
  const can = await cancelCall(client, fixture.br, {
    action: 'CANCEL',
    pnr: cancelPnr,
    cancellationPaxList: paxList,
    cancellationReason: cancelReq.cancellationReason,
  });
  console.log('CANCEL HTTP', can.status);
  console.log(JSON.stringify(can.data, null, 2).slice(0, 2500));

  await sleep(1500);
  const after = await flight.getBookingStatus(fixture.br);
  const afterDetail = await flight.getBookingDetail(fixture.br);
  const itins = afterDetail.data?.bookingResponse?.itinerary || [];

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    ok: true,
    endpoint: 'POST /v1/flights/booking/{bookingReference}/cancel?lang=en&currency=INR',
    booking: {
      trip: 'RT',
      stops: fixture.stops,
      pax: '2 ADT',
      fareType: 'CORPORATE',
      route: fixture.route,
      br: fixture.br,
      passengers: fixture.passengers,
      totalAmount: fixture.totalAmount,
      onward: fixture.onward,
      return: fixture.return,
      afterStatus: after.data?.status,
      itineraryAfter: itins.map((x) => ({
        direction: x.direction,
        pnr: x.pnr,
        onlineCancellation: x.onlineCancellation,
      })),
    },
    perPaxCancel: {
      description: 'Cancel PAX1 only on onward PNR (return untouched)',
      penalty: { request: penaltyReq, http: pen.status, response: pen.data },
      cancel: { request: cancelReq, http: can.status, response: can.data },
    },
    left: fixture.left || [],
  };

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nSaved', OUT);
  console.log('After status', after.data?.status);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
