/**
 * Staging validation matrix: DOB (ADT/CHD/INF) + passport issue/expiry.
 *
 * Expected:
 *  - Adult 12+, Child 2–12, Infant 0–2 (relative to departure)
 *  - 2-day buffer: infant up to 2y+2d, child up to 12y+2d
 *  - Intl passport expiry >= returnDate + 6 months (RT) / departure + 6 months (OW)
 *  - Passport issue date not in future / not after expiry
 *
 * Negative cases only book if validation is MISSING (bug). Any accidental
 * Confirmed booking is cancelled immediately.
 *
 *   BASE_URL=https://api-staging.travelvip.ai node scripts/probe-pax-passport-validation-matrix.js
 */
import { writeFileSync } from 'fs';
import { authenticate } from '../../../../shared/lib/authService.js';
import { FlightService } from '../../src/service.js';
import {
  buildOneWaySearchBody,
  buildRoundTripSearchBody,
  extractOnwardSearchIds,
  extractReturnSearchId,
  extractSearchIds,
} from '../../src/helpers.js';
import { config } from '../../../../shared/config/env.js';
import { addDays, formatDate } from '../../../../shared/lib/testUtils.js';
import {
  mattermostConfigured,
  waitForVendorAlert,
} from './lib/mattermostVendorAlerts.js';

const FLIGHT_QUERY = { lang: 'en', currency: 'INR' };

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ymd(d) {
  return formatDate(d);
}

