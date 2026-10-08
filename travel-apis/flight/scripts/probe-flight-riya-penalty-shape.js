/**
 * Compare live flight PENALTY response vs legacy RIYA vendor shape
 * (type/requestStatus/totalPenalityAmount/provider/items/...).
 *
 *   FLIGHT_ISSUE_PID=vgm node scripts/probe-flight-riya-penalty-shape.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import { FLIGHT_QUERY } from '../src/helpers.js';

const OUT = 'reports/flight-riya-penalty-shape-canary.json';

/** Exact keys from the sample the user provided */
const EXPECTED_TOP = [
  'type', 'retryCount', 'data', 'requestStatus', 'qTime', 'status',
];
const EXPECTED_DATA = [
  'provider', 'action', 'airlineCodes', 'bookingId',
  'totalPenalityAmount', 'totalBookingAmount', 'penalityPercentage',
  'status', 'items', 'partial', 'successCount', 'failedCount',
];
const EXPECTED_ITEM = ['bookingId', 'penalty', 'status'];
const EXPECTED_PENALTY = ['penalityAmount', 'totalBookingAmount', 'penalityPercentage'];

const BRS = (process.env.BRS || [
  'BR1786569663376690', // CORP RT 2ADT IX latest
  'BR1786569524287412', // CORP RT 2ADT IX
  'BR1786563217861941', // CORP RT 3ADT IX
].join(',')).split(',').map((s) => s.trim()).filter(Boolean);

function has(obj, key) {
  return obj != null && Object.prototype.hasOwnProperty.call(obj, key);
}

function shapeCheck(body) {
  const data = body?.data && !body?.data?.cancellationRequest ? body.data : null;
  const cr = body?.data?.cancellationRequest || body?.cancellationRequest || null;
  const topHits = EXPECTED_TOP.filter((k) => has(body, k));
  const topMiss = EXPECTED_TOP.filter((k) => !has(body, k));
  const dataHits = data ? EXPECTED_DATA.filter((k) => has(data, k)) : [];
  const dataMiss = data ? EXPECTED_DATA.filter((k) => !has(data, k)) : EXPECTED_DATA.slice();

  const firstItem = Array.isArray(data?.items) ? data.items[0] : null;
  const itemHits = firstItem ? EXPECTED_ITEM.filter((k) => has(firstItem, k)) : [];
  const pen = firstItem?.penalty;
  const penHits = pen ? EXPECTED_PENALTY.filter((k) => has(pen, k)) : [];

  const legacyScore = {
    top: `${topHits.length}/${EXPECTED_TOP.length}`,
    data: `${dataHits.length}/${EXPECTED_DATA.length}`,
    item: `${itemHits.length}/${EXPECTED_ITEM.length}`,
    penalty: `${penHits.length}/${EXPECTED_PENALTY.length}`,
  };

  const isLegacyExact =
    topMiss.length === 0
    && dataHits.length === EXPECTED_DATA.length
    && itemHits.length === EXPECTED_ITEM.length
    && penHits.length === EXPECTED_PENALTY.length
    && String(data?.provider || '').toUpperCase() === 'RIYA'
    && String(data?.action || '').toUpperCase() === 'PENALTY';

  const isNewEnvelope = Boolean(cr) || Boolean(body?.statusMessage);

  return {
    isLegacyExact,
    isNewEnvelope,
    legacyScore,
    topHits,
    topMiss,
    dataHits,
    dataMiss,
    itemHits,
    penHits,
    provider: data?.provider || null,
    action: data?.action || cr ? 'via cancellationRequest' : null,
    hasRequestStatus: has(body, 'requestStatus'),
    hasTotalPenalityAmount: has(data, 'totalPenalityAmount') || has(body, 'totalPenalityAmount'),
    hasCancellationRequest: Boolean(cr),
    cancellationRequestKeys: cr ? Object.keys(cr) : [],
    bodyTopKeys: Object.keys(body || {}),
  };
}

async function cancelCall(client, br, body, path) {
  return client.request({
    method: 'POST',
    path,
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
  console.log('Goal: does PENALTY return legacy RIYA shape?');

  const results = [];

  for (const br of BRS) {
    console.log(`\n=== ${br} ===`);
    const detail = await flight.getBookingDetail(br);
    const status = detail.data?.status;
    const it = detail.data?.bookingResponse?.itinerary || [];
    const legs = it.map((l) => ({
      direction: l.direction,
      pnr: l.pnr,
      airline: l.segments?.[0]?.airline?.code || l.segments?.[0]?.marketingAirline,
      stops: l.totalStops,
    }));
    console.log('status', status, 'legs', JSON.stringify(legs));

    if (!/confirm/i.test(String(status || ''))) {
      results.push({ br, skip: 'not Confirmed', status, legs });
      continue;
    }

    const pnr = legs.find((l) => l.pnr)?.pnr;
    const variants = [
      {
        label: 'v1 PENALTY retryCount only',
        path: `/v1/flights/booking/${br}/cancel`,
        body: { action: 'PENALTY', retryCount: 1 },
      },
      {
        label: 'v1 PENALTY + pnr',
        path: `/v1/flights/booking/${br}/cancel`,
        body: { action: 'PENALTY', retryCount: 1, pnr, cancellationReason: 'RIYA shape probe' },
      },
      {
        label: 'v2 PENALTY + pnr',
        path: `/api/v2/flight/cancel`,
        body: {
          bookingReference: br,
          action: 'PENALTY',
          retryCount: 1,
          pnr,
          cancellationReason: 'RIYA shape probe v2',
        },
      },
    ];

    for (const v of variants) {
      if (v.body.pnr === undefined && /pnr/i.test(v.label)) continue;
      if (/pnr/i.test(v.label) && !pnr) {
        console.log(v.label, 'skip — no pnr');
        continue;
      }
      const res = await cancelCall(client, br, v.body, v.path);
      const check = shapeCheck(res.data);
      console.log(
        v.label,
        'http', res.status,
        'legacyExact', check.isLegacyExact,
        'newEnvelope', check.isNewEnvelope,
        'score', JSON.stringify(check.legacyScore),
        'topKeys', check.bodyTopKeys.join(','),
      );
      results.push({
        br,
        bookingStatus: status,
        legs,
        variant: v.label,
        path: v.path,
        request: v.body,
        http: res.status,
        shape: check,
        response: res.data,
      });
    }
  }

  const anyLegacy = results.some((r) => r.shape?.isLegacyExact);
  const anyPartialLegacy = results.some((r) => r.shape?.hasRequestStatus && r.shape?.hasTotalPenalityAmount);
  const anyNew = results.some((r) => r.shape?.isNewEnvelope || r.shape?.hasCancellationRequest);

  const summary = {
    verdict: anyLegacy
      ? 'PASS — live PENALTY matches legacy RIYA shape'
      : anyPartialLegacy
        ? 'PARTIAL — some legacy fields present, not exact sample'
        : anyNew
          ? 'NOT MATCHING — API returns new cancellationRequest envelope (not vendor RIYA raw shape)'
          : 'UNKNOWN — no usable PENALTY response',
    anyLegacyExact: anyLegacy,
    anyPartialLegacy,
    anyNewEnvelope: anyNew,
  };

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    expectedSampleKeys: { EXPECTED_TOP, EXPECTED_DATA, EXPECTED_ITEM, EXPECTED_PENALTY },
    summary,
    results,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== VERDICT ===');
  console.log(summary.verdict);
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
