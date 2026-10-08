/**
 * api-staging: book multipax OW + RT (no ancillaries).
 * Default pax: 1ADT + 1CHD + 1INF (pack multipax fixture).
 *
 * Inprogress/Failed: leave BR, retry once with different names + dates, then stop.
 *
 *   BASE_URL=https://api-staging.travelvip.ai node scripts/book-ow-rt-multipax-staging.js
 * Report: reports/book-ow-rt-multipax-staging.json
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';
import {
  buildIssueTicketPayload,
  buildOneWaySearchBody,
  buildRoundTripSearchBody,
  extractFirstSearchId,
  isSearchProgressComplete,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';
import { buildPassengers, uniqueTag } from '../src/passengerBuilder.js';
import { GST } from '../../hotel/src/regression/fixtures.js';
import { config } from '../../../shared/config/env.js';

process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
const OUT = path.join('reports', 'book-ow-rt-multipax-staging.json');

const ADULTS = Number(process.env.PAX_ADULTS || 1);
const CHILDREN = Number(process.env.PAX_CHILDREN || 1);
const INFANTS = Number(process.env.PAX_INFANTS || 1);

function classifyStatus(raw) {
  const s = String(raw || '').trim();
  if (/confirm/i.test(s)) return 'Confirmed';
  if (/inprogress|in.?progress/i.test(s)) return 'Inprogress';
  if (/fail/i.test(s)) return 'Failed';
  if (/cancel/i.test(s)) return 'Cancelled';
  return s || 'Pending';
}

function isSettled(raw) {
  return ['Confirmed', 'Inprogress', 'Failed', 'Cancelled'].includes(classifyStatus(raw));
}

async function pollSearch(flight, body, max = 12) {
  let last = null;
  for (let i = 0; i < max; i += 1) {
    last = await flight.search(body);
    if (!last.ok) return last;
    const n = (last.data?.results || []).reduce((a, r) => a + (r.options?.length || 0), 0);
    if (n > 0 || isSearchProgressComplete(last.data)) return last;
    await sleep(2500);
  }
  return last;
}

async function pollUntilSettled(flight, br, maxPolls = 30) {
  let last = { status: '', classified: 'Pending', polls: 0 };
  for (let i = 0; i < maxPolls; i += 1) {
    const st = await flight.getBookingStatus(br);
    const raw = String(st.data?.status || '');
    last = { status: raw, classified: classifyStatus(raw), polls: i + 1 };
    if (isSettled(raw)) return last;
    await sleep(3000);
  }
  return last;
}

function applyGst(payload, pricingData) {
  if (pricingData?.addGstInfo === true) {
    payload.data.includeGst = true;
    payload.data.addGstInfo = true;
    payload.data.gstDetails = { ...GST };
    return;
  }
  payload.data.includeGst = false;
  payload.data.addGstInfo = false;
  payload.data.gstDetails = null;
}

function pickOwIds(searchData, limit = 6) {
  const all = (searchData?.results || []).flatMap((r) => r.options || []);
  const ids = all.map((o) => o.searchId).filter(Boolean);
  if (ids.length) return ids.slice(0, limit);
  const one = extractFirstSearchId(searchData);
  return one ? [one] : [];
}

async function resolveCandidates(flight, journeyType, origin, destination, onwardDays) {
  const travellers = { adults: ADULTS, children: CHILDREN, infants: INFANTS };
  if (journeyType === 'ROUND_TRIP') {
    const body = buildRoundTripSearchBody(onwardDays, onwardDays + 7, {
      origin,
      destination,
      fareType: 'NORMAL',
    });
    body.travellers = travellers;
    const rt = await flight.searchRoundTripUntilComplete(body);
    return {
      journeyType: 'ROUND_TRIP',
      candidates: rt.searchIds?.length >= 2 ? [rt.searchIds] : [],
      searchOk: Boolean(rt.searchIds?.length >= 2),
    };
  }
  const body = buildOneWaySearchBody(onwardDays, {
    origin,
    destination,
    fareType: 'NORMAL',
  });
  body.travellers = travellers;
  const search = await pollSearch(flight, body);
  const ids = search.ok ? pickOwIds(search.data, 6) : [];
  return {
    journeyType: 'ONE_WAY',
    candidates: ids.map((id) => [id]),
    searchOk: ids.length > 0,
    searchHttp: search?.status,
  };
}

async function attemptBook(flight, { journeyType, origin, destination, onwardDays, nameLag }) {
  const resolved = await resolveCandidates(flight, journeyType, origin, destination, onwardDays);
  if (!resolved.searchOk || !resolved.candidates.length) {
    return {
      ok: false,
      stage: 'search',
      route: `${origin}-${destination}`,
      days: onwardDays,
      searchHttp: resolved.searchHttp || null,
    };
  }

  let lastFail = null;
  for (const searchIds of resolved.candidates) {
    const pricing = await flight.getPricing(searchIds, resolved.journeyType);
    if (!pricing.ok || !pricing.data?.priceId || !pricing.data?.bookingContext) {
      lastFail = {
        ok: false,
        stage: 'pricing',
        pricingHttp: pricing?.status,
        pricingErr: pricing?.data?.error?.code || null,
      };
      continue;
    }

    const tag = uniqueTag();
    const passengers = buildPassengers({
      adults: ADULTS,
      children: CHILDREN,
      infants: INFANTS,
      uniqueNames: true,
      leadFirstName: 'Rohan',
      leadLastName: `Bhagat${tag}`.replace(/[^a-zA-Z]/g, '').slice(0, 16) || 'Bhagatx',
      nameIndex: nameLag,
      withPassport: false,
    });

    const payload = buildIssueTicketPayload({
      bookingContext: pricing.data.bookingContext,
      priceId: pricing.data.priceId,
      searchIds,
      journeyType: resolved.journeyType,
    });
    payload.data.passengers = passengers;
    payload.data.contact.email = `mpax.${Date.now()}.${nameLag}@travelvip.ai`;
    payload.data.passportType = pricing.data.passportType || 'NONE';
    applyGst(payload, pricing.data);

    const issue = await flight.issueTicketV2(payload);
    const br = issue.data?.bookingReference || issue.data?.bookingReferenceId || null;
    if (!br) {
      lastFail = {
        ok: false,
        stage: 'issue',
        issueHttp: issue.status,
        issueCode: issue.data?.error?.code || null,
        issueMsg: issue.data?.error?.message || null,
      };
      continue;
    }

    const settled = await pollUntilSettled(flight, br);
    return {
      ok: true,
      stage: 'booked',
      br,
      status: settled.classified,
      rawStatus: settled.status,
      polls: settled.polls,
      route: `${origin}-${destination}`,
      days: onwardDays,
      journeyType: resolved.journeyType,
      priceId: pricing.data.priceId,
      searchIds,
      pax: { adults: ADULTS, children: CHILDREN, infants: INFANTS },
      pricingTotal: pricing.data?.totalAmount ?? pricing.data?.pricing?.totalAmount ?? null,
      issueHttp: issue.status,
      duplicate: Boolean(issue.data?.duplicate),
    };
  }

  return lastFail || { ok: false, stage: 'unknown' };
}

const CASES = [
  {
    id: 'OW-MPAX',
    label: `OW ${ADULTS}ADT+${CHILDREN}CHD+${INFANTS}INF`,
    journeyType: 'ONE_WAY',
    routes: [
      { origin: 'BOM', destination: 'BLR', days: [33, 40] },
      { origin: 'DEL', destination: 'BOM', days: [35, 42] },
      { origin: 'BOM', destination: 'GOI', days: [37, 44] },
      { origin: 'DEL', destination: 'HYD', days: [39, 46] },
    ],
  },
  {
    id: 'RT-MPAX',
    label: `RT ${ADULTS}ADT+${CHILDREN}CHD+${INFANTS}INF`,
    journeyType: 'ROUND_TRIP',
    routes: [
      { origin: 'BOM', destination: 'BLR', days: [45, 52] },
      { origin: 'DEL', destination: 'BOM', days: [47, 54] },
      { origin: 'BOM', destination: 'GOI', days: [49, 56] },
    ],
  },
];

async function runCase(flight, caseSpec, nameBase) {
  const attempts = [];
  let nameLag = nameBase;

  async function tryRoutes(tag) {
    for (const route of caseSpec.routes) {
      for (const day of route.days) {
        nameLag += 1;
        console.log(`  [${tag}] ${caseSpec.id} ${route.origin}→${route.destination} +${day}d pax=${ADULTS}A${CHILDREN}C${INFANTS}I`);
        let attempt;
        try {
          attempt = await attemptBook(flight, {
            journeyType: caseSpec.journeyType,
            origin: route.origin,
            destination: route.destination,
            onwardDays: day,
            nameLag,
          });
        } catch (e) {
          attempt = { ok: false, stage: 'exception', error: String(e.message || e) };
        }
        attempts.push({ tag, ...attempt });
        if (attempt.ok && attempt.br && attempt.status === 'Confirmed') return attempt;
        if (attempt.ok && attempt.br && attempt.status === 'Inprogress') return attempt;
        console.log(
          `    -> ${attempt.stage} ${attempt.status || ''} ${attempt.br || ''} ${attempt.issueCode || ''} ${attempt.searchHttp || ''}`,
        );
      }
    }
    const lastBooked = [...attempts].reverse().find((a) => a.tag === tag && a.br);
    return lastBooked || null;
  }

  let first = await tryRoutes('try1');
  let retry = null;
  if (first && (first.status === 'Inprogress' || first.status === 'Failed')) {
    console.log(`  ${caseSpec.id} ${first.status} ${first.br} — retry once`);
    for (const r of caseSpec.routes) r.days = r.days.map((d) => d + 10);
    retry = await tryRoutes('retry');
  } else if (!first) {
    console.log(`  ${caseSpec.id} no book — retry +10d`);
    for (const r of caseSpec.routes) r.days = r.days.map((d) => d + 10);
    retry = await tryRoutes('retry');
  }

  const final = (retry && retry.status === 'Confirmed' ? retry : null)
    || (first && first.status === 'Confirmed' ? first : null)
    || retry
    || first;

  return {
    id: caseSpec.id,
    label: caseSpec.label,
    journeyType: caseSpec.journeyType,
    pax: { adults: ADULTS, children: CHILDREN, infants: INFANTS },
    br: final?.br || null,
    status: final?.status || null,
    route: final?.route || null,
    days: final?.days || null,
    pricingTotal: final?.pricingTotal ?? null,
    attempts,
    result:
      !final ? 'NOT TESTED'
        : final.status === 'Confirmed' ? 'PASS'
          : final.status === 'Inprogress' ? 'NOT TESTED'
            : final.status === 'Failed' ? 'BUG'
              : 'NOT TESTED',
  };
}

async function main() {
  clearSession();
  console.log('BASE', config.baseUrl || process.env.BASE_URL);
  console.log('PAX', { adults: ADULTS, children: CHILDREN, infants: INFANTS });
  const session = await authenticate(true);
  const flight = new FlightService(session.client);

  const rows = [];
  let nameBase = 200;
  for (const c of CASES) {
    console.log(`\n=== ${c.id}: ${c.label} ===`);
    const row = await runCase(flight, c, nameBase);
    nameBase += 50;
    rows.push(row);
    console.log(`=> ${row.id} ${row.result} BR=${row.br || '-'} status=${row.status || '-'} route=${row.route || '-'}`);
  }

  const summary = rows.reduce((acc, r) => {
    acc[r.result] = (acc[r.result] || 0) + 1;
    return acc;
  }, {});
  const report = {
    baseUrl: config.baseUrl || process.env.BASE_URL,
    at: new Date().toISOString(),
    pax: { adults: ADULTS, children: CHILDREN, infants: INFANTS },
    summary,
    rows,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nSUMMARY', summary);
  console.log('WROTE', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
