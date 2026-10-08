/**
 * ENG-22 flight retry: skip NMI, new names/dates. Poll leftover BRs from first run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { FlightService } from '../../../travel-apis/flight/src/service.js';
import { buildIssueTicketPayload, buildOneWaySearchBody } from '../../../travel-apis/flight/src/helpers.js';
import { pollSearchUntilOptions } from '../../../travel-apis/flight/src/searchPicker.js';
import { buildPassengers, uniqueTag } from '../../../travel-apis/flight/src/passengerBuilder.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const PREFIX = 'qa-otel-eng22-flt-20260917h';
const OUT = path.join('reports', 'zenith-otel-eng22-flight-retry.json');
const LEFTOVER = ['BR1789649851314442', 'BR1789649858695278'];
const steps = [];

function brief(data, n = 280) {
  try { return JSON.stringify(data).slice(0, n); } catch { return String(data); }
}
function classify(raw) {
  const s = String(raw || '');
  if (/confirm/i.test(s)) return 'Confirmed';
  if (/inprogress|in.?progress/i.test(s)) return 'Inprogress';
  if (/fail/i.test(s)) return 'Failed';
  if (/cancel/i.test(s)) return 'Cancelled';
  return s || 'Pending';
}

async function timed(label, corr, client, fn) {
  client.setCorrelationId(corr);
  const t0 = Date.now();
  const res = await fn();
  const row = {
    label,
    corr,
    http: res?.status ?? null,
    ok: Boolean(res?.ok),
    clientMs: Date.now() - t0,
    errorCode: res?.data?.error?.code || null,
    status: res?.data?.status ?? null,
    bookingRefId: res?.data?.bookingReference || res?.data?.bookingReferenceId || null,
    bodyPreview: brief(res?.data),
  };
  steps.push(row);
  console.log(JSON.stringify(row));
  return res;
}

(async () => {
  process.env.BASE_URL = process.env.BASE_URL || 'https://zenith-api.travelvip.ai';
  clearSession();
  process.env.CORRELATION_ID = `${PREFIX}-auth`;
  const session = await authenticate(true);
  const client = session.client;
  const flight = new FlightService(client);
  if (session.accessToken) client.setPartnerKey(session.accessToken);

  const leftover = [];
  for (const br of LEFTOVER) {
    const st = await timed(`leftover-${br}`, `${PREFIX}-left-${br.slice(-6)}`, client, () =>
      flight.getBookingStatus(br));
    leftover.push({ br, status: classify(st.data?.status) });
    if (classify(st.data?.status) === 'Confirmed') {
      const detail = await timed(`detail-${br}`, `${PREFIX}-det-${br.slice(-6)}`, client, () =>
        flight.getBookingDetail(br));
      const pnr = detail.data?.bookingResponse?.itinerary?.[0]?.pnr || null;
      await timed(`cancel-${br}`, `${PREFIX}-can-${br.slice(-6)}`, client, () =>
        flight.cancelV2({ bookingId: br, action: 'CANCEL', ...(pnr ? { pnr } : {}), cancelledBy: 'QA-ENG22' }));
    }
  }

  const body = buildOneWaySearchBody(35, {
    origin: 'DEL',
    destination: 'BOM',
    maxStops: 0,
    fareType: 'NORMAL',
  });
  client.setCorrelationId(`${PREFIX}-search`);
  const t0 = Date.now();
  const polled = await pollSearchUntilOptions(flight, body, { maxStops: 0, fareType: 'NORMAL' }, { maxPolls: 12 });
  const picks = (polled.picks || []).filter((p) => !/NMI/i.test(p.label || ''));
  steps.push({
    label: 'search',
    corr: `${PREFIX}-search`,
    http: polled.response?.status ?? 200,
    ok: Boolean(picks.length),
    clientMs: Date.now() - t0,
    picks: picks.length,
    bodyPreview: brief({ pick: picks[0]?.label, searchId: picks[0]?.searchId, skippedNmi: true }),
  });
  console.log(JSON.stringify(steps[steps.length - 1]));

  let booked = null;
  for (const pick of picks.slice(0, 4)) {
    const ids = [pick.searchId];
    const details = await timed(`details-${pick.label}`, `${PREFIX}-details`, client, () =>
      flight.getDetails(ids, 'ONE_WAY'));
    const pricing = await timed(`pricing-${pick.label}`, `${PREFIX}-pricing`, client, () =>
      flight.getPricing(ids, 'ONE_WAY'));
    if (!pricing.data?.priceId || !pricing.data?.bookingContext) continue;
    const tag = uniqueTag();
    const payload = buildIssueTicketPayload({
      bookingContext: pricing.data.bookingContext,
      priceId: pricing.data.priceId,
      searchIds: ids,
      journeyType: 'ONE_WAY',
    });
    payload.data.passengers = buildPassengers({
      adults: 1,
      uniqueNames: true,
      leadFirstName: 'Arjun',
      leadLastName: `Malhotra${tag}`,
      nameIndex: 4,
    });
    payload.data.contact.email = `flight.otel.retry.${Date.now()}@travelvip.ai`;
    payload.data.passportType = pricing.data.passportType || 'NONE';
    if (pricing.data?.addGstInfo === true) {
      payload.data.includeGst = true;
      payload.data.gstDetails = {
        gstNumber: '27AABCT1429B1Z1',
        gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
        gstAddress: 'Pune',
        gstEmailID: 'accounts@travelvip.ai',
        gstMobileNumber: '9921862715',
      };
    }
    const issue = await timed(`issue-${pick.label}`, `${PREFIX}-issue`, client, () =>
      flight.issueTicketV2(payload));
    const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
    if (!br) continue;
    let classified = 'Pending';
    let lastSt = null;
    for (let i = 0; i < 20; i += 1) {
      lastSt = await timed(`status-${br}-${i + 1}`, `${PREFIX}-status-${i + 1}`, client, () =>
        flight.getBookingStatus(br));
      classified = classify(lastSt.data?.status);
      if (['Confirmed', 'Inprogress', 'Failed', 'Cancelled'].includes(classified)) break;
      await sleep(3000);
    }
    booked = { br, classified, pick: pick.label, detailsHttp: details.status };
    if (classified === 'Confirmed') {
      const detail = await timed('detail', `${PREFIX}-detail`, client, () =>
        flight.getBookingDetail(br));
      const pnr = detail.data?.bookingResponse?.itinerary?.[0]?.pnr || null;
      await timed('penalty', `${PREFIX}-penalty`, client, () =>
        flight.checkCancellationPenalty(br, pnr ? { pnr } : {}));
      const cancel = await timed('cancel', `${PREFIX}-cancel`, client, () =>
        flight.cancelV2({ bookingId: br, action: 'CANCEL', ...(pnr ? { pnr } : {}), cancelledBy: 'QA-ENG22' }));
      const after = await timed('after-cancel', `${PREFIX}-after-cancel`, client, () =>
        flight.getBookingStatus(br));
      booked.cancelHttp = cancel.status;
      booked.afterCancel = classify(after.data?.status);
      booked.pnr = pnr;
      break;
    }
    if (classified === 'Inprogress') break;
  }

  const out = {
    prefix: PREFIX,
    leftover,
    booked,
    steps,
    verdict: booked?.classified === 'Confirmed' ? 'PASS' : (booked?.classified === 'Inprogress' ? 'NOT TESTED' : 'NOT TESTED'),
    ended: new Date().toISOString(),
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ leftover, booked, verdict: out.verdict }));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
