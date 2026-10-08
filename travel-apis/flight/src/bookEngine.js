import fs from 'fs';
import path from 'path';
import { config } from '../../../shared/config/env.js';
import {
  FLIGHT_QUERY,
  buildIssueTicketPayload,
  buildOneWaySearchBody,
  buildRoundTripSearchBody,
  isTerminalBookingStatus,
} from './helpers.js';
import { buildPassengers, uniqueTag } from './passengerBuilder.js';
import {
  isInternationalRoute,
  pollRoundTripSearch,
  pollSearchUntilOptions,
} from './searchPicker.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

function brief(data, n = 280) {
  try { return JSON.stringify(data).slice(0, n); } catch { return String(data); }
}

function pricingTotal(data) {
  const keys = [
    data?.totalAmount,
    data?.pricing?.totalAmount,
    data?.price?.totalAmount,
    data?.fare?.totalAmount,
  ];
  for (const k of keys) {
    const n = Number(k);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

async function waitConfirmOrBail(flight, br, { retryOnInprogress = true } = {}) {
  let last = null;
  for (let i = 0; i < 8; i += 1) {
    const st = await flight.getBookingStatus(br);
    last = String(st.data?.status || '');
    console.log('  status', i + 1, last);
    if (/confirm/i.test(last)) return { status: last, bail: false };
    if (retryOnInprogress && /inprogress|in.?progress/i.test(last)) {
      console.log('  Inprogress — leave BR, retry with new names');
      return { status: last, bail: true };
    }
    if (isTerminalBookingStatus(last) && !/pending/i.test(last)) {
      return { status: last, bail: !/confirm/i.test(last) };
    }
    if (retryOnInprogress && /pending/i.test(last) && i >= 4) {
      console.log('  Pending stuck — leave BR, retry');
      return { status: last, bail: true };
    }
    await sleep(2500);
  }
  return { status: last, bail: true };
}

function buildSearchBody(opts, onwardDay, returnDay) {
  const travellers = {
    adults: opts.adults,
    children: opts.children,
    infants: opts.infants,
  };
  const searchOpts = {
    origin: opts.origin,
    destination: opts.destination,
    maxStops: opts.maxStops,
    fareType: opts.fareType,
  };

  if (opts.journey === 'ROUND_TRIP' || opts.journey === 'RT') {
    const body = buildRoundTripSearchBody(onwardDay, returnDay, searchOpts);
    body.travellers = travellers;
    if (opts.airlines?.length) {
      body.preferences = { ...body.preferences, airlines: opts.airlines };
    }
    return body;
  }

  const body = buildOneWaySearchBody(onwardDay, searchOpts);
  body.travellers = travellers;
  if (opts.airlines?.length) {
    body.preferences = { ...body.preferences, airlines: opts.airlines, maxStops: opts.maxStops };
  }
  return body;
}

function applyGst(payload, pricingData) {
  if (pricingData?.addGstInfo === true) {
    payload.data.includeGst = true;
    payload.data.addGstInfo = true;
    payload.data.gstDetails = { ...GST };
  } else {
    payload.data.includeGst = false;
    payload.data.addGstInfo = false;
    payload.data.gstDetails = null;
  }
}

async function issueTicketV2(client, payload) {
  return client.request({
    method: 'POST',
    path: '/api/v2/flights/booking/issue-ticket',
    query: { ...FLIGHT_QUERY, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 },
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
  });
}

async function runAfterSteps(flight, client, br, after = []) {
  const out = {};
  const steps = after.map((s) => String(s).toLowerCase());

  if (steps.includes('detail')) {
    out.detail = await flight.getBookingDetail(br);
  }

  if (steps.includes('penalty')) {
    const detail = out.detail || await flight.getBookingDetail(br);
    const leg = detail.data?.bookingResponse?.itinerary?.[0] || {};
    const pnr = leg.pnr;
    const penReq = { action: 'PENALTY', ...(pnr ? { pnr } : {}) };
    out.penaltyRequest = penReq;
    out.penalty = await client.request({
      method: 'POST',
      path: `/v1/flights/booking/${br}/cancel`,
      query: { ...FLIGHT_QUERY },
      body: penReq,
      correlation: true,
      partnerKey: client.partnerKey,
    });
  }

  if (steps.includes('cancel')) {
    const detail = out.detail || await flight.getBookingDetail(br);
    const leg = detail.data?.bookingResponse?.itinerary?.[0] || {};
    const pnr = leg.pnr;
    const canReq = {
      action: 'CANCEL',
      ...(pnr ? { pnr } : {}),
      cancellationReason: 'CLI automation cancel',
      remarks: 'requested by partner',
    };
    out.cancelRequest = canReq;
    out.cancel = await client.request({
      method: 'POST',
      path: `/v1/flights/booking/${br}/cancel`,
      query: { ...FLIGHT_QUERY },
      body: canReq,
      correlation: true,
      partnerKey: client.partnerKey,
    });
  }

  return out;
}

function summarizeBooking(br, status, pricingData, detailData, opts, pickMeta) {
  const brsp = detailData?.bookingResponse || {};
  const leg = (brsp.itinerary || [])[0] || {};
  return {
    br,
    status,
    journey: opts.journey,
    route: `${opts.origin}-${opts.destination}${opts.journey === 'RT' || opts.journey === 'ROUND_TRIP' ? `-${opts.origin}` : ''}`,
    adults: opts.adults,
    children: opts.children,
    infants: opts.infants,
    fareType: opts.fareType,
    flexi: opts.flexi,
    airline: opts.airlines?.join(',') || 'any',
    flight: pickMeta?.label || leg.segments?.map((s) => `${s.airlineCode || s.airline?.code} ${s.flightNumber}`).join(' / '),
    pnr: leg.pnr,
    onlineCancellation: leg.onlineCancellation,
    totalAmount: brsp.salesSummary?.totalAmount || pricingTotal(pricingData),
    userId: brsp.userId,
    passengers: (brsp.passengers || []).map((p) => `${p.firstName || p.profile?.firstName} ${p.lastName || p.profile?.lastName}`),
  };
}

/**
 * Book a flight for any scenario (OW/RT, any pax mix, airline, fare, flexi, etc.).
 */
export async function bookFlight(flight, client, opts) {
  if (!opts.origin || !opts.destination) {
    throw new Error('origin and destination are required (--origin / --dest)');
  }

  const journeyType = (opts.journey === 'RT' || opts.journey === 'ROUND_TRIP') ? 'ROUND_TRIP' : 'ONE_WAY';
  const filters = {
    airlines: opts.airlines,
    maxStops: opts.maxStops,
    flexi: opts.flexi,
    fareType: opts.fareType,
    flightNumber: opts.flightNumber,
    excludeFlightNumber: opts.excludeFlightNumber,
  };
  const withPassport = opts.passport === true
    || (opts.passport !== false && isInternationalRoute(opts.origin, opts.destination));

  const left = [];
  let booked = null;
  let nameIndex = 0;

  console.log(`\n=== Flight book ${opts.origin}→${opts.destination} ${journeyType}`);
  console.log(`    pax=${opts.adults}A/${opts.children}C/${opts.infants}I fare=${opts.fareType}${opts.flexi ? '+flexi' : ''} airline=${opts.airlines?.join(',') || 'any'}`);

  for (const onwardDay of opts.daysFromNow) {
    const returnDay = onwardDay + (opts.returnOffsetDays || 7);
    console.log(`\n--- attempt d+${onwardDay}${journeyType === 'ROUND_TRIP' ? ` / return d+${returnDay}` : ''}`);

    const body = buildSearchBody({ ...opts, journey: journeyType === 'ROUND_TRIP' ? 'RT' : 'OW' }, onwardDay, returnDay);

    if (journeyType === 'ROUND_TRIP') {
      const { pairs } = await pollRoundTripSearch(flight, body, filters);
      if (!pairs.length) {
        console.log('  no RT pair found');
        continue;
      }

      for (const pair of pairs.slice(0, 8)) {
        const pricing = await flight.getPricing(pair.searchIds, 'ROUND_TRIP');
        if (!pricing.data?.priceId || !pricing.data?.bookingContext) {
          console.log('  RT pricing fail', brief(pricing.data));
          continue;
        }

        const total = pricingTotal(pricing.data);
        console.log('  RT priced', total, '|', pair.onward.label, '+', pair.ret.label);
        if (opts.maxFare && total && total > opts.maxFare) {
          console.log(`  skip — fare ${total} > max ${opts.maxFare}`);
          continue;
        }

        const passengers = buildPassengers({
          adults: opts.adults,
          children: opts.children,
          infants: opts.infants,
          uniqueNames: opts.uniqueNames,
          leadFirstName: opts.leadFirstName,
          leadLastName: opts.leadLastName,
          nameIndex,
          withPassport,
        });
        nameIndex += 1;

        const payload = buildIssueTicketPayload({
          bookingContext: pricing.data.bookingContext,
          priceId: pricing.data.priceId,
          searchIds: pair.searchIds,
          journeyType: 'ROUND_TRIP',
        });
        payload.data.passengers = passengers;
        payload.data.passportType = withPassport
          ? (pricing.data.passportType || 'REGULAR')
          : (pricing.data.passportType || 'NONE');
        applyGst(payload, pricing.data);

        const issue = await issueTicketV2(client, payload);
        const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
        if (!br) {
          console.log('  issue fail', brief(issue.data));
          if (issue.data?.error?.code === 'INSUFFICIENT_BALANCE') break;
          continue;
        }

        const { status, bail } = await waitConfirmOrBail(flight, br, { retryOnInprogress: opts.retryOnInprogress });
        if (bail || !/confirm/i.test(status)) {
          left.push({ br, status, day: onwardDay, pair: `${pair.onward.label} + ${pair.ret.label}` });
          if (opts.retryOnInprogress) continue;
          break;
        }

        const detail = await flight.getBookingDetail(br);
        booked = summarizeBooking(br, status, pricing.data, detail.data, opts, {
          label: `${pair.onward.label} | ${pair.ret.label}`,
        });
        break;
      }
    } else {
      const { picks } = await pollSearchUntilOptions(flight, body, filters);
      if (!picks.length) {
        console.log('  no matching flight');
        continue;
      }

      for (const pick of picks.slice(0, 8)) {
        console.log('  pick', pick.label, 'stops', pick.stops, 'searchId', pick.searchId);

        const pricing = await flight.getPricing([pick.searchId], 'ONE_WAY');
        if (!pricing.data?.priceId || !pricing.data?.bookingContext) {
          console.log('  pricing fail', brief(pricing.data));
          continue;
        }

        const total = pricingTotal(pricing.data);
        console.log('  priced', total, 'addGst', pricing.data?.addGstInfo);
        if (opts.maxFare && total && total > opts.maxFare) {
          console.log(`  skip — fare ${total} > max ${opts.maxFare}`);
          continue;
        }

        const passengers = buildPassengers({
          adults: opts.adults,
          children: opts.children,
          infants: opts.infants,
          uniqueNames: opts.uniqueNames,
          leadFirstName: opts.leadFirstName,
          leadLastName: opts.leadLastName,
          nameIndex,
          withPassport,
        });
        nameIndex += 1;

        const payload = buildIssueTicketPayload({
          bookingContext: pricing.data.bookingContext,
          priceId: pricing.data.priceId,
          searchIds: [pick.searchId],
          journeyType: 'ONE_WAY',
          passengerProfile: passengers[0]?.profile,
        });
        payload.data.passengers = passengers;
        payload.data.passportType = withPassport
          ? (pricing.data.passportType || 'REGULAR')
          : (pricing.data.passportType || 'NONE');
        applyGst(payload, pricing.data);

        const issue = await issueTicketV2(client, payload);
        const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
        if (!br) {
          console.log('  issue fail', brief(issue.data));
          if (issue.data?.error?.code === 'INSUFFICIENT_BALANCE') break;
          continue;
        }

        const { status, bail } = await waitConfirmOrBail(flight, br, { retryOnInprogress: opts.retryOnInprogress });
        if (bail || !/confirm/i.test(status)) {
          left.push({
            br,
            status,
            day: onwardDay,
            flight: pick.label,
            passengers: passengers.map((p) => `${p.profile.firstName} ${p.profile.lastName}`),
          });
          if (opts.retryOnInprogress) continue;
          break;
        }

        const detail = await flight.getBookingDetail(br);
        booked = summarizeBooking(br, status, pricing.data, detail.data, opts, pick);
        break;
      }
    }

    if (booked?.br) break;
  }

  let afterResults = null;
  if (booked?.br && opts.after?.length) {
    console.log('\n--- after steps:', opts.after.join(', '));
    afterResults = await runAfterSteps(flight, client, booked.br, opts.after);
  }

  const slug = [
    opts.airlines?.[0] || 'any',
    opts.origin,
    opts.destination,
    `${opts.adults}a${opts.children}c${opts.infants}i`,
    journeyType === 'ROUND_TRIP' ? 'rt' : 'ow',
  ].join('-').toLowerCase();

  const reportPath = opts.out || path.join('reports', `cli-book-${slug}-${Date.now()}.json`);
  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: process.env.BASE_URL || config.baseUrl,
    scenario: opts.name || null,
    options: {
      ...opts,
      journey: journeyType,
      passport: withPassport,
    },
    ok: Boolean(booked?.br),
    booked,
    left,
    after: afterResults,
  };

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log('\n=== RESULT ===');
  console.log(JSON.stringify(booked || { error: 'no confirmed booking', left }, null, 2));
  console.log('\nReport:', reportPath);

  return { ok: Boolean(booked?.br), booked, left, report, reportPath };
}

export { uniqueTag };