function parseYmd(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** DOB such that on travelDate the person is exactly years + extraDays old. */
function dobAtAge(travelDateStr, years, extraDays = 0) {
  const t = parseYmd(travelDateStr);
  const dob = new Date(t);
  dob.setFullYear(dob.getFullYear() - years);
  dob.setDate(dob.getDate() - extraDays);
  return ymd(dob);
}

function addMonths(dateStr, months) {
  const d = parseYmd(dateStr);
  d.setMonth(d.getMonth() + months);
  return ymd(d);
}

function brOf(data) {
  return (
    data?.bookingReference
    || data?.bookingReferenceId
    || data?.data?.bookingReference
    || null
  );
}

function errMsg(data) {
  const details =
    data?.error?.details
    || data?.details
    || data?.errors
    || data?.error?.errors
    || data?.validationErrors
    || data?.error?.validationErrors;
  const base =
    data?.error?.message
    || data?.message
    || data?.error?.code
    || (Array.isArray(data?.errors) && data.errors[0]?.message)
    || null;
  if (base && details) {
    return `${base} | ${JSON.stringify(details).slice(0, 400)}`;
  }
  return base || JSON.stringify(data)?.slice(0, 400);
}

function mkPax({
  paxId,
  type,
  isLead,
  dob,
  firstName,
  lastName,
  title = 'Mr',
  gender = 'Male',
  passport = null,
}) {
  return {
    paxId,
    type,
    isLead,
    profile: {
      title: type === 'child' || type === 'infant' ? (gender === 'Female' ? 'Miss' : 'Mstr') : title,
      firstName,
      lastName,
      gender,
      dob,
      nationality: 'IN',
    },
    city: { cityCode: 'DEL', cityName: 'Delhi' },
    passport: passport || {
      number: null,
      expiry: null,
      issuedDate: null,
      issuedCountryCode: null,
    },
    ssr: { baggage: [], meals: [], seats: [] },
  };
}

function validPassport(depDate, retDate, { monthsAfter = 6, extraDays = 10 } = {}) {
  const anchor = retDate || depDate;
  const expiry = ymd(addDays(parseYmd(addMonths(anchor, monthsAfter)), extraDays));
  const issuedDate = ymd(addDays(parseYmd(depDate), -400));
  return {
    number: 'Z7654321',
    expiry,
    issuedDate,
    issuedCountryCode: 'IN',
  };
}

const results = [];

function record(row) {
  results.push(row);
  const mark =
    row.verdict === 'PASS'
      ? 'PASS'
      : row.verdict === 'BUG_MISSING_VALIDATION'
        ? 'BUG_MISSING'
        : row.verdict === 'BUG_FALSE_REJECT'
          ? 'BUG_REJECT'
          : row.verdict;
  console.log(
    `[${mark}] ${row.scenario} | expect=${row.expect} gotHttp=${row.http} | ${String(row.message || '').slice(0, 120)}`
  );
}

async function cancelIfBooked(flight, data) {
  const br = brOf(data);
  if (!br) return;
  try {
    await flight.cancelBooking(br, 2);
    console.log('  cancelled accidental BR', br);
  } catch (e) {
    console.log('  cancel failed', br, e.message?.slice(0, 80));
  }
}

async function prepareContext(flight, {
  journeyType,
  origin,
  destination,
  travellers,
  onwardDays = 40,
  returnDays = 47,
}) {
  let search;
  let searchIds;
  let depDate;
  let retDate = null;

  if (journeyType === 'ROUND_TRIP') {
    const body = buildRoundTripSearchBody(onwardDays, returnDays, {
      origin,
      destination,
      fareType: 'NORMAL',
      maxStops: null,
    });
    body.travellers = travellers;
    body.preferences.airlines = [];
    search = await flight.searchRoundTripUntilComplete(body);
    depDate = body.itinerary[0].date;
    retDate = body.itinerary[1].date;
    if (search.searchIds?.length >= 2) {
      searchIds = search.searchIds.slice(0, 2);
    } else {
      const onward = extractOnwardSearchIds(search.response?.data || search.data, 5);
      const ret = extractReturnSearchId(search.response?.data || search.data);
      if (onward?.[0] && ret) searchIds = [onward[0], ret];
      else {
        const ids = extractSearchIds(search.response?.data || search.data, 10);
        searchIds = ids.slice(0, 2);
      }
    }
  } else {
    const body = buildOneWaySearchBody(onwardDays, {
      origin,
      destination,
      fareType: 'NORMAL',
      maxStops: null,
    });
    body.travellers = travellers;
    body.preferences.airlines = [];
    search = await flight.searchUntilComplete(body);
    depDate = body.itinerary[0].date;
    const ids = search.searchIds?.length
      ? search.searchIds
      : extractSearchIds(search.response?.data || search.data, 8);
    searchIds = [ids[0]].filter(Boolean);
  }

  if (!searchIds?.length || searchIds.some((x) => !x)) {
    throw new Error(`No searchIds for ${journeyType} ${origin}-${destination}`);
  }

  let pricing = null;
  let used = null;
  if (journeyType === 'ROUND_TRIP') {
    const p = await flight.getPricing(searchIds, 'ROUND_TRIP');
    if (!p.ok) throw new Error(`RT pricing failed ${errMsg(p.data)}`);
    pricing = p;
    used = searchIds;
  } else {
    for (const sid of (search.searchIds || searchIds).slice(0, 8)) {
      const p = await flight.getPricing([sid], 'ONE_WAY');
      if (p.ok) {
        pricing = p;
        used = [sid];
        break;
      }
    }
    if (!pricing) throw new Error(`OW pricing failed`);
  }

  return {
    journeyType,
    origin,
    destination,
    travellers,
    depDate,
    retDate,
    searchIds: used,
    priceId: pricing.data.priceId,
    bookingContext: pricing.data.bookingContext,
    passportType: pricing.data.passportType || (origin === 'DEL' && destination === 'DXB' ? 'REGULAR' : 'NONE'),
  };
}

async function issue(client, ctx, passengers, passportType) {
  const body = {
    type: 'ticket',
    currency: 'INR',
    language: 'en',
    bookingReference: ctx.bookingContext,
    searchIds: ctx.searchIds,
    journeyType: ctx.journeyType,
    timezone: 'Asia/Calcutta',
    data: {
      priceId: ctx.priceId,
      passportType: passportType ?? ctx.passportType ?? 'NONE',
      includeGst: false,
      gstDetails: null,
      contact: {
        email: config.flight.contactEmail || 'qa.validation@example.com',
        mobile: config.flight.contactMobile || '9876543210',
        countryCode: config.flight.contactCountryCode || '+91',
      },
      passengers,
    },
  };

  return client.request({
    method: 'POST',
    path: '/v1/flights/booking/issue-ticket',
    query: {
      ...config.flight.issueTicketQuery,
      ...FLIGHT_QUERY,
      count: 10,
      page: 0,
      perpage: 20,
    },
    body,
    correlation: true,
    partnerKey: client.partnerKey,
  });
}

function classify(res, expect) {
  const http = res.status;
  const msg = errMsg(res.data);
  const booked = Boolean(brOf(res.data)) || /confirmed|inprogress|pending/i.test(JSON.stringify(res.data || {}));
  const infra =
    http === 500
    || /Failed to fetch flight pricing|pricing details|priceId.*(invalid|expired)|bookingContext.*(invalid|expired)|session.*(expired|invalid)/i.test(
      String(msg)
    );
  if (infra && !booked) {
    return { verdict: 'INFRA_PRICING_FAIL', http, message: msg, booked: false };
  }

  const rejected =
    !res.ok
    || http >= 400
    || /validat|invalid|passport|dob|birth|age|infant|child|adult|expir|issue/i.test(String(msg));

  if (expect === 'REJECT') {
    if (rejected && !booked) return { verdict: 'PASS', http, message: msg, booked: false };
    return {
      verdict: 'BUG_MISSING_VALIDATION',
      http,
      message: msg,
      booked,
    };
  }
  // expect ACCEPT — we treat HTTP 200 / booking start as accept; 400 as false reject
  if (rejected && !booked) {
    return { verdict: 'BUG_FALSE_REJECT', http, message: msg, booked: false };
  }
  return { verdict: 'PASS', http, message: msg, booked };
}

async function refreshPricing(flight, ctx) {
  const jt = ctx.journeyType;
  const p = await flight.getPricing(ctx.searchIds, jt);
  if (!p.ok) throw new Error(`refresh pricing failed: ${errMsg(p.data)}`);
  ctx.priceId = p.data.priceId;
  ctx.bookingContext = p.data.bookingContext;
  ctx.passportType = p.data.passportType || ctx.passportType;
  return ctx;
}

async function runCase(flight, client, ctx, {
  id,
  scenario,
  expect,
  passengers,
  passportType,
  allowBook = false,
}) {
  // Always refresh priceId/bookingContext so prior bookings don't poison later cases.
  try {
    await refreshPricing(flight, ctx);
  } catch (e) {
    record({
      id,
      scenario,
      expect,
      market: `${ctx.origin}-${ctx.destination}`,
      journeyType: ctx.journeyType,
      travellers: ctx.travellers,
      depDate: ctx.depDate,
      retDate: ctx.retDate,
      verdict: 'INFRA_PRICING_FAIL',
      http: 0,
      message: e.message,
      booked: false,
    });
    await sleep(400);
    return null;
  }

  const res = await issue(client, ctx, passengers, passportType ?? ctx.passportType);
  const c = classify(res, expect);
  const br = brOf(res.data);
  let vendorAlert = null;

  if (c.booked && br) {
    console.log(`  booking ${br} — checking vendor-alerts-dev...`);
    vendorAlert = await waitForVendorAlert({
      bookingReference: br,
      timeoutMs: Number(process.env.VENDOR_ALERT_TIMEOUT_MS || 45000),
      sinceMs: Date.now() - 120_000,
    });
    if (vendorAlert.found) {
      console.log(
        `  ALERT FOUND for ${br}:`,
        String(vendorAlert.matches[0]?.message || '').replace(/\s+/g, ' ').slice(0, 160)
      );
    } else if (vendorAlert.checked) {
      console.log(`  ALERT MISSING for ${br}:`, vendorAlert.reason || vendorAlert.error || 'not found');
    } else {
      console.log(`  ALERT SKIPPED:`, vendorAlert.reason);
    }
  }

  record({
    id,
    scenario,
    expect,
    market: `${ctx.origin}-${ctx.destination}`,
    journeyType: ctx.journeyType,
    travellers: ctx.travellers,
    depDate: ctx.depDate,
    retDate: ctx.retDate,
    passportTypeUsed: passportType ?? ctx.passportType,
    bookingReference: br || null,
    vendorAlert,
    rawSnippet: JSON.stringify(res.data)?.slice(0, 500),
    ...c,
  });
  if (c.booked) {
    await cancelIfBooked(flight, res.data);
    try {
      await refreshPricing(flight, ctx);
    } catch {
      /* next runCase will try again */
    }
  }
  await sleep(500);
  return c;
}

async function main() {
  console.log('Base:', config.baseUrl, '| pax DOB + passport validation matrix');
  console.log(
    'Vendor alerts:',
    mattermostConfigured()
      ? 'ON → https://team.scandid.in/scandid/channels/vendor-alerts-dev'
      : 'OFF (set MATTERMOST_TOKEN to poll vendor-alerts-dev after each booking)'
  );
  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const contexts = {};

  async function ctx(key, factory) {
    if (!contexts[key]) {
      console.log('\nPreparing context', key);
      contexts[key] = await factory();
      console.log(
        '  ready',
        key,
        contexts[key].depDate,
        contexts[key].retDate || '',
        'passportType',
        contexts[key].passportType,
        'searchIds',
        contexts[key].searchIds
      );
    }
    return contexts[key];
  }

  // ---------- Contexts ----------
  const domOwAdt = await ctx('DOM_OW_ADT', () =>
    prepareContext(flight, {
      journeyType: 'ONE_WAY',
      origin: 'DEL',
      destination: 'BOM',
      travellers: { adults: 1, children: 0, infants: 0 },
    })
  );

  const domOwFamily = await ctx('DOM_OW_FAMILY', () =>
    prepareContext(flight, {
      journeyType: 'ONE_WAY',
      origin: 'DEL',
      destination: 'BOM',
      travellers: { adults: 1, children: 1, infants: 1 },
      onwardDays: 42,
    })
  );

  const domRtAdt = await ctx('DOM_RT_ADT', () =>
    prepareContext(flight, {
      journeyType: 'ROUND_TRIP',
      origin: 'DEL',
      destination: 'BOM',
      travellers: { adults: 1, children: 0, infants: 0 },
      onwardDays: 43,
      returnDays: 50,
    })
  );

  const intlOwAdt = await ctx('INTL_OW_ADT', () =>
    prepareContext(flight, {
      journeyType: 'ONE_WAY',
      origin: 'DEL',
      destination: 'DXB',
      travellers: { adults: 1, children: 0, infants: 0 },
      onwardDays: 45,
    })
  );

  const intlRtAdt = await ctx('INTL_RT_ADT', () =>
    prepareContext(flight, {
      journeyType: 'ROUND_TRIP',
      origin: 'DEL',
      destination: 'DXB',
      travellers: { adults: 1, children: 0, infants: 0 },
      onwardDays: 46,
      returnDays: 53,
    })
  );

  const intlOwFamily = await ctx('INTL_OW_FAMILY', () =>
    prepareContext(flight, {
      journeyType: 'ONE_WAY',
      origin: 'DEL',
      destination: 'DXB',
      travellers: { adults: 1, children: 1, infants: 1 },
      onwardDays: 48,
    })
  );

  // ---------- DOB cases (domestic OW family context for type mismatch) ----------
  const dep = domOwFamily.depDate;

  const dobCases = [
    {
      id: 'DOB-INF-under2',
      scenario: 'Infant type age ~1y (valid INF)',
      expect: 'ACCEPT',
      type: 'infant',
      dob: dobAtAge(dep, 1, 0),
      allowBook: true,
    },
    {
      id: 'DOB-INF-exact2',
      scenario: 'Infant type exact 2y on dep (boundary)',
      expect: 'ACCEPT', // with buffer should still allow INF at exact 2y
      type: 'infant',
      dob: dobAtAge(dep, 2, 0),
      allowBook: true,
    },
    {
      id: 'DOB-INF-2y2d',
      scenario: 'Infant type 2y+2d (buffer edge)',
      expect: 'ACCEPT',
      type: 'infant',
      dob: dobAtAge(dep, 2, 2),
      allowBook: true,
    },
    {
      id: 'DOB-INF-2y3d',
      scenario: 'Infant type 2y+3d (beyond buffer → should REJECT)',
      expect: 'REJECT',
      type: 'infant',
      dob: dobAtAge(dep, 2, 3),
    },
    {
      id: 'DOB-CHD-exact2',
      scenario: 'Child type exact 2y (valid CHD)',
      expect: 'ACCEPT',
      type: 'child',
      dob: dobAtAge(dep, 2, 0),
      allowBook: true,
    },
    {
      id: 'DOB-CHD-under2',
      scenario: 'Child type age 1y (too young → REJECT)',
      expect: 'REJECT',
      type: 'child',
      dob: dobAtAge(dep, 1, 0),
    },
    {
      id: 'DOB-CHD-exact12',
      scenario: 'Child type exact 12y (boundary)',
      expect: 'ACCEPT',
      type: 'child',
      dob: dobAtAge(dep, 12, 0),
      allowBook: true,
    },
    {
      id: 'DOB-CHD-12y2d',
      scenario: 'Child type 12y+2d (buffer edge)',
      expect: 'ACCEPT',
      type: 'child',
      dob: dobAtAge(dep, 12, 2),
      allowBook: true,
    },
    {
      id: 'DOB-CHD-12y3d',
      scenario: 'Child type 12y+3d (beyond buffer → REJECT)',
      expect: 'REJECT',
      type: 'child',
      dob: dobAtAge(dep, 12, 3),
    },
    {
      id: 'DOB-ADT-exact12',
      scenario: 'Adult type exact 12y (valid ADT)',
      expect: 'ACCEPT',
      type: 'adult',
      dob: dobAtAge(dep, 12, 0),
      allowBook: true,
    },
    {
      id: 'DOB-ADT-under12',
      scenario: 'Adult type 11y (too young → REJECT)',
      expect: 'REJECT',
      type: 'adult',
      dob: dobAtAge(dep, 11, 0),
    },
    {
      id: 'DOB-ADT-11y364',
      scenario: 'Adult type 12y-1d (just under 12 → REJECT)',
      expect: 'REJECT',
      type: 'adult',
      dob: dobAtAge(dep, 12, -1),
    },
    {
      id: 'DOB-invalid',
      scenario: 'Invalid DOB string',
      expect: 'REJECT',
      type: 'adult',
      dob: 'invalid',
    },
    {
      id: 'DOB-future',
      scenario: 'Future DOB',
      expect: 'REJECT',
      type: 'infant',
      dob: ymd(addDays(new Date(), 30)),
    },
  ];

  console.log('\n===== DOB VALIDATION (DOM OW family / single mix) =====');
  for (const tc of dobCases) {
    // Build passengers matching family search when testing child/infant;
    // for adult-only rejection on adult type use single ADT context.
    let passengers;
    let useCtx = domOwFamily;
    let pType = 'NONE';

    if (tc.type === 'adult' && (tc.id.startsWith('DOB-ADT') || tc.id === 'DOB-invalid')) {
      useCtx = domOwAdt;
      passengers = [
        mkPax({
          paxId: 'PAX1',
          type: 'adult',
          isLead: true,
          dob: tc.dob,
          firstName: 'Rohit',
          lastName: 'Adult',
        }),
      ];
    } else if (tc.type === 'infant') {
      passengers = [
        mkPax({
          paxId: 'PAX1',
          type: 'adult',
          isLead: true,
          dob: dobAtAge(dep, 30, 0),
          firstName: 'Rohit',
          lastName: 'Adult',
        }),
        mkPax({
          paxId: 'PAX2',
          type: 'child',
          isLead: false,
          dob: dobAtAge(dep, 5, 0),
          firstName: 'Riya',
          lastName: 'Child',
          gender: 'Female',
        }),
        mkPax({
          paxId: 'PAX3',
          type: 'infant',
          isLead: false,
          dob: tc.dob,
          firstName: 'Aarav',
          lastName: 'Infant',
        }),
      ];
    } else if (tc.type === 'child') {
      passengers = [
        mkPax({
          paxId: 'PAX1',
          type: 'adult',
          isLead: true,
          dob: dobAtAge(dep, 30, 0),
          firstName: 'Rohit',
          lastName: 'Adult',
        }),
        mkPax({
          paxId: 'PAX2',
          type: 'child',
          isLead: false,
          dob: tc.dob,
          firstName: 'Riya',
          lastName: 'Child',
          gender: 'Female',
        }),
        mkPax({
          paxId: 'PAX3',
          type: 'infant',
          isLead: false,
          dob: dobAtAge(dep, 1, 0),
          firstName: 'Aarav',
          lastName: 'Infant',
        }),
      ];
    }

    await runCase(flight, client, useCtx, {
      id: tc.id,
      scenario: `${tc.scenario} dob=${tc.dob}`,
      expect: tc.expect,
      passengers,
      passportType: pType,
      allowBook: Boolean(tc.allowBook),
    });
  }

  // ---------- Passport cases INTL ----------
  console.log('\n===== PASSPORT VALIDATION (INTL) =====');

  const intlDep = intlOwAdt.depDate;
  const intlRet = intlRtAdt.retDate;

  const passportCases = [
    {
      id: 'PPT-OW-valid-6m',
      ctx: intlOwAdt,
      scenario: 'OW intl passport expiry dep+6m+10d (valid)',
      expect: 'ACCEPT',
      allowBook: true,
      passport: validPassport(intlOwAdt.depDate, null, { monthsAfter: 6, extraDays: 10 }),
    },
    {
      id: 'PPT-OW-exp-before-dep',
      ctx: intlOwAdt,
      scenario: 'OW intl expiry before departure (REJECT)',
      expect: 'REJECT',
      passport: {
        number: 'Z7654321',
        expiry: ymd(addDays(parseYmd(intlDep), -10)),
        issuedDate: ymd(addDays(parseYmd(intlDep), -800)),
        issuedCountryCode: 'IN',
      },
    },
    {
      id: 'PPT-OW-exp-lt-6m',
      ctx: intlOwAdt,
      scenario: 'OW intl expiry dep+5m (less than 6m → REJECT)',
      expect: 'REJECT',
      passport: {
        number: 'Z7654321',
        expiry: addMonths(intlDep, 5),
        issuedDate: ymd(addDays(parseYmd(intlDep), -800)),
        issuedCountryCode: 'IN',
      },
    },
    {
      id: 'PPT-OW-empty',
      ctx: intlOwAdt,
      scenario: 'OW intl empty passport (REJECT)',
      expect: 'REJECT',
      passport: {
        number: null,
        expiry: null,
        issuedDate: null,
        issuedCountryCode: null,
      },
    },
    {
      id: 'PPT-OW-issue-future',
      ctx: intlOwAdt,
      scenario: 'OW intl issuedDate in future (REJECT)',
      expect: 'REJECT',
      passport: {
        number: 'Z7654321',
        expiry: validPassport(intlDep).expiry,
        issuedDate: ymd(addDays(new Date(), 30)),
        issuedCountryCode: 'IN',
      },
    },
    {
      id: 'PPT-OW-issue-after-expiry',
      ctx: intlOwAdt,
      scenario: 'OW intl issuedDate after expiry (REJECT)',
      expect: 'REJECT',
      passport: {
        number: 'Z7654321',
        expiry: addMonths(intlDep, 8),
        issuedDate: addMonths(intlDep, 9),
        issuedCountryCode: 'IN',
      },
    },
    {
      id: 'PPT-RT-valid-6m-after-return',
      ctx: intlRtAdt,
      scenario: 'RT intl expiry return+6m+10d (valid)',
      expect: 'ACCEPT',
      allowBook: true,
      passport: validPassport(intlRtAdt.depDate, intlRtAdt.retDate, {
        monthsAfter: 6,
        extraDays: 10,
      }),
    },
    {
      id: 'PPT-RT-exp-before-return',
      ctx: intlRtAdt,
      scenario: 'RT intl expiry before return date (REJECT)',
      expect: 'REJECT',
      passport: {
        number: 'Z7654321',
        expiry: ymd(addDays(parseYmd(intlRet), -5)),
        issuedDate: ymd(addDays(parseYmd(intlRtAdt.depDate), -800)),
        issuedCountryCode: 'IN',
      },
    },
    {
      id: 'PPT-RT-exp-lt-6m-after-return',
      ctx: intlRtAdt,
      scenario: 'RT intl expiry return+5m (REJECT <6m after return)',
      expect: 'REJECT',
      passport: {
        number: 'Z7654321',
        expiry: addMonths(intlRet, 5),
        issuedDate: ymd(addDays(parseYmd(intlRtAdt.depDate), -800)),
        issuedCountryCode: 'IN',
      },
    },
    {
      id: 'PPT-RT-exp-exactly-6m',
      ctx: intlRtAdt,
      scenario: 'RT intl expiry exactly return+6m (boundary)',
      expect: 'ACCEPT',
      allowBook: true,
      passport: {
        number: 'Z7654321',
        expiry: addMonths(intlRet, 6),
        issuedDate: ymd(addDays(parseYmd(intlRtAdt.depDate), -800)),
        issuedCountryCode: 'IN',
      },
    },
    {
      id: 'PPT-DOM-garbage-ignored',
      ctx: domOwAdt,
      scenario: 'DOM OW with bad passport fields (often ignored when passportType NONE)',
      expect: 'ACCEPT', // if NONE, may accept; if validated, note as behavior
      allowBook: true,
      passportType: 'NONE',
      passport: {
        number: 'BAD',
        expiry: '1990-01-01',
        issuedDate: '2099-01-01',
        issuedCountryCode: 'IN',
      },
    },
  ];

  for (const tc of passportCases) {
    const c = tc.ctx;
    const passengers = [
      mkPax({
        paxId: 'PAX1',
        type: 'adult',
        isLead: true,
        dob: dobAtAge(c.depDate, 30, 0),
        firstName: 'Rohit',
        lastName: 'PassTest',
        passport: tc.passport,
      }),
    ];
    await runCase(flight, client, c, {
      id: tc.id,
      scenario: tc.scenario,
      expect: tc.expect,
      passengers,
      passportType: tc.passportType || c.passportType || 'FULL',
      allowBook: Boolean(tc.allowBook),
    });
  }

  // Multi-pax intl: child/infant passport required?
  console.log('\n===== MULTI-PAX INTL passport presence =====');
  const famDep = intlOwFamily.depDate;
  await runCase(flight, client, intlOwFamily, {
    id: 'PPT-FAM-child-missing',
    scenario: 'INTL family child missing passport (REJECT)',
    expect: 'REJECT',
    passportType: intlOwFamily.passportType || 'FULL',
    passengers: [
      mkPax({
        paxId: 'PAX1',
        type: 'adult',
        isLead: true,
        dob: dobAtAge(famDep, 30, 0),
        firstName: 'Rohit',
        lastName: 'Adult',
        passport: validPassport(famDep),
      }),
      mkPax({
        paxId: 'PAX2',
        type: 'child',
        isLead: false,
        dob: dobAtAge(famDep, 5, 0),
        firstName: 'Riya',
        lastName: 'Child',
        gender: 'Female',
        passport: {
          number: null,
          expiry: null,
          issuedDate: null,
          issuedCountryCode: null,
        },
      }),
      mkPax({
        paxId: 'PAX3',
        type: 'infant',
        isLead: false,
        dob: dobAtAge(famDep, 1, 0),
        firstName: 'Aarav',
        lastName: 'Infant',
        passport: validPassport(famDep),
      }),
    ],
  });

  // DOM RT DOB adult underage
  console.log('\n===== DOM RT DOB =====');
  await runCase(flight, client, domRtAdt, {
    id: 'DOB-DOM-RT-ADT-under12',
    scenario: 'DOM RT adult under 12 (REJECT)',
    expect: 'REJECT',
    passportType: 'NONE',
    passengers: [
      mkPax({
        paxId: 'PAX1',
        type: 'adult',
        isLead: true,
        dob: dobAtAge(domRtAdt.depDate, 10, 0),
        firstName: 'Rohit',
        lastName: 'Young',
      }),
    ],
  });

  const summary = {
    ranAt: new Date().toISOString(),
    env: config.baseUrl,
    contexts: Object.fromEntries(
      Object.entries(contexts).map(([k, v]) => [
        k,
        {
          depDate: v.depDate,
          retDate: v.retDate,
          journeyType: v.journeyType,
          market: `${v.origin}-${v.destination}`,
          passportType: v.passportType,
        },
      ])
    ),
    totals: {
      total: results.length,
      PASS: results.filter((r) => r.verdict === 'PASS').length,
      BUG_MISSING_VALIDATION: results.filter((r) => r.verdict === 'BUG_MISSING_VALIDATION').length,
      BUG_FALSE_REJECT: results.filter((r) => r.verdict === 'BUG_FALSE_REJECT').length,
      INFRA_PRICING_FAIL: results.filter((r) => r.verdict === 'INFRA_PRICING_FAIL').length,
    },
    results,
  };

  writeFileSync(
    'reports/pax-passport-validation-matrix-staging.json',
    JSON.stringify(summary, null, 2)
  );
  console.log('\n===== SUMMARY =====');
  console.log(JSON.stringify(summary.totals, null, 2));
  console.log('Bugs missing validation:');
  for (const r of results.filter((x) => x.verdict === 'BUG_MISSING_VALIDATION')) {
    console.log('-', r.id, r.scenario, '|', String(r.message).slice(0, 180));
  }
  console.log('False rejects:');
  for (const r of results.filter((x) => x.verdict === 'BUG_FALSE_REJECT')) {
    console.log('-', r.id, r.scenario, '|', String(r.message).slice(0, 180));
  }
  console.log('Infra pricing fails:');
  for (const r of results.filter((x) => x.verdict === 'INFRA_PRICING_FAIL')) {
    console.log('-', r.id, r.scenario, '|', String(r.message).slice(0, 180));
  }
  const withAlerts = results.filter((r) => r.vendorAlert?.checked);
  if (withAlerts.length) {
    console.log('Vendor alerts (bookings):');
    for (const r of withAlerts) {
      console.log(
        '-',
        r.bookingReference,
        r.vendorAlert.found ? 'FOUND' : 'MISSING',
        String(r.vendorAlert.matches?.[0]?.message || r.vendorAlert.reason || '').replace(/\s+/g, ' ').slice(0, 140)
      );
    }
  }
  console.log('Wrote reports/pax-passport-validation-matrix-staging.json');
}

main().catch((e) => {
  console.error(e);
  writeFileSync(
    'reports/pax-passport-validation-matrix-staging.json',
    JSON.stringify({ error: e.message, results }, null, 2)
  );
  process.exit(1);
});
