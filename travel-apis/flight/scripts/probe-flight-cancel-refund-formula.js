/**
 * Book 1 ADT OW with seat + meal + baggage (cancellable/refundable),
 * then verify cancel penalty formula:
 *
 *   TotalPenaltyAmount =
 *     RiyaPenaltyAmount +
 *     ConvenienceFee +
 *     CancellationFee (or ServiceFee) +
 *     FlexiCancelFee (only when Flexi Cancel booking)
 *
 *   BASE_URL=https://sigma-api.travelvip.ai node scripts/probe-flight-cancel-refund-formula.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';
import {
  buildOneWaySearchBody,
  buildPassengerProfile,
  canSelectSeats,
} from '../src/helpers.js';
import { config } from '../../../shared/config/env.js';

const FLIGHT_QUERY = { lang: 'en', currency: 'INR' };

function money(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function almostEqual(a, b) {
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) < 0.05;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseWeightKg(text) {
  const m = String(text || '').match(/(\d+)\s*KG/i);
  return m ? Number(m[1]) : null;
}

function deepFind(obj, pred, acc = [], depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 10) return acc;
  if (pred(obj)) acc.push(obj);
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') deepFind(v, pred, acc, depth + 1);
  }
  return acc;
}

function pickByKey(obj, re) {
  const hits = [];
  const walk = (o, depth = 0) => {
    if (!o || typeof o !== 'object' || depth > 10) return;
    for (const [k, v] of Object.entries(o)) {
      if (re.test(k) && (typeof v === 'number' || (typeof v === 'string' && v !== '' && !Number.isNaN(Number(v))))) {
        hits.push({ key: k, value: money(v), pathHint: k });
      }
      if (v && typeof v === 'object') walk(v, depth + 1);
    }
  };
  walk(obj);
  return hits;
}

function firstMoney(obj, patterns) {
  for (const re of patterns) {
    const hits = pickByKey(obj, re);
    if (hits.length) return hits[0];
  }
  return { key: null, value: null };
}

function pickMeal(ssr) {
  let best = null;
  for (const seg of ssr?.meal?.segments || []) {
    for (const m of seg.Meals || []) {
      const amt = money(m.pricing?.totalAmount);
      if (amt == null || amt <= 0 || !m.priceReference) continue;
      const c = {
        ...m,
        amount: amt,
        mealId: m.ssrId,
        origin: m.origin || seg.origin || seg.Origin || 'DEL',
        destination: m.destination || seg.destination || seg.Destination || 'BOM',
      };
      if (!best || amt < best.amount) best = c;
    }
  }
  return best;
}

function pickBag(ssr) {
  let best = null;
  for (const seg of ssr?.baggage?.segments || []) {
    for (const b of seg.Baggage || seg.Options || []) {
      const amt = money(b.pricing?.totalAmount);
      if (amt == null || amt <= 0 || !b.priceReference) continue;
      const c = {
        ...b,
        amount: amt,
        baggageId: b.ssrId,
        weight: b.weight || parseWeightKg(b.title) || parseWeightKg(b.code) || 3,
        origin: b.origin || seg.origin || seg.Origin || 'DEL',
        destination: b.destination || seg.destination || seg.Destination || 'BOM',
      };
      if (!best || amt < best.amount) best = c;
    }
  }
  return best;
}

function pickSeat(seatRes) {
  let best = null;
  for (const seg of (seatRes?.data?.data || seatRes?.data || {}).segments || []) {
    for (const s of seg.seatMap || []) {
      if (!/open/i.test(String(s.seatAvailability || ''))) continue;
      const amt = money(s.amount ?? s.price ?? s.priceDetail?.finalPrice);
      if (!(amt > 0) || !s.seatName) continue;
      const c = {
        ...s,
        amount: amt,
        seatName: s.seatName,
        segmentId: s.segmentId || seg.segmentId || 'SEG_1',
        origin: s.origin || seg.origin,
        destination: s.destination || seg.destination,
      };
      if (!best || amt < best.amount) best = c;
    }
  }
  return best;
}

function mealSsr(m) {
  return {
    mealId: String(m.mealId || m.ssrId),
    ssrId: String(m.ssrId || m.mealId),
    code: m.code,
    title: m.title,
    description: m.description || m.title,
    segmentId: m.segmentId || 'SEG_1',
    direction: m.direction || 'ONWARD',
    paxType: 'ADT',
    quantity: 1,
    priceReference: m.priceReference,
    amount: m.amount,
    origin: m.origin,
    destination: m.destination,
  };
}

function bagSsr(b) {
  return {
    baggageId: String(b.baggageId || b.ssrId),
    ssrId: String(b.ssrId || b.baggageId),
    code: b.code,
    title: b.title,
    description: b.description || b.title,
    segmentId: b.segmentId || 'SEG_1',
    direction: b.direction || 'ONWARD',
    paxType: 'ADT',
    quantity: 1,
    priceReference: b.priceReference,
    amount: b.amount,
    weight: b.weight,
    origin: b.origin,
    destination: b.destination,
  };
}

function seatSsr(s) {
  return {
    segmentId: s.segmentId,
    seatName: s.seatName,
    seatNumber: s.seatName,
    seatId: s.seatId || s.seatKey,
    seatAvailability: s.seatAvailability || 'Open',
    code: s.seatName,
    amount: s.amount,
    price: s.amount,
    priceReference: s.priceDetail?.priceReference || s.priceReference,
    itinRef: s.itinRef,
    seatGroup: s.seatGroup,
    seatKey: s.seatKey || s.seatId,
    seatRef: s.seatRef,
    seatType: s.seatType,
    direction: s.direction || 'ONWARD',
    paxType: 'ADT',
    description: `Seat ${s.seatName}`,
    origin: s.origin,
    destination: s.destination,
  };
}

function analyzePenalty(penaltyData, bookingDetail) {
  const isFlexi =
    Number(bookingDetail?.data?.bookingResponse?.summary?.isFlexiCancel) === 1
    || /flexi/i.test(JSON.stringify(bookingDetail?.data?.bookingResponse?.summary || {}));

  const total = firstMoney(penaltyData, [
    /^totalPenaltyAmount$/i,
    /^totalPenalityAmount$/i,
    /totalPenalty/i,
    /totalPenality/i,
  ]);
  const riya = firstMoney(penaltyData, [
    /^riyaPenaltyAmount$/i,
    /riyaPenalty/i,
    /riyaPenality/i,
    /^penalityAmount$/i,
    /^penaltyAmount$/i,
  ]);
  const convenience = firstMoney(penaltyData, [
    /^convenienceFee$/i,
    /convenience/i,
  ]);
  const cancellation = firstMoney(penaltyData, [
    /^cancellationFee$/i,
    /^serviceFee$/i,
    /cancellationFee/i,
    /serviceFee/i,
  ]);
  const flexi = firstMoney(penaltyData, [
    /^flexiCancelFee$/i,
    /flexiCancel/i,
    /flexiFee/i,
  ]);

  const charges = penaltyData?.cancellationCharges || {};
  // Prefer explicit cancellationCharges when present
  const riyaAmt = riya.value
    ?? money(penaltyData?.data?.items?.[0]?.penalty?.penalityAmount
      ?? penaltyData?.data?.items?.[0]?.penalty?.penaltyAmount)
    ?? 0;
  const convenienceAmt = convenience.value ?? money(charges.convenienceFee) ?? 0;
  const cancelOrServiceAmt =
    cancellation.value
    ?? money(charges.cancellationFee)
    ?? money(charges.serviceFee)
    ?? 0;
  const flexiAmt = isFlexi
    ? (flexi.value ?? money(charges.flexiCancelFee) ?? 0)
    : 0;

  const computed = money(riyaAmt + convenienceAmt + cancelOrServiceAmt + flexiAmt);
  const reportedTotal =
    total.value
    ?? money(penaltyData?.data?.totalPenalityAmount)
    ?? money(penaltyData?.data?.totalPenaltyAmount)
    ?? money(charges.totalDeduction);

  const refundAmount = money(charges.refundAmount);
  const bookingAmount =
    money(penaltyData?.data?.totalBookingAmount)
    ?? money(bookingDetail?.data?.bookingResponse?.salesSummary?.totalAmount);

  return {
    isFlexiCancelBooking: isFlexi,
    components: {
      riyaPenaltyAmount: { sourceKey: riya.key, value: riyaAmt },
      convenienceFee: { sourceKey: convenience.key || 'convenienceFee', value: convenienceAmt },
      cancellationOrServiceFee: {
        sourceKey: cancellation.key || 'cancellationFee/serviceFee',
        value: cancelOrServiceAmt,
      },
      flexiCancelFee: {
        included: isFlexi,
        sourceKey: flexi.key || 'flexiCancelFee',
        value: flexiAmt,
      },
    },
    formula: 'TotalPenaltyAmount = RiyaPenaltyAmount + ConvenienceFee + CancellationFee|ServiceFee + FlexiCancelFee(if flexi)',
    computedTotalPenalty: computed,
    reportedTotalPenalty: reportedTotal,
    formulaMatch: almostEqual(computed, reportedTotal),
    bookingAmount,
    refundAmount,
    refundCheck:
      bookingAmount != null && reportedTotal != null && refundAmount != null
        ? {
            expectedRefund: money(bookingAmount - reportedTotal),
            apiRefund: refundAmount,
            match: almostEqual(money(bookingAmount - reportedTotal), refundAmount),
          }
        : null,
    rawKeysSample: Object.keys(penaltyData || {}),
    cancellationCharges: charges || null,
    penaltyDataBlock: penaltyData?.data || null,
  };
}

async function cancelRequest(client, br, action, accessToken) {
  return client.request({
    method: 'POST',
    path: `/v1/flights/booking/${br}/cancel`,
    query: FLIGHT_QUERY,
    body: { action, retryCount: 2 },
    correlation: true,
    partnerKey: accessToken,
  });
}

async function main() {
  console.log('Base URL:', config.baseUrl);
  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const flight = new FlightService(session.client);

  // Prefer refundable + seats capable; try SG then IX then any
  const airlinePrefs = [['SG'], ['IX'], ['6E'], []];
  let chosen = null;
  let lastErr = null;

  for (const airlines of airlinePrefs) {
    const body = buildOneWaySearchBody(65, {
      origin: 'DEL',
      destination: 'BOM',
      fareType: 'NORMAL',
      maxStops: 0,
    });
    body.travellers = { adults: 1, children: 0, infants: 0 };
    body.preferences.airlines = airlines;
    console.log('\nSearch airlines=', airlines.length ? airlines : 'ANY');
    const search = await flight.searchUntilComplete(body);
    const ids = search.searchIds?.length ? search.searchIds : [search.searchId];

    for (const sid of ids.slice(0, 8)) {
      const pricing = await flight.getPricing([sid], 'ONE_WAY');
      if (!pricing.ok) {
        lastErr = `pricing fail ${JSON.stringify(pricing.data).slice(0, 120)}`;
        continue;
      }
      const refundable = Boolean(
        pricing.data?.itinerary?.[0]?.refundable
        ?? pricing.data?.selection?.selectedFlights?.[0]?.refundable,
      );
      // soft preference for refundable
      const ssr = await flight.getSsr(pricing.data.priceId);
      if (!ssr.ok) continue;
      const meal = pickMeal(ssr.data);
      const bag = pickBag(ssr.data);
      if (!meal || !bag) {
        lastErr = 'no paid meal/bag';
        continue;
      }
      let seat = null;
      if (canSelectSeats(pricing.data)) {
        const seatRes = await flight.getSeatMap(pricing.data.bookingContext, [
          { paxRefNumber: '1', passengerType: 1, gender: 'Male', title: 'Mr', firstName: 'Rohan', lastName: 'Adult' },
        ]);
        if (seatRes.ok) seat = pickSeat(seatRes);
      }
      chosen = {
        sid,
        pricing,
        meal,
        bag,
        seat,
        refundable,
        fareTotal: money(pricing.data?.pricing?.totalAmount ?? pricing.data?.totalAmount),
      };
      console.log('candidate', {
        priceId: pricing.data.priceId,
        refundable,
        meal: meal.amount,
        bag: bag.amount,
        seat: seat?.amount,
        fare: chosen.fareTotal,
      });
      if (meal && bag && seat) break;
    }
    if (chosen?.meal && chosen?.bag && chosen?.seat) break;
  }

  if (!chosen) throw new Error(lastErr || 'No bookable option with meal+baggage(+seat)');

  const { pricing, meal, bag, seat, sid, fareTotal } = chosen;
  const adult = buildPassengerProfile({
    title: 'Mr', firstName: 'Rohan', lastName: 'CancelTest', gender: 'Male', dob: '1995-05-15',
  });

  const issueBody = {
    type: 'ticket',
    currency: 'INR',
    language: 'en',
    bookingReference: pricing.data.bookingContext,
    searchIds: [sid],
    journeyType: 'ONE_WAY',
    timezone: 'Asia/Calcutta',
    data: {
      priceId: pricing.data.priceId,
      passportType: 'NONE',
      includeGst: false,
      gstDetails: null,
      contact: {
        email: config.flight.contactEmail || 'rohan@travelvip.ai',
        mobile: config.flight.contactMobile || '9876543210',
        countryCode: config.flight.contactCountryCode || '+91',
      },
      passengers: [{
        paxId: 'PAX1',
        type: 'adult',
        isLead: true,
        profile: {
          title: adult.title,
          firstName: adult.firstName,
          lastName: adult.lastName,
          gender: adult.gender,
          dob: adult.dob,
          nationality: 'IN',
        },
        city: { cityCode: 'Pune', cityName: 'Pune' },
        passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
        ssr: {
          meals: [mealSsr(meal)],
          baggage: [bagSsr(bag)],
          seats: seat ? [seatSsr(seat)] : [],
        },
      }],
    },
  };

  const issue = await session.client.request({
    method: 'POST',
    path: '/v1/flights/booking/issue-ticket',
    query: { ...config.flight.issueTicketQuery, ...FLIGHT_QUERY, count: 10, page: 0, perpage: 20 },
    body: issueBody,
    correlation: true,
    partnerKey: session.accessToken,
  });

  const br = issue.data?.bookingReference;
  console.log('issue', issue.status, issue.data?.message || issue.data?.error, 'BR=', br);
  if (!issue.ok || !br) throw new Error(`issue failed: ${JSON.stringify(issue.data).slice(0, 400)}`);

  let status = issue.data?.status;
  for (let i = 0; i < 36; i += 1) {
    const st = await flight.getBookingStatus(br);
    status = st.data?.status || status;
    console.log(`poll ${i + 1}:`, status);
    if (/confirm|fail|cancel/i.test(String(status))) break;
    await sleep(5000);
  }

  const detail = await flight.getBookingDetail(br);
  const sales = detail.data?.bookingResponse?.salesSummary || {};
  const itinerary = detail.data?.bookingResponse?.itinerary || [];
  const onlineCancellation = detail.data?.bookingResponse?.onlineCancellation;
  const isFlexi = detail.data?.bookingResponse?.summary?.isFlexiCancel;

  console.log('booking', {
    status: detail.data?.status,
    onlineCancellation,
    isFlexiCancel: isFlexi,
    refundable: itinerary[0]?.refundable,
    pnr: itinerary[0]?.pnr,
    flight: itinerary[0]?.segments?.[0]?.flightNumber,
    sales,
  });

  if (!/confirm/i.test(String(detail.data?.status))) {
    throw new Error(`Booking not confirmed: ${detail.data?.status}`);
  }

  // PENALTY
  const penalty = await cancelRequest(session.client, br, 'PENALTY', session.accessToken);
  console.log('PENALTY http', penalty.status, 'requestStatus', penalty.data?.requestStatus);
  const analysis = analyzePenalty(penalty.data, detail);
  console.log('formula analysis', JSON.stringify(analysis, null, 2));

  // Attempt cancel after penalty
  let cancel = await cancelRequest(session.client, br, 'CANCEL', session.accessToken);
  console.log('CANCEL', cancel.status, cancel.data?.requestStatus, cancel.data?.errors?.[0]?.error || cancel.data?.data?.items?.[0]?.cancel);

  if (!/cancel/i.test(String((await flight.getBookingStatus(br)).data?.status))) {
    cancel = await cancelRequest(session.client, br, 'PENALTY_AND_CANCEL', session.accessToken);
    console.log('PENALTY_AND_CANCEL', cancel.status, cancel.data?.requestStatus, cancel.data?.errors?.[0]?.error || cancel.data?.data?.items?.[0]?.cancel);
  }

  let finalStatus = detail.data?.status;
  for (let i = 0; i < 12; i += 1) {
    const st = await flight.getBookingStatus(br);
    finalStatus = st.data?.status;
    console.log(`cancel-poll ${i + 1}:`, finalStatus);
    if (/cancel|fail/i.test(String(finalStatus))) break;
    await sleep(5000);
  }

  const report = {
    ranAt: new Date().toISOString(),
    environment: config.baseUrl,
    booking: {
      br,
      statusBeforeCancel: detail.data?.status,
      statusAfterCancel: finalStatus,
      onlineCancellation,
      isFlexiCancel: isFlexi,
      refundable: itinerary[0]?.refundable,
      pnr: itinerary[0]?.pnr,
      flight: itinerary[0]?.segments?.[0]?.flightNumber,
      airline: itinerary[0]?.segments?.[0]?.airline?.code,
      salesSummary: sales,
    },
    selectedAddons: {
      meal: { title: meal.title, amount: meal.amount },
      baggage: { title: bag.title, amount: bag.amount, weight: bag.weight },
      seat: seat ? { seatName: seat.seatName, amount: seat.amount } : null,
      fareTotal,
      expectedPaid:
        fareTotal != null
          ? money(fareTotal + meal.amount + bag.amount + (seat?.amount || 0))
          : null,
    },
    issueTicket: {
      requestPayload: {
        ...issueBody,
        bookingReference: `[bookingContext truncated len=${String(issueBody.bookingReference || '').length}]`,
      },
      requestPayloadFullSaved: true,
      response: issue.data,
      http: issue.status,
    },
    penalty: {
      http: penalty.status,
      requestStatus: penalty.data?.requestStatus,
      errors: penalty.data?.errors || null,
      analysis,
      raw: penalty.data,
    },
    cancel: {
      http: cancel.status,
      requestStatus: cancel.data?.requestStatus,
      errors: cancel.data?.errors || null,
      data: cancel.data?.data || null,
      cancellationCharges: cancel.data?.cancellationCharges || null,
      raw: cancel.data,
      rawSnippet: JSON.stringify(cancel.data || {}).slice(0, 2000),
    },
    verdict: {
      bookedWithSeatMealBag: true,
      confirmed: /confirm/i.test(String(detail.data?.status)),
      penaltyFormulaMatch: analysis.formulaMatch,
      cancelled: /cancel/i.test(String(finalStatus)),
      refundMathMatch: analysis.refundCheck?.match ?? null,
    },
  };

  const host = String(config.baseUrl || '').includes('staging') ? 'staging' : (String(config.baseUrl || '').includes('sigma') ? 'sigma' : 'env');
  const dir = path.join('reports', 'flight');
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, `cancel-refund-formula-${host}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(dir, 'cancel-refund-formula.json'), JSON.stringify(report, null, 2));
  if (br) {
    fs.writeFileSync(
      path.join(dir, `${br}-issue-payload-full.json`),
      JSON.stringify(issueBody, null, 2),
    );
    fs.writeFileSync(
      path.join(dir, `${br}-cancel-response.json`),
      JSON.stringify(cancel.data || {}, null, 2),
    );
    fs.writeFileSync(
      path.join(dir, `${br}-penalty-response.json`),
      JSON.stringify(penalty.data || {}, null, 2),
    );
  }

  console.log('\n========== VERDICT ==========');
  console.log(JSON.stringify(report.verdict, null, 2));
  console.log('BR=', br, 'finalStatus=', finalStatus);
  console.log('TotalPenalty reported=', analysis.reportedTotalPenalty, 'computed=', analysis.computedTotalPenalty, 'match=', analysis.formulaMatch);
  console.log('Fare without SSR=', fareTotal, '| Paid with SSR=', sales.totalAmount);
  console.log('wrote', outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
