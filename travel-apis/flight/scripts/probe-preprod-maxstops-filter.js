/**
 * Flight search maxStops filter on preprod-api (prod-style vgm creds).
 * ONE route search session only (avoid L2b load). No book.
 *
 * Expected:
 *   maxStops=-1 → only 0-stop
 *   maxStops=0  → only 0-stop
 *   maxStops=1  → 0 and 1 stop
 *   maxStops=2  → 0, 1, and 2 stops (whatever exists ≤2)
 *
 *   $env:BASE_URL='https://preprod-api.travelvip.ai'
 *   node travel-apis/flight/scripts/probe-preprod-maxstops-filter.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { futureDate, sleep } from '../../../shared/lib/testUtils.js';
import { isSearchProgressComplete } from '../src/helpers.js';

process.env.BASE_URL = process.env.BASE_URL || 'https://preprod-api.travelvip.ai';
process.env.PARTNER_ID = process.env.PARTNER_ID || 'vgm';
process.env.PARTNER_SECRET = process.env.PARTNER_SECRET || 'vgm_preprod_ojny1swtigd4as';
process.env.SIGNING_KEY = process.env.SIGNING_KEY || 'sk_live_yg81bca5xno1ypvhla';
process.env.TIER_ID = process.env.TIER_ID || '19597201';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../reports', process.env.REPORT_OUT || 'preprod-maxstops-filter.json');

function collectStopCounts(data) {
  const out = [];
  const seen = new Set();
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (typeof o.totalStops === 'number' && (o.searchId || Array.isArray(o.segments))) {
      const id = o.searchId || `${o.totalStops}|${o.departureTime}|${o.arrivalTime}`;
      if (!seen.has(id)) {
        seen.add(id);
        out.push(o.totalStops);
      }
    }
    for (const v of Object.values(o)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') walk(v);
    }
  };
  walk(data);
  return out;
}

function hist(arr) {
  return arr.reduce((a, x) => {
    a[x] = (a[x] || 0) + 1;
    return a;
  }, {});
}

function expectedMax(filterVal) {
  // -1 and 0 both mean non-stop only per product ask
  if (filterVal === -1 || filterVal === 0) return 0;
  return filterVal;
}

function judge(filterVal, stops) {
  if (!stops.length) {
    return { status: 'BUG', note: 'no options returned' };
  }
  const max = Math.max(...stops);
  const min = Math.min(...stops);
  const allowMax = expectedMax(filterVal);
  const bad = stops.filter((s) => s > allowMax);
  if (bad.length) {
    return {
      status: 'BUG',
      note: `expected all stops ≤ ${allowMax}; got max=${max} hist=${JSON.stringify(hist(stops))}`,
    };
  }
  // soft: for 1/2, prefer seeing 0 present when inventory has it
  return {
    status: 'PASS',
    note: `n=${stops.length} hist=${JSON.stringify(hist(stops))} min=${min} max=${max} (≤${allowMax})`,
  };
}

async function main() {
  clearSession();
  console.log('BASE', process.env.BASE_URL, 'tier', process.env.TIER_ID);

  const session = await authenticate(true);
  const client = session.client;
  client.setPartnerKey(session.accessToken);

  const date = futureDate(Number(process.env.FLIGHT_DAYS || '35'));
  const origin = process.env.ORIGIN || 'DEL';
  const destination = process.env.DEST || 'BOM';

  function makeBody({ maxStops = null, appliedFilters = {}, timingReference = null } = {}) {
    const body = {
      journeyType: 'ONE_WAY',
      itinerary: [{ origin, destination, date }],
      travellers: { adults: 1, children: 0, infants: 0 },
      cabinClass: 'ECONOMY',
      currency: 'INR',
      language: 'en',
      preferences: { airlines: [], maxStops, refundableOnly: false },
      appliedFilters,
      selection: { selectedSearchIds: [] },
      fareType: 'NORMAL',
    };
    if (timingReference) body.timingReference = timingReference;
    return body;
  }

  async function search(body, { maxPolls = 8 } = {}) {
    let last = null;
    for (let i = 0; i < maxPolls; i += 1) {
      last = await client.request({
        method: 'POST',
        path: '/v1/flights/search',
        query: { page: 0, perpage: 50, currency: 'INR', lang: 'en' },
        body,
      });
      if (last.status !== 200) return last;
      if (isSearchProgressComplete(last.data)) return last;
      await sleep(2500);
    }
    return last;
  }

  const rows = [];
  function add(row) {
    rows.push(row);
    console.log(`[${row.status}] ${row.id} — ${row.note}`);
  }

  // 1) Single warm / baseline search (ONE flight)
  const warm = await search(makeBody({ maxStops: null }));
  const timing = warm.data?.timingReference || null;
  const warmStops = collectStopCounts(warm.data);
  const warmFacet = warm.data?.filters?.ONWARD?.stops || null;
  add({
    id: 'WARM',
    rule: `ONE unfiltered search ${origin}→${destination}`,
    status: warm.status === 200 && warmStops.length ? 'PASS' : 'BUG',
    note: `HTTP ${warm.status} n=${warmStops.length} hist=${JSON.stringify(hist(warmStops))} facet=${JSON.stringify(warmFacet)}`,
    http: warm.status,
    hist: hist(warmStops),
    facet: warmFacet,
  });

  // 2) Apply preferences.maxStops on same route (+ timingReference to reuse cache when possible)
  for (const v of [-1, 0, 1, 2]) {
    const res = await search(makeBody({ maxStops: v, timingReference: timing }));
    const stops = collectStopCounts(res.data);
    const j = res.status === 200 ? judge(v, stops) : { status: 'BUG', note: `HTTP ${res.status} code=${res.data?.error?.code}` };
    add({
      id: `PREF_${v}`,
      rule: `preferences.maxStops=${v} → stops ≤ ${expectedMax(v)}`,
      status: j.status,
      note: j.note,
      http: res.status,
      hist: hist(stops),
      facet: res.data?.filters?.ONWARD?.stops || null,
      applied: { preferences: { maxStops: v } },
    });
  }

  // 3) Also try appliedFilters.ONWARD.stops (facet-style) if product uses that path
  const afCases = [
    { id: 'AF_NS', rule: 'appliedFilters.ONWARD.stops=["Non-Stop"] → 0 only', value: ['Non-Stop'], allowMax: 0 },
    { id: 'AF_0', rule: 'appliedFilters.ONWARD.stops=[0] → 0 only', value: [0], allowMax: 0 },
    { id: 'AF_01', rule: 'appliedFilters.ONWARD.stops=[0,1] → ≤1', value: [0, 1], allowMax: 1 },
    { id: 'AF_M1', rule: 'appliedFilters.ONWARD.stops=[-1] → 0 only', value: [-1], allowMax: 0 },
  ];
  for (const cs of afCases) {
    const res = await search(makeBody({
      appliedFilters: { ONWARD: { stops: cs.value } },
      timingReference: timing,
    }));
    const stops = collectStopCounts(res.data);
    let status = 'BUG';
    let note = '';
    if (res.status !== 200) {
      note = `HTTP ${res.status} code=${res.data?.error?.code}`;
    } else if (!stops.length) {
      status = 'BUG';
      note = `n=0 hist={} (filter shape may be ignored/empty)`;
    } else {
      const bad = stops.filter((s) => s > cs.allowMax);
      if (bad.length) {
        note = `expected ≤${cs.allowMax}; hist=${JSON.stringify(hist(stops))}`;
      } else {
        status = 'PASS';
        note = `n=${stops.length} hist=${JSON.stringify(hist(stops))}`;
      }
    }
    add({
      id: cs.id,
      rule: cs.rule,
      status,
      note,
      http: res.status,
      hist: hist(stops),
      applied: { ONWARD: { stops: cs.value } },
    });
  }

  const counts = rows.reduce((a, r) => {
    a[r.status] = (a[r.status] || 0) + 1;
    return a;
  }, {});

  const report = {
    at: new Date().toISOString(),
    baseUrl: process.env.BASE_URL,
    route: { origin, destination, date },
    timingReferenceUsed: Boolean(timing),
    note: 'Single route only; preferences.maxStops primary; appliedFilters.ONWARD.stops secondary. No book.',
    counts,
    rows,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nCOUNTS', counts);
  console.log('Wrote', OUT);
  if ((counts.BUG || 0) > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
