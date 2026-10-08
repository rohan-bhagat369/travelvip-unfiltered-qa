/**
 * Clone BR1786567148753429 scenario:
 * OW connecting DEL→BOM (prefer IX via GOX), 2ADT → PENALTY
 * Check if partner API returns legacy RIYA shape
 * (provider/totalPenalityAmount/bookingId/items) or new cancellationRequest.
 *
 *   FLIGHT_ISSUE_PID=vgm node scripts/book-ow-ix-connecting-2adt-penalty-shape.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  analyzeFlightOptions,
  buildOneWaySearchBody,
  buildIssueTicketPayload,
  buildPassengerProfile,
  isTerminalBookingStatus,
  isSearchProgressComplete,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = 'reports/book-ow-ix-connecting-2adt-penalty-shape.json';
const SOURCE = {
  br: 'BR1786567148753429',
  route: 'DEL-BOM',
  flights: ['IX 1049 DEL→GOX', 'IX 1209 GOX→BOM'],
  date: '2026-09-06',
  adults: 2,
  total: 4788,
  vendorSample: {
    provider: 'RIYA',
    bookingId: 'BX13HH0048',
    totalBookingAmount: '4788',
    totalPenalityAmount: '1000',
  },
};

const GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

const LEGACY_TOP = ['type', 'retryCount', 'data', 'requestStatus', 'qTime', 'status'];
const LEGACY_DATA = [
  'provider', 'action', 'airlineCodes', 'bookingId',
  'totalPenalityAmount', 'totalBookingAmount', 'penalityPercentage',
  'items', 'partial', 'successCount', 'failedCount',
];

function brief(d, n = 1200) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

function has(o, k) {
  return o != null && Object.prototype.hasOwnProperty.call(o, k);
}

function classifyPenalty(body) {
  const data = body?.data;
  const cr = data?.cancellationRequest || body?.cancellationRequest;
  const legacyHits = {
    top: LEGACY_TOP.filter((k) => has(body, k)),
    data: LEGACY_DATA.filter((k) => has(data, k)),
  };
  return {
    kind: cr
      ? 'NEW_cancellationRequest'
      : (has(body, 'requestStatus') && has(data, 'totalPenalityAmount'))
        ? 'LEGACY_RIYA_shape'
        : has(body, 'error')
          ? 'ERROR'
          : 'OTHER',
    hasProviderRiya: String(data?.provider || '').toUpperCase() === 'RIYA',
    hasBookingId: has(data, 'bookingId'),
    hasTotalPenalityAmount: has(data, 'totalPenalityAmount'),
    hasRequestStatus: has(body, 'requestStatus'),
    hasCancellationRequest: Boolean(cr),
    legacyHits,
    topKeys: Object.keys(body || {}),
    dataKeys: data && typeof data === 'object' ? Object.keys(data) : [],
  };
}

function isIxGoxConnecting(opt) {
  const segs = opt.segments || [];
  if (segs.length < 2) return false;
  const codes = segs.map((s) => s.airline?.code || s.airlineCode || '').join('|');
  const route = segs.map((s) => `${s.departure?.airportCode}→${s.arrival?.airportCode}`).join(',');
  const ix = /IX/i.test(codes);
  const gox = /GOX/i.test(route) || segs.some((s) => s.arrival?.airportCode === 'GOX' || s.departure?.airportCode === 'GOX');
  return ix && (gox || true); // prefer GOX but accept any IX connecting DEL-BOM
}

function optionMeta(opt) {
  return {
    searchId: opt.searchId,
    totalStops: opt.totalStops,
    flights: (opt.segments || []).map((s) => ({
      flight: `${s.airline?.code || ''} ${s.flightNumber || ''}`.trim(),
      route: `${s.departure?.airportCode}→${s.arrival?.airportCode}`,
      dep: s.departure?.time,
    })),
  };
}

function build2Adt(tag) {
  const people = [
    { title: 'Mr', firstName: 'Kabir', lastName: 'Mehta', gender: 'Male', dob: '1988-05-12' },
    { title: 'Mrs', firstName: 'Ananya', lastName: 'Mehta', gender: 'Female', dob: '1990-10-03' },
  ];
  return people.map((p, i) => {
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
    query: { ...FLIGHT_QUERY, ...config.flight.issueTicketQuery },
    body,
    correlation: true,
    partnerKey: client.partnerKey,
  });
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  console.log('Base', config.baseUrl);
  console.log('Clone source', SOURCE.br, SOURCE.flights.join(' | '), 'total', SOURCE.total);

  // Also re-hit PENALTY on SOURCE BR for comparison
  const sourcePenalty = await cancelCall(client, SOURCE.br, {
    action: 'PENALTY',
    retryCount: 1,
    pnr: 'V1SPWC',
    cancellationReason: 'source recheck',
  });
  console.log('\nSOURCE PENALTY http', sourcePenalty.status, classifyPenalty(sourcePenalty.data).kind);
  console.log(brief(sourcePenalty.data, 800));

  const dayOffsets = [24, 25, 26, 27, 28, 30, 32, 35];
  const fareTypes = ['NORMAL', 'CORPORATE'];
  let booked = null;
  const attempts = [];

  outer:
  for (const fareType of fareTypes) {
    for (const days of dayOffsets) {
      console.log(`\n=== Search OW ${fareType} DEL→BOM +${days}d IX connecting ===`);
      const body = buildOneWaySearchBody(days, {
        origin: 'DEL',
        destination: 'BOM',
        fareType,
        maxStops: null,
      });
      body.travellers = { adults: 2, children: 0, infants: 0 };
      body.preferences = { airlines: ['IX'], maxStops: null, refundableOnly: false };

      let data = null;
      for (let i = 0; i < 16; i += 1) {
        const res = await flight.search(body);
        data = res.data;
        const cx = analyzeFlightOptions(data, 'ONWARD').connectingCount;
        if (cx > 0 && (isSearchProgressComplete(data) || i >= 5)) break;
        if (isSearchProgressComplete(data) && !cx) break;
        await sleep(data?.progress?.pollAfterMs || 3000);
      }

      const block = (data?.results || []).find((r) => r.direction === 'ONWARD') || data?.results?.[0];
      const opts = (block?.options || []).filter((o) => {
        const stops = o.totalStops ?? 0;
        const segs = o.segments?.length ?? 0;
        return (stops > 0 || segs > 1) && isIxGoxConnecting(o);
      });
      // Prefer exact IX1049/IX1209 or GOX layover
      opts.sort((a, b) => {
        const score = (o) => {
          const f = JSON.stringify(optionMeta(o));
          let s = 0;
          if (/1049/.test(f)) s += 5;
          if (/1209/.test(f)) s += 5;
          if (/GOX/.test(f)) s += 3;
          return -s;
        };
        return score(a) - score(b);
      });

      console.log('IX connecting options', opts.length);
      if (!opts.length) {
        attempts.push({ fareType, days, skip: 'no IX connecting' });
        continue;
      }

      for (const opt of opts.slice(0, 4)) {
        const meta = optionMeta(opt);
        console.log('try', JSON.stringify(meta.flights));
        const pricing = await flight.getPricing([opt.searchId], 'ONE_WAY');
        if (!pricing.data?.priceId || !pricing.data?.bookingContext) {
          console.log('pricing fail', brief(pricing.data, 200));
          attempts.push({ fareType, days, stage: 'pricing', err: brief(pricing.data, 200) });
          continue;
        }
        const total = pricing.data?.pricing?.totalAmount ?? pricing.data?.totalAmount;
        const addGst = pricing.data?.addGstInfo === true;
        console.log('price', total, 'addGst', addGst);

        const tag = String(Date.now()).slice(-4);
        const payload = buildIssueTicketPayload({
          bookingContext: pricing.data.bookingContext,
          priceId: pricing.data.priceId,
          searchIds: [opt.searchId],
          journeyType: 'ONE_WAY',
        });
        payload.data.passengers = build2Adt(tag);
        if (addGst) {
          payload.data.includeGst = true;
          payload.data.gstDetails = { ...GST };
        }

        const issue = await client.request({
          method: 'POST',
          path: '/api/v2/flights/booking/issue-ticket',
          query: { ...FLIGHT_QUERY, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 },
          body: payload,
          correlation: true,
          partnerKey: client.partnerKey,
        });
        const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
        console.log('issue', issue.status, br || brief(issue.data, 250));
        if (!br) {
          attempts.push({ fareType, days, stage: 'issue', err: brief(issue.data, 250) });
          continue;
        }

        let status = issue.data?.status;
        for (let i = 0; i < 16; i += 1) {
          const st = await flight.getBookingStatus(br);
          status = st.data?.status || status;
          console.log('status', i + 1, status);
          if (isTerminalBookingStatus(status)) break;
          await sleep(3500);
        }
        if (!/confirm/i.test(String(status))) {
          attempts.push({ fareType, days, br, status });
          continue;
        }

        const detail = await flight.getBookingDetail(br);
        const it = detail.data?.bookingResponse?.itinerary || [];
        const pnr = it.find((x) => x.pnr)?.pnr;
        const segs = it.flatMap((l) => l.segments || []);
        const pax = detail.data?.bookingResponse?.passengers || [];
        const etickets = pax.flatMap((p) => (p.legs || []).map((l) => l.eticket)).filter(Boolean);

        booked = {
          br,
          status,
          fareType,
          days,
          date: body.itinerary[0].date,
          pnr,
          total: detail.data?.bookingResponse?.salesSummary?.totalAmount ?? total,
          flights: segs.map((s) => `${s.airline?.code || s.airlineCode || ''} ${s.flightNumber} ${s.departure?.airportCode}→${s.arrival?.airportCode}`.trim()),
          etickets,
          vendorPnrsHint: etickets.map((e) => String(e).replace(/(\d)-\d$/, '$1').replace(/1-\d$/, '')),
        };
        break outer;
      }
    }
  }

  const penaltyRuns = [];
  if (booked?.br && booked?.pnr) {
    console.log('\n=== PENALTY probes on new BR', booked.br, booked.pnr);
    const variants = [
      { label: 'PENALTY + pnr retryCount=1', body: { action: 'PENALTY', retryCount: 1, pnr: booked.pnr, cancellationReason: 'riya shape clone' } },
      { label: 'PENALTY + pnr type=cancel', body: { type: 'cancel', action: 'PENALTY', retryCount: 1, pnr: booked.pnr } },
      { label: 'PENALTY only action', body: { action: 'PENALTY', retryCount: 1, pnr: booked.pnr } },
    ];
    for (const v of variants) {
      const res = await cancelCall(client, booked.br, v.body);
      const cls = classifyPenalty(res.data);
      console.log(v.label, 'http', res.status, 'kind', cls.kind, 'keys', cls.topKeys.join(','));
      penaltyRuns.push({
        label: v.label,
        request: v.body,
        http: res.status,
        classification: cls,
        response: res.data,
      });
    }
  }

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    source: SOURCE,
    sourcePenalty: {
      http: sourcePenalty.status,
      classification: classifyPenalty(sourcePenalty.data),
      response: sourcePenalty.data,
    },
    booked,
    attempts,
    penaltyRuns,
    conclusion: (() => {
      const kinds = [
        classifyPenalty(sourcePenalty.data).kind,
        ...penaltyRuns.map((p) => p.classification.kind),
      ];
      if (kinds.includes('LEGACY_RIYA_shape')) {
        return 'FOUND legacy RIYA shape on partner PENALTY API';
      }
      if (kinds.includes('NEW_cancellationRequest')) {
        return 'Partner PENALTY returns NEW cancellationRequest envelope. Legacy RIYA JSON (provider/bookingId/totalPenalityAmount) is vendor-raw — not returned to partner API clients.';
      }
      return `No clear match. kinds=${kinds.join(',')}`;
    })(),
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== BOOKED ===');
  console.log(JSON.stringify(booked || { error: 'no confirm' }, null, 2));
  console.log('\n=== CONCLUSION ===');
  console.log(report.conclusion);
  console.log('Report', OUT);
  if (!booked) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
