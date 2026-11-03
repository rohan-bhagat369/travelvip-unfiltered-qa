/**
 * Schema/trigger check for RT partial-cancel webhook on BR1791300463267996
 * vs flights-and-wallet-webhooks.pdf (v1 / build V3).
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();
import { authenticate } from '../../../shared/lib/authService.js';
import { TravelVipClient } from '../../../shared/lib/TravelVipClient.js';
import { config } from '../../../shared/config/env.js';

const BR = 'BR1791300463267996';
const rows = [];
const add = (rule, status, note) => rows.push({ rule, status, note });

// Payload excerpt from partner webhook (booking.cancelled @ 2026-10-13T14:31:49Z)
const p = {
  version: 1,
  event: 'booking.cancelled',
  timestamp: '2026-10-13T14:31:49Z',
  type: 'flight',
  data: {
    status: 'Cancelled',
    reason: null,
    bookingReference: BR,
    cancellationRequest: {
      id: 840,
      status: 'Cancellation Successful',
      mode: 'OFFLINE',
      scope: { type: 'PASSENGER_LEG', legIds: [1549], paxIds: ['PAX1'] },
      estimatedCancellationCharge: 2128.59,
      estimatedRefund: 119.63,
      ssrAmount: 2125.71,
      createdAt: '2026-10-13T14:27:39Z',
      pnr: 'J93QYH',
    },
    transaction: [{
      id: '5168', amount: 4496.44, currency: 'USD', paymentMethod: 'wallet',
      createdAt: '2026-10-06T15:27:45Z', completedAt: '2026-10-06T15:27:45Z',
      type: 'debit', status: 'success',
    }],
    bookingDetails: {
      serviceDetails: {
        journeyType: 'ROUND_TRIP',
        pnrCount: 1,
        pnrGroups: [{ pnr: 'J93QYH', legIds: [1549, 1550] }],
        itineraryMeta: {
          onward: { legId: 1549, sharesPnrWith: [1550], totalStops: 1, isCancellable: false },
          return: { legId: 1550, sharesPnrWith: [1549], totalStops: 1, isCancellable: false },
          airlineNull: true,
          durationMinutesZero: true,
          baggageNull: true,
        },
      },
      saleSummary: {
        baseFare: 103.73,
        convenienceFee: 3.66,
        taxes: 79.32,
        baggageAmount: 116.63,
        mealAmount: 17.5,
        seatAmount: 4175.6,
        grossAmount: 4496.44,
        discountAmount: 0,
        totalAmount: 4496.44,
        currency: 'USD',
        appliedOffer: null,
        refund: {
          // id missing
          cancellationRequestId: 840,
          amount: 0,
          destinationType: null,
          cancellationCharge: 2575.71,
          cancellationChargeBreakup: {
            airlineCancellationFee: 0,
            convenienceFee: 350,
            serviceFee: 100,
            flexicancelFee: 0,
          },
          scope: { type: 'PASSENGER_LEG', legIds: [1549], paxIds: ['PAX1'] },
        },
      },
      passengers: [{
        paxId: 'PAX1',
        legs: [{ legId: 1549, pnr: 'J93QYH', eticket: '', status: 'Cancelled' }],
        addons: {
          baggageDirection: 'COMBINED',
          seatSegmentId: null,
          mealSegmentId: 'SEG_1',
        },
      }],
      passengerCountInPayload: 1,
      knownBookingWas2Adt: true,
    },
  },
};

const d = p.data;
const cr = d.cancellationRequest;
const ss = d.bookingDetails.saleSummary;
const refund = ss.refund;
const breakup = refund.cancellationChargeBreakup;

// --- Event / trigger rules from PDF ---
add('envelope version/event/type', p.version === 1 && p.type === 'flight' ? 'PASS' : 'BUG', `${p.version}/${p.event}/${p.type}`);
add('DOC: PASSENGER_LEG scope → event should be booking.partially_cancelled', p.event === 'booking.partially_cancelled' ? 'PASS' : 'BUG', `got ${p.event}`);
add('DOC: partially_cancelled → data.status Confirmed (booking stays live)', d.status === 'Confirmed' ? 'PASS' : 'BUG', `got ${d.status}`);
add('DOC: booking.cancelled requires scope.type FULL', cr.scope.type === 'FULL' ? 'PASS' : 'BUG', `got ${cr.scope.type}`);
add('cancellationRequest.status Cancellation Successful', cr.status === 'Cancellation Successful' ? 'PASS' : 'BUG', cr.status);
add('cancellationRequest.mode OFFLINE|ONLINE', cr.mode === 'OFFLINE' || cr.mode === 'ONLINE' ? 'PASS' : 'BUG', cr.mode);
add('scope mirrors refund.scope', JSON.stringify(cr.scope) === JSON.stringify(refund.scope) ? 'PASS' : 'BUG', JSON.stringify(refund.scope));
add('journeyType ROUND_TRIP', d.bookingDetails.serviceDetails.journeyType === 'ROUND_TRIP' ? 'PASS' : 'BUG', d.bookingDetails.serviceDetails.journeyType);
add('pnrGroups covers both legs', d.bookingDetails.serviceDetails.pnrGroups[0].legIds.join(',') === '1549,1550' ? 'PASS' : 'BUG', JSON.stringify(d.bookingDetails.serviceDetails.pnrGroups));
add('sharesPnrWith cross-links 1549↔1550', 'PASS', 'observed in full payload');

// --- Money / reconcile ---
add('saleSummary total = gross - discount', Math.abs((ss.grossAmount - ss.discountAmount) - ss.totalAmount) < 0.05 ? 'PASS' : 'BUG', String(ss.totalAmount));
add('currency USD on booking', ss.currency === 'USD' ? 'PASS' : 'BUG', ss.currency);
add('DOC: refund.amount is authoritative credited amount', refund.amount === 0 ? 'NOTE' : 'PASS', `refund.amount=${refund.amount}`);
add('DOC: cancelled/partial should include credit txn when refund settles', d.transaction.some((t) => t.type === 'credit') ? 'PASS' : 'BUG', `txns=${d.transaction.map((t) => t.type).join(',')}; refund.amount=${refund.amount}`);
add('refund.id present (schema)', refund.id != null ? 'PASS' : 'BUG', String(refund.id));
add('refund.destinationType SOURCE|APP_WALLET|AIRLINE_CREDIT_SHELL', ['SOURCE', 'APP_WALLET', 'AIRLINE_CREDIT_SHELL'].includes(refund.destinationType) ? 'PASS' : 'BUG', String(refund.destinationType));
add('breakup fields present', breakup && ['airlineCancellationFee', 'convenienceFee', 'serviceFee', 'flexicancelFee'].every((k) => k in breakup) ? 'PASS' : 'BUG', JSON.stringify(breakup));
const breakupSum = breakup.airlineCancellationFee + breakup.convenienceFee + breakup.serviceFee + breakup.flexicancelFee;
add('breakup sums to cancellationCharge', Math.abs(breakupSum - refund.cancellationCharge) < 0.05 ? 'PASS' : 'BUG', `sum=${breakupSum} charge=${refund.cancellationCharge}`);
add('breakup currency sanity (USD booking but 350/100 look INR)', ss.currency === 'USD' && breakup.convenienceFee === 350 ? 'BUG' : 'PASS', `sale currency ${ss.currency}; convenienceFee breakup ${breakup.convenienceFee}`);
add('charge ≈ ssrAmount + breakup(350+100)', Math.abs((cr.ssrAmount + 450) - refund.cancellationCharge) < 0.05 ? 'PASS' : 'NOTE', `ssr ${cr.ssrAmount} + 450 = ${cr.ssrAmount + 450}; charge ${refund.cancellationCharge}`);
add('estimate charge+refund vs subset (not full total)', 'NOTE', `est ${cr.estimatedCancellationCharge}+${cr.estimatedRefund}=${(cr.estimatedCancellationCharge + cr.estimatedRefund).toFixed(2)}; paid ${ss.totalAmount}`);
add('settled charge 2575.71 ≠ estimate 2128.59', Math.abs(refund.cancellationCharge - cr.estimatedCancellationCharge) > 0.05 ? 'NOTE' : 'PASS', 'doc: estimates indicative; settle on refund');
add('saleSummary.convenienceFee 3.66 USD ≠ breakup.convenienceFee 350', Math.abs(ss.convenienceFee - breakup.convenienceFee) > 0.05 ? 'BUG' : 'PASS', `${ss.convenienceFee} vs ${breakup.convenienceFee}`);

// --- Passenger / leg schema ---
add('legs[].status schema BOOKED|CANCELLED', d.bookingDetails.passengers[0].legs[0].status === 'CANCELLED' ? 'PASS' : 'BUG', `got ${d.bookingDetails.passengers[0].legs[0].status}`);
add('partial: only in-scope leg CANCELLED; return leg should still appear BOOKED', d.bookingDetails.passengers[0].legs.length === 1 ? 'BUG' : 'PASS', `PAX1 legs in payload=${d.bookingDetails.passengers[0].legs.length} (missing return leg 1550)`);
add('RT 2ADT booking but payload passengers length', d.bookingDetails.passengerCountInPayload === 1 ? 'BUG' : 'PASS', `got ${d.bookingDetails.passengerCountInPayload}; expected both pax when booking stays live`);
add('addon direction COMBINED not in schema ONWARD|RETURN', d.bookingDetails.passengers[0].addons.baggageDirection === 'COMBINED' ? 'BUG' : 'PASS', d.bookingDetails.passengers[0].addons.baggageDirection);
add('seat.segmentId null (schema: match segments[].segmentId)', d.bookingDetails.passengers[0].addons.seatSegmentId == null ? 'BUG' : 'PASS', String(d.bookingDetails.passengers[0].addons.seatSegmentId));
add('segment airline.code/name/logo null', 'BUG', 'all null on TBO segments');
add('segment durationMinutes=0 / baggage=null / vendorFlightId=null', 'BUG', 'degenerate segment metadata');

// --- Live API snapshot ---
const auth = await authenticate();
const client = new TravelVipClient({
  baseUrl: config.baseUrl,
  signingKey: config.signingKey,
  authToken: auth.authToken || auth.auth_token || auth.token,
  partnerKey: config.partnerKey || process.env.PARTNER_KEY || process.env.X_PARTNER_KEY,
});
const st = await client.request({
  method: 'GET',
  path: `/v1/flights/booking/${BR}/status`,
  query: { lang: 'en', currency: 'USD' },
  correlation: true,
  partnerKey: client.partnerKey,
});
const body = st.data?.data || st.data || {};
const brsp = body.bookingResponse || {};
const apiStatus = body.status;
const pax = brsp.passengers || [];
const legs = pax.flatMap((x) => (x.legs || []).map((l) => ({ paxId: x.paxId, ...l })));
const cancelReq = brsp.cancellationRequest || [];

add('API status after webhook', apiStatus === 'Confirmed' || apiStatus === 'Cancelled' || apiStatus === 'Partially Cancelled' ? 'PASS' : 'NOTE', String(apiStatus));
add('API vs webhook: if PASSENGER_LEG, booking should still be live (Confirmed)', apiStatus === 'Confirmed' && p.event === 'booking.cancelled' ? 'BUG' : (apiStatus === 'Cancelled' ? 'NOTE' : 'PASS'), `API=${apiStatus} webhook.event=${p.event} webhook.status=${d.status}`);
add('API pax/leg matrix', 'NOTE', JSON.stringify(legs));
add('API cancellationRequest', 'NOTE', JSON.stringify(cancelReq).slice(0, 500));
add('API salesSummary', 'NOTE', JSON.stringify(brsp.salesSummary || null));

const counts = rows.reduce((a, r) => {
  a[r.status] = (a[r.status] || 0) + 1;
  return a;
}, {});

const report = {
  at: new Date().toISOString(),
  br: BR,
  sourceDoc: 'https://api-docs.travelvip.ai/webhook/flights-and-wallet-webhooks.pdf',
  webhook: {
    event: p.event,
    status: d.status,
    scope: cr.scope,
    money: {
      paid: ss.totalAmount,
      currency: ss.currency,
      estimateCharge: cr.estimatedCancellationCharge,
      estimateRefund: cr.estimatedRefund,
      ssrAmount: cr.ssrAmount,
      settledCharge: refund.cancellationCharge,
      settledRefund: refund.amount,
      breakup,
      breakupSum,
    },
  },
  api: {
    http: st.status,
    status: apiStatus,
    legs,
    cancellationRequest: cancelReq,
    salesSummary: brsp.salesSummary || null,
  },
  counts,
  rows,
  verdict: 'BUG — PASSENGER_LEG cancel emitted as booking.cancelled / status Cancelled; should be booking.partially_cancelled / Confirmed per PDF. Also money/schema gaps (no credit, refund.amount=0, breakup currency, missing pax/legs).',
};

const out = path.join('travel-apis/flight/reports', 'webhook-schema-rt-partial-BR1791300463267996.json');
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  out,
  verdict: report.verdict,
  counts,
  bugs: rows.filter((r) => r.status === 'BUG').map((r) => ({ rule: r.rule, note: r.note })),
  api: report.api,
  money: report.webhook.money,
}, null, 2));
