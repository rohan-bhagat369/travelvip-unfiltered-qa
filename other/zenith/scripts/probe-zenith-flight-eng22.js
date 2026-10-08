/**
 * ENG-22 flight on zenith-api (staging vgm creds). Unique X-Correlation-ID per hop.
 * OW 1ADT: DEL-BOM then DEL-GOI. Inprogress → one retry, new names + dates.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../../shared/config/env.js';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { FlightService } from '../../../travel-apis/flight/src/service.js';
import {
  buildIssueTicketPayload,
  buildOneWaySearchBody,
} from '../../../travel-apis/flight/src/helpers.js';
import { pollSearchUntilOptions } from '../../../travel-apis/flight/src/searchPicker.js';
import { buildPassengers, uniqueTag } from '../../../travel-apis/flight/src/passengerBuilder.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const PREFIX = process.env.CORR_PREFIX || `qa-otel-eng22-flt-${Date.now()}`;
const OUT = path.join('reports', 'zenith-otel-eng22-flight.json');
const GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};
const steps = [];

function brief(data, n = 360) {
  try {
    return JSON.stringify(data).slice(0, n);
  } catch {
    return String(data).slice(0, n);
  }
}

function errCode(res) {
  return res?.data?.error?.code || res?.data?.code || null;
}

function classify(raw) {
  const s = String(raw || '');
  if (/confirm/i.test(s)) return 'Confirmed';
  if (/inprogress|in.?progress/i.test(s)) return 'Inprogress';
  if (/fail/i.test(s)) return 'Failed';
  if (/cancel/i.test(s)) return 'Cancelled';
  return s || 'Pending';
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

async function timed(label, corr, client, fn) {
  client.setCorrelationId(corr);
  const t0 = Date.now();
  const res = await fn();
  const row = {
    label,
    corr,
    method: res?.method || null,
    path: res?.path || null,
    http: res?.status ?? null,
    ok: Boolean(res?.ok),
    clientMs: Date.now() - t0,
    errorCode: errCode(res),
    status: res?.data?.status ?? res?.data?.statusCode ?? null,
    bookingRefId: res?.data?.bookingReference || res?.data?.bookingReferenceId || null,
    bodyPreview: brief(res?.data),
  };
  steps.push(row);
  console.log(JSON.stringify(row));
  return res;
}

async function pollUntilSettled(flight, client, br, prefix) {
  let last = { classified: 'Pending', raw: '', polls: 0 };
  for (let i = 0; i < 24; i += 1) {
    const st = await timed(`${prefix}-status-${i + 1}`, `${prefix}-status-${i + 1}`, client, () =>
      flight.getBookingStatus(br));
    const raw = String(st.data?.status || '');
    const classified = classify(raw);
    last = { classified, raw, polls: i + 1, res: st };
    if (['Confirmed', 'Inprogress', 'Failed', 'Cancelled'].includes(classified)) return last;
    await sleep(3000);
  }
  return last;
}

async function priceOw(flight, client, { origin, destination, onwardDays, maxStops, hop }) {
  const body = buildOneWaySearchBody(onwardDays, {
    origin,
    destination,
    maxStops,
    fareType: 'NORMAL',
  });
  body.travellers = { adults: 1, children: 0, infants: 0 };
  client.setCorrelationId(`${PREFIX}-${hop}-search`);
  const t0 = Date.now();
  const polled = await pollSearchUntilOptions(flight, body, { maxStops, fareType: 'NORMAL' }, { maxPolls: 12 });
  const searched = polled.response || { ok: Boolean(polled.picks?.length), status: 200, data: polled.data };
  steps.push({
    label: `${hop}-search`,
    corr: `${PREFIX}-${hop}-search`,
    http: searched.status ?? null,
    ok: Boolean(searched.ok ?? polled.picks?.length),
    clientMs: Date.now() - t0,
    errorCode: errCode(searched),
    picks: polled.picks?.length || 0,
    bodyPreview: brief({
      progress: polled.data?.progress,
      pick: polled.picks?.[0]?.label,
      searchId: polled.picks?.[0]?.searchId,
      error: polled.data?.error,
    }),
  });
  console.log(JSON.stringify(steps[steps.length - 1]));
  const picks = polled.picks || [];
  const searchId = picks[0]?.searchId;
  if (!searchId) {
    return { searchId: null, search: searched, pick: null };
  }
  const ids = [searchId];
  const details = await timed(`${hop}-details`, `${PREFIX}-${hop}-details`, client, () =>
    flight.getDetails(ids, 'ONE_WAY'));
  const rules = await timed(`${hop}-fareRules`, `${PREFIX}-${hop}-fareRules`, client, () =>
    flight.getFareRules(ids, 'ONE_WAY'));
  const pricing = await timed(`${hop}-pricing`, `${PREFIX}-${hop}-pricing`, client, () =>
    flight.getPricing(ids, 'ONE_WAY'));
  return { searchId, ids, search: searched, details, rules, pricing, pick: picks[0] };
}

function makePayload(pricing, ids, nameLag) {
  const tag = uniqueTag();
  const passengers = buildPassengers({
    adults: 1,
    uniqueNames: true,
    leadFirstName: 'Rohan',
    leadLastName: `Bhagat${tag}`,
    nameIndex: nameLag,
  });
  const payload = buildIssueTicketPayload({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds: ids,
    journeyType: 'ONE_WAY',
  });
  payload.data.passengers = passengers;
  payload.data.contact.email = `flight.otel.${Date.now()}@travelvip.ai`;
  payload.data.passportType = pricing.data.passportType || 'NONE';
  applyGst(payload, pricing.data);
  return payload;
}

(async () => {
  const started = new Date().toISOString();
  const baseUrl = process.env.BASE_URL || 'https://zenith-api.travelvip.ai';
  console.log(JSON.stringify({
    baseUrl,
    prefix: PREFIX,
    partner: config.partnerId,
    note: 'ENG-22 flight on zenith; staging vgm creds',
  }));

  clearSession();
  process.env.CORRELATION_ID = `${PREFIX}-auth`;
  const session = await authenticate(true);
  const client = session.client;
  const flight = new FlightService(client);
  if (session.accessToken) client.setPartnerKey(session.accessToken);

  await timed('neg-search-html-dest', `${PREFIX}-neg-html-dest`, client, () =>
    flight.search({
      itinerary: [{ origin: 'DEL', destination: '<script>', date: '2026-10-20' }],
      travellers: { adults: 1, children: 0, infants: 0 },
      cabinClass: 'ECONOMY',
      journeyType: 'ONE_WAY',
      currency: 'INR',
      language: 'en',
      preferences: { airlines: [], maxStops: 0, refundableOnly: false },
    }));

  const routes = [
    { origin: 'DEL', destination: 'BOM', onwardDays: 28, maxStops: 0, hop: 'delbom' },
    { origin: 'DEL', destination: 'GOI', onwardDays: 28, maxStops: 1, hop: 'delgoi' },
    { origin: 'DEL', destination: 'BOM', onwardDays: 35, maxStops: 0, hop: 'delbom35' },
  ];

  let priced = null;
  for (const spec of routes) {
    const got = await priceOw(flight, client, spec);
    if (got.pricing?.data?.priceId && got.pricing?.data?.bookingContext) {
      priced = { ...got, spec };
      break;
    }
  }

  const out = {
    started,
    prefix: PREFIX,
    baseUrl,
    steps,
    bookingRefId: null,
    bookingStatus: null,
    retry: null,
    cancelHttp: null,
    verdict: 'NOT TESTED',
    note: '',
  };

  if (!priced) {
    out.note = 'no priced OW option on DEL-BOM / DEL-GOI';
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
    console.log(JSON.stringify({ verdict: out.verdict, note: out.note }));
    process.exit(1);
  }

  await timed('neg-details-empty-ids', `${PREFIX}-neg-details-empty`, client, () =>
    flight.getDetails([], 'ONE_WAY'));

  const payload = makePayload(priced.pricing, priced.ids, 0);
  const pii = JSON.parse(JSON.stringify(payload));
  pii.data.passengers[0].profile.middleName = 'Kumar';
  pii.data.passengers[0].profile.passportNumber = 'Z1234567';
  pii.data.passengers[0].passport = {
    number: 'Z1234567',
    expiry: '2031-08-01',
    issuedDate: '2020-08-01',
    issuedCountryCode: 'IN',
  };
  pii.data.contact.cardNumber = '4111111111111111';
  pii.data.profile = { firstName: 'Rohan', lastName: 'Bhagat' };
  pii.data.passport = { number: 'Z1234567' };
  await timed('neg-issue-pii-shaped', `${PREFIX}-neg-pii`, client, () =>
    flight.issueTicketV2(pii));

  const comma = JSON.parse(JSON.stringify(payload));
  comma.data.passengers[0].profile.firstName = 'Rohan,';
  await timed('neg-issue-comma-fn', `${PREFIX}-neg-comma-fn`, client, () =>
    flight.issueTicketV2(comma));

  const issue = await timed('issue', `${PREFIX}-issue`, client, () =>
    flight.issueTicketV2(payload));
  const br = issue.data?.bookingReference || issue.data?.bookingReferenceId || null;
  out.bookingRefId = br;

  async function afterBook(bookBr, hop) {
    const settled = await pollUntilSettled(flight, client, bookBr, `${PREFIX}-${hop}`);
    out.bookingStatus = settled.classified;
    if (settled.classified !== 'Confirmed') return settled;

    const detail = await timed('detail', `${PREFIX}-detail`, client, () =>
      flight.getBookingDetail(bookBr));
    const pnr = detail.data?.bookingResponse?.itinerary?.[0]?.pnr
      || detail.data?.itinerary?.[0]?.pnr
      || null;
    await timed('penalty', `${PREFIX}-penalty`, client, () =>
      flight.checkCancellationPenalty(bookBr, pnr ? { pnr } : {}));
    const cancel = await timed('cancel', `${PREFIX}-cancel`, client, () =>
      flight.cancelV2({
        bookingId: bookBr,
        action: 'CANCEL',
        ...(pnr ? { pnr } : {}),
        cancelledBy: 'QA-ENG22',
      }));
    out.cancelHttp = cancel.status;
    const after = await timed('status-after-cancel', `${PREFIX}-status-after-cancel`, client, () =>
      flight.getBookingStatus(bookBr));
    out.statusAfterCancel = classify(after.data?.status);
    return settled;
  }

  if (!br) {
    out.verdict = 'BUG';
    out.note = `issue-ticket no BR: ${brief(issue.data)}`;
  } else {
    const first = await afterBook(br, 'poll');
    if (first.classified === 'Inprogress') {
      const retrySpec = {
        origin: priced.spec.origin === 'BOM' ? 'DEL' : priced.spec.origin,
        destination: priced.spec.destination === 'BOM' ? 'GOI' : 'BOM',
        onwardDays: (priced.spec.onwardDays || 28) + 7,
        maxStops: 1,
        hop: 'retry',
      };
      const retryPriced = await priceOw(flight, client, retrySpec);
      out.retry = { searchId: retryPriced.searchId || null };
      if (retryPriced.pricing?.data?.priceId) {
        const retryPayload = makePayload(retryPriced.pricing, retryPriced.ids, 3);
        const retryIssue = await timed('issue-retry', `${PREFIX}-issue-retry`, client, () =>
          flight.issueTicketV2(retryPayload));
        const br2 = retryIssue.data?.bookingReference || retryIssue.data?.bookingReferenceId || null;
        out.retry.bookingRefId = br2;
        if (br2) {
          const second = await pollUntilSettled(flight, client, br2, `${PREFIX}-retry`);
          out.retry.bookingStatus = second.classified;
          out.bookingRefId = br2;
          out.bookingStatus = second.classified;
          if (second.classified === 'Confirmed') await afterBook(br2, 'retry-post');
        }
      }
      out.verdict = out.bookingStatus === 'Confirmed' ? 'PASS' : 'NOT TESTED';
      out.note = `first BR Inprogress left; retry ${out.retry.bookingStatus || 'no BR'}`;
    } else if (first.classified === 'Confirmed') {
      out.verdict = 'PASS';
      out.note = 'Confirmed then cancel attempted';
    } else {
      out.verdict = first.classified === 'Failed' ? 'BUG' : 'NOT TESTED';
      out.note = `settled ${first.classified}`;
    }
  }

  out.ended = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({
    verdict: out.verdict,
    bookingRefId: out.bookingRefId,
    bookingStatus: out.bookingStatus,
    note: out.note,
    cancelHttp: out.cancelHttp,
  }));
  process.exit(out.verdict === 'BUG' ? 1 : 0);
})().catch((err) => {
  console.error(err);
  fs.writeFileSync(OUT, JSON.stringify({ prefix: PREFIX, steps, error: String(err) }, null, 2));
  process.exit(1);
});
