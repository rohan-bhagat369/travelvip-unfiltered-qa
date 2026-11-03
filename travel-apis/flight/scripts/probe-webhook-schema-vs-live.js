/**
 * Validate live flight webhook samples against:
 * https://api-docs.travelvip.ai/webhook/flights-and-wallet-webhooks.pdf
 * Payload version 1 (schema build V3) — 13 Aug 2026
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTS = path.join(__dirname, '../reports');

const CATALOGUE = [
  { event: 'booking.pending', type: 'flight', status: 'Pending' },
  { event: 'booking.confirmed', type: 'flight', status: 'Confirmed' },
  { event: 'booking.failed', type: 'flight', status: 'Failed' },
  { event: 'booking.cancellation_requested', type: 'flight', status: 'Confirmed' },
  { event: 'booking.cancelled', type: 'flight', status: 'Cancelled' },
  { event: 'booking.partially_cancelled', type: 'flight', status: 'Confirmed' },
  { event: 'booking.cancellation_failed', type: 'flight', status: 'Confirmed' },
  { event: 'wallet.low_balance', type: 'wallet', status: 'Alert' },
  { event: 'wallet.topup.success', type: 'wallet', status: 'Success' },
];

const SALE_KEYS = [
  'baseFare', 'convenienceFee', 'taxes', 'baggageAmount', 'mealAmount',
  'seatAmount', 'grossAmount', 'discountAmount', 'totalAmount', 'currency',
];
const TX_KEYS = ['id', 'amount', 'currency', 'paymentMethod', 'createdAt', 'completedAt', 'type', 'status'];
const CR_KEYS = [
  'id', 'status', 'mode', 'scope', 'estimatedCancellationCharge',
  'estimatedRefund', 'ssrAmount', 'createdAt', 'pnr',
];
const REFUND_KEYS = [
  'id', 'cancellationRequestId', 'amount', 'destinationType',
  'cancellationCharge', 'cancellationChargeBreakup', 'scope',
];
const BREAKUP_KEYS = ['airlineCancellationFee', 'convenienceFee', 'serviceFee', 'flexicancelFee'];

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}
function has(obj, k) {
  return obj != null && Object.prototype.hasOwnProperty.call(obj, k);
}
function add(rows, rule, status, note) {
  rows.push({ rule, status, note });
}

function validateEnvelope(p, rows, tag) {
  add(rows, `${tag}:version=1`, p.version === 1 ? 'PASS' : 'BUG', String(p.version));
  add(rows, `${tag}:event string`, typeof p.event === 'string' ? 'PASS' : 'BUG', String(p.event));
  add(rows, `${tag}:timestamp ISO Z`, typeof p.timestamp === 'string' && /Z$/.test(p.timestamp) ? 'PASS' : 'BUG', String(p.timestamp));
  add(rows, `${tag}:type flight|wallet`, p.type === 'flight' || p.type === 'wallet' ? 'PASS' : 'BUG', String(p.type));
  add(rows, `${tag}:data object`, typeOf(p.data) === 'object' ? 'PASS' : 'BUG', typeOf(p.data));
  const cat = CATALOGUE.find((c) => c.event === p.event);
  add(rows, `${tag}:event in catalogue`, cat ? 'PASS' : 'BUG', p.event);
  if (cat) {
    add(rows, `${tag}:type matches catalogue`, p.type === cat.type ? 'PASS' : 'BUG', `${p.type} vs ${cat.type}`);
    add(rows, `${tag}:data.status matches catalogue`, p.data?.status === cat.status ? 'PASS' : 'BUG', `${p.data?.status} vs ${cat.status}`);
  }
}

function validateSaleSummary(ss, rows, tag, { expectRefund } = {}) {
  for (const k of SALE_KEYS) {
    add(rows, `${tag}.saleSummary.${k}`, has(ss, k) ? 'PASS' : 'BUG', has(ss, k) ? String(ss[k]) : 'missing');
  }
  const mathOk = Math.abs((Number(ss.grossAmount) - Number(ss.discountAmount)) - Number(ss.totalAmount)) < 0.05;
  add(rows, `${tag}.saleSummary total=gross-discount`, mathOk ? 'PASS' : 'BUG', String(ss.totalAmount));
  if (expectRefund) {
    add(rows, `${tag}.saleSummary.refund present`, ss.refund ? 'PASS' : 'BUG', ss.refund ? 'yes' : 'missing');
    if (ss.refund) {
      for (const k of REFUND_KEYS) {
        add(rows, `${tag}.refund.${k}`, has(ss.refund, k) ? 'PASS' : 'BUG', has(ss.refund, k) ? 'ok' : 'missing');
      }
      if (ss.refund.cancellationChargeBreakup) {
        for (const k of BREAKUP_KEYS) {
          add(rows, `${tag}.breakup.${k}`, has(ss.refund.cancellationChargeBreakup, k) ? 'PASS' : 'BUG', String(ss.refund.cancellationChargeBreakup[k]));
        }
        const b = ss.refund.cancellationChargeBreakup;
        const sum = Number(b.airlineCancellationFee) + Number(b.convenienceFee) + Number(b.serviceFee) + Number(b.flexicancelFee);
        const charge = Number(ss.refund.cancellationCharge);
        add(rows, `${tag}.breakup sums to cancellationCharge`, Math.abs(sum - charge) < 0.05 ? 'PASS' : 'BUG', `sum=${sum} charge=${charge}`);
      }
    }
  } else {
    add(rows, `${tag}.saleSummary.refund absent`, !ss.refund ? 'PASS' : 'BUG', ss.refund ? 'present unexpectedly' : 'absent');
  }
}

function validateTx(tx, rows, tag) {
  add(rows, `${tag}.transaction is array`, Array.isArray(tx) ? 'PASS' : 'BUG', typeOf(tx));
  if (!Array.isArray(tx)) return;
  tx.forEach((t, i) => {
    for (const k of TX_KEYS) {
      add(rows, `${tag}.tx[${i}].${k}`, has(t, k) ? 'PASS' : 'BUG', has(t, k) ? String(t[k]) : 'missing');
    }
  });
}

function validateCancelReq(cr, rows, tag, expectStatus) {
  add(rows, `${tag}.cancellationRequest present`, cr ? 'PASS' : 'BUG', cr ? 'yes' : 'missing');
  if (!cr) return;
  for (const k of CR_KEYS) {
    add(rows, `${tag}.cr.${k}`, has(cr, k) ? 'PASS' : 'BUG', has(cr, k) ? JSON.stringify(cr[k]).slice(0, 80) : 'missing');
  }
  if (expectStatus) {
    add(rows, `${tag}.cr.status`, cr.status === expectStatus ? 'PASS' : 'BUG', `${cr.status} vs ${expectStatus}`);
  }
  if (cr.scope) {
    add(rows, `${tag}.cr.scope.type`, ['FULL', 'LEG', 'PASSENGER', 'PASSENGER_LEG'].includes(cr.scope.type) ? 'PASS' : 'BUG', String(cr.scope.type));
    add(rows, `${tag}.cr.scope.legIds array`, Array.isArray(cr.scope.legIds) ? 'PASS' : 'BUG', JSON.stringify(cr.scope.legIds));
    add(rows, `${tag}.cr.scope.paxIds array`, Array.isArray(cr.scope.paxIds) ? 'PASS' : 'BUG', JSON.stringify(cr.scope.paxIds));
  }
  add(rows, `${tag}.cr.mode ONLINE|OFFLINE`, cr.mode === 'ONLINE' || cr.mode === 'OFFLINE' ? 'PASS' : 'BUG', String(cr.mode));
}

function validateLegs(pax, rows, tag, allowed) {
  for (const p of pax || []) {
    for (const leg of p.legs || []) {
      add(rows, `${tag}.legStatus schema BOOKED|CANCELLED`, allowed.includes(leg.status) ? 'PASS' : 'BUG', `got ${leg.status}`);
      add(rows, `${tag}.legId integer`, Number.isInteger(leg.legId) ? 'PASS' : 'BUG', `${leg.legId} type=${typeOf(leg.legId)}`);
    }
  }
}

function validateItinerary(itin, rows, tag) {
  for (const leg of itin || []) {
    add(rows, `${tag}.itin.legId integer`, Number.isInteger(leg.legId) ? 'PASS' : 'BUG', String(leg.legId));
    add(rows, `${tag}.itin.sequenceNumber integer`, Number.isInteger(leg.sequenceNumber) ? 'PASS' : 'BUG', String(leg.sequenceNumber));
    add(rows, `${tag}.itin.direction`, leg.direction === 'ONWARD' || leg.direction === 'RETURN' ? 'PASS' : 'BUG', String(leg.direction));
  }
}

function validateFlightPayload(p, rows, tag, opts = {}) {
  validateEnvelope(p, rows, tag);
  const d = p.data || {};
  add(rows, `${tag}:bookingReference`, typeof d.bookingReference === 'string' ? 'PASS' : 'BUG', String(d.bookingReference));
  add(rows, `${tag}:reason null|string`, d.reason === null || typeof d.reason === 'string' ? 'PASS' : 'BUG', String(d.reason));
  validateTx(d.transaction, rows, tag);
  const bd = d.bookingDetails || {};
  const sd = bd.serviceDetails || {};
  add(rows, `${tag}:pnrCount`, Number.isInteger(sd.pnrCount) ? 'PASS' : 'BUG', String(sd.pnrCount));
  add(rows, `${tag}:pnrGroups array`, Array.isArray(sd.pnrGroups) ? 'PASS' : 'BUG', typeOf(sd.pnrGroups));
  validateItinerary(sd.itinerary, rows, tag);
  validateSaleSummary(bd.saleSummary || {}, rows, tag, opts);
  add(rows, `${tag}:cancellation object`, bd.cancellation && typeof bd.cancellation.isCancellable === 'boolean' ? 'PASS' : 'BUG', JSON.stringify(bd.cancellation));
  add(rows, `${tag}:passengers array`, Array.isArray(bd.passengers) ? 'PASS' : 'BUG', typeOf(bd.passengers));
  if (opts.expectCancelReq) validateCancelReq(d.cancellationRequest, rows, tag, opts.crStatus);
  else add(rows, `${tag}:cancellationRequest absent`, !d.cancellationRequest ? 'PASS' : 'BUG', d.cancellationRequest ? 'present' : 'absent');
  if (opts.legStatuses) validateLegs(bd.passengers, rows, tag, opts.legStatuses);

  if (opts.expectRefund && bd.saleSummary?.refund && Array.isArray(d.transaction)) {
    const credit = d.transaction.find((t) => t.type === 'credit');
    if (credit) {
      add(rows, `${tag}:credit amount = refund.amount`, Number(credit.amount) === Number(bd.saleSummary.refund.amount) ? 'PASS' : 'BUG', `${credit.amount} vs ${bd.saleSummary.refund.amount}`);
    }
    const debit = d.transaction.find((t) => t.type === 'debit');
    if (debit && bd.saleSummary.refund.cancellationCharge != null) {
      const expected = Number(debit.amount) - Number(bd.saleSummary.refund.cancellationCharge);
      add(rows, `${tag}:debit-charge = refund`, Math.abs(expected - Number(bd.saleSummary.refund.amount)) < 0.05 ? 'PASS' : 'BUG', `${expected} vs ${bd.saleSummary.refund.amount}`);
    }
  }
}

const cancelled = JSON.parse(
  fs.readFileSync(path.join(REPORTS, 'flight-cancel-lifecycle-BR1791895647607777.json'), 'utf8'),
).payloads.cancelledWebhookFull;

const confirmedOld = {
  version: 1,
  event: 'booking.confirmed',
  timestamp: '2026-10-13T13:24:40Z',
  type: 'flight',
  data: {
    status: 'Confirmed',
    reason: null,
    bookingReference: 'BR1791897850832408',
    transaction: [{
      id: '5214', amount: 1650, currency: 'INR', paymentMethod: 'wallet',
      createdAt: '2026-10-13T13:24:11Z', completedAt: '2026-10-13T13:24:11Z', type: 'debit', status: 'success',
    }],
    contactDetails: { email: 'qa@travelvip.ai', countryCode: '+91', mobile: '9921862715' },
    bookingDetails: {
      serviceDetails: {
        journeyType: 'ONE_WAY',
        pnrCount: 1,
        pnrGroups: [{ pnr: 'FVRVRV', legIds: [1577] }],
        itinerary: [{
          legId: 1577, sequenceNumber: 1, direction: 'ONWARD', sharesPnrWith: [],
          totalStops: 0, totalDurationMinutes: 110, refundable: false, refundText: 'Non-refundable',
          isCancellable: true, cancellationPolicy: null, pnr: 'FVRVRV',
          segments: [{
            segmentId: '6E46-DEL-BOM-2026-11-12T15:00-2026-11-12T16:50',
            flightNumber: '6E 46',
            airline: { code: '6E', name: 'IndiGo Airlines', logo: 'https://img.travelx.ai/x' },
            cabinClass: 'ECONOMY', aircraft: null, durationMinutes: 110, stops: 0,
            vendorFlightId: '6E46-DEL-BOM-2026-11-12T15:00-2026-11-12T16:50',
            baggage: { checkIn: '0 KG', cabin: '7 Kg' },
            departure: {
              time: '2026-11-12T15:00', terminal: '1', airportCode: 'DEL',
              airportName: 'Indira Gandhi International Airport', city: 'New Delhi', country: 'India',
            },
            arrival: {
              time: '2026-11-12T16:50', terminal: '1', airportCode: 'BOM',
              airportName: 'Chhatrapati Shivaji Maharaj International Airport', city: 'Mumbai', country: 'India',
            },
          }],
        }],
      },
      saleSummary: {
        baseFare: 1200, convenienceFee: 350, taxes: 100, baggageAmount: 0, mealAmount: 0, seatAmount: 0,
        grossAmount: 1650, discountAmount: 0, totalAmount: 1650, currency: 'INR', appliedOffer: null,
      },
      cancellation: { isCancellable: true, cancellationPolicy: null },
      passengers: [{
        paxId: 'PAX1', paxType: 'ADULT',
        profile: { title: 'Mr', firstName: 'Rohan', lastName: 'Bhagatukzb', dob: '2001-05-29' },
        passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
        legs: [{ legId: 1577, pnr: 'FVRVRV', eticket: 'BX13HJ00521-1', status: 'Confirmed' }],
        addons: { baggage: [], meal: [], seat: [] },
      }],
    },
  },
};

const confirmedNew = {
  version: 1,
  event: 'booking.confirmed',
  timestamp: '2026-10-13T13:28:20Z',
  type: 'flight',
  data: {
    status: 'Confirmed',
    reason: null,
    bookingReference: 'BR1791898085747931',
    transaction: [{
      id: '5215', amount: 3077, currency: 'INR', paymentMethod: 'wallet',
      createdAt: '2026-10-13T13:28:07Z', completedAt: '2026-10-13T13:28:07Z', type: 'debit', status: 'success',
    }],
    contactDetails: { email: 'qa@travelvip.ai', countryCode: '+91', mobile: '9921862715' },
    bookingDetails: {
      serviceDetails: {
        journeyType: 'ONE_WAY',
        pnrCount: 1,
        pnrGroups: [{ pnr: 'J371MJ', legIds: [1578] }],
        itinerary: [{
          legId: 1578, sequenceNumber: 1, direction: 'ONWARD', sharesPnrWith: [],
          totalStops: 0, totalDurationMinutes: 125, refundable: true, refundText: 'Refundable',
          isCancellable: true, cancellationPolicy: null, pnr: 'J371MJ',
          segments: [{
            segmentId: 'IX1463-DEL-NMI-2026-11-20T06:00-2026-11-20T08:05',
            flightNumber: 'IX 1463',
            airline: { code: 'IX', name: 'AIR INDIA EXPRESS', logo: 'https://img.travelx.ai/x' },
            cabinClass: 'ECONOMY', aircraft: 'Airbus A32Y', durationMinutes: 125, stops: 0,
            vendorFlightId: 'IX1463-DEL-NMI-2026-11-20T06:00-2026-11-20T08:05',
            baggage: { checkIn: '15Kg', cabin: '7 Kg' },
            departure: {
              time: '2026-11-20T06:00', terminal: '1', airportCode: 'DEL',
              airportName: 'Indira Gandhi International Airport', city: 'New Delhi', country: 'India',
            },
            arrival: {
              time: '2026-11-20T08:05', terminal: '', airportCode: 'NMI',
              airportName: 'Navi Mumbai International Airport', city: 'Navi Mumbai', country: 'India',
            },
          }],
        }],
      },
      saleSummary: {
        baseFare: 899, convenienceFee: 350, taxes: 1828, baggageAmount: 0, mealAmount: 0, seatAmount: 0,
        grossAmount: 3077, discountAmount: 0, totalAmount: 3077, currency: 'INR', appliedOffer: null,
      },
      cancellation: { isCancellable: true, cancellationPolicy: null },
      passengers: [{
        paxId: 'PAX1', paxType: 'ADULT',
        profile: { title: 'Mr', firstName: 'Rohan', lastName: 'Bhagattest', dob: '2001-05-29' },
        passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
        legs: [{ legId: 1578, pnr: 'J371MJ', eticket: 'BX13HJ00531-1', status: 'Confirmed' }],
        addons: { baggage: [], meal: [], seat: [] },
      }],
    },
  },
};

const rows = [];
add(rows, 'DOC: catalogue has 9 events', CATALOGUE.length === 9 ? 'PASS' : 'BUG', String(CATALOGUE.length));
add(rows, 'DOC typo: table says booking.confirm; examples use booking.confirmed', 'GAP', 'section 2 catalogue typo');
add(rows, 'DOC: no dedicated reschedule webhook event', 'NOTE', 'reschedule reuses booking.confirmed');
add(rows, 'DOC: confirmed schema has no reschedulingReferenceId', 'GAP', 'API status has field; webhook PDF omits it');

validateFlightPayload(confirmedOld, rows, 'CONFIRMED-old', {
  expectRefund: false, expectCancelReq: false, legStatuses: ['BOOKED'],
});
validateFlightPayload(confirmedNew, rows, 'CONFIRMED-new', {
  expectRefund: false, expectCancelReq: false, legStatuses: ['BOOKED'],
});
validateFlightPayload(cancelled, rows, 'CANCELLED-plain', {
  expectRefund: true, expectCancelReq: true, crStatus: 'Cancellation Successful', legStatuses: ['CANCELLED'],
});

add(rows, 'TRIGGER pending→confirmed', 'PASS', 'SSR BR1791896467778797');
add(rows, 'TRIGGER confirmed→cancellation_requested (status stays Confirmed)', 'PASS', 'plain + SSR cancels');
add(rows, 'TRIGGER cancellation_requested→cancelled + credit', 'PASS', 'plain + SSR cancels');
add(rows, 'TRIGGER booking.failed', 'NOT TESTED', 'no sample today');
add(rows, 'TRIGGER booking.partially_cancelled', 'NOT TESTED', 'no sample today');
add(rows, 'TRIGGER booking.cancellation_failed', 'NOT TESTED', 'no sample today');
add(rows, 'TRIGGER wallet.low_balance / topup.success', 'NOT TESTED', 'no sample today');
add(rows, 'TRIGGER reschedule: cancel-family on old before new confirmed', 'BUG', 'new confirmed while old still Confirmed; no cancel events on old');

const counts = rows.reduce((a, r) => {
  a[r.status] = (a[r.status] || 0) + 1;
  return a;
}, {});

const report = {
  at: new Date().toISOString(),
  source: 'https://api-docs.travelvip.ai/webhook/flights-and-wallet-webhooks.pdf',
  schema: 'Payload version 1 (schema build V3) — 13 Aug 2026',
  catalogue: CATALOGUE,
  counts,
  bugs: rows.filter((r) => r.status === 'BUG'),
  gaps: rows.filter((r) => r.status === 'GAP'),
  rows,
  summary: {
    testedEvents: ['booking.confirmed', 'booking.cancelled', 'booking.pending (lifecycle)', 'booking.cancellation_requested (lifecycle)'],
    triggerPass: ['pending', 'confirmed', 'cancellation_requested', 'cancelled'],
    triggerNotTested: ['failed', 'partially_cancelled', 'cancellation_failed', 'wallet.*'],
    schemaBugs: [
      'legs[].status live = Confirmed/Cancelled; schema allows only BOOKED|CANCELLED',
      'cancellationChargeBreakup all 0 while cancellationCharge=450',
      'reschedule pair: no cancel webhook on old before new confirmed',
    ],
    schemaGaps: [
      'PDF catalogue typo booking.confirm vs booking.confirmed',
      'no reschedulingReferenceId in confirmed webhook schema/examples',
    ],
  },
};

const out = path.join(REPORTS, 'webhook-schema-vs-live-2026-10-13.json');
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  out,
  counts,
  bugCount: report.bugs.length,
  bugs: report.bugs.map((b) => ({ rule: b.rule, note: b.note })),
  gaps: report.gaps.map((g) => ({ rule: g.rule, note: g.note })),
  summary: report.summary,
}, null, 2));
