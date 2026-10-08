/**
 * Compare fareRules cancellation/change amounts across different-priced flights
 * for QP (Akasa), IX (Air India Express), 6E (IndiGo), SG (SpiceJet)
 * on domestic + international routes.
 *
 *   BASE_URL=https://api-staging.travelvip.ai node scripts/probe-fare-rules-cancel-change-by-price.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../../shared/lib/authService.js';
import { FlightService } from '../../src/service.js';
import { buildOneWaySearchBody } from '../../src/helpers.js';
import { config } from '../../../../shared/config/env.js';

const AIRLINES = [
  { code: 'SG', name: 'SpiceJet' },
  { code: '6E', name: 'IndiGo' },
  { code: 'IX', name: 'Air India Express' },
  { code: 'QP', name: 'Akasa' },
];

const ROUTES = [
  { label: 'DOMESTIC', origin: 'DEL', destination: 'BOM', days: [35, 45, 55] },
  { label: 'DOMESTIC', origin: 'BOM', destination: 'BLR', days: [40] },
  { label: 'INTERNATIONAL', origin: 'DEL', destination: 'DXB', days: [35, 45, 60] },
  { label: 'INTERNATIONAL', origin: 'BOM', destination: 'DXB', days: [40] },
];

function money(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function optionFare(opt) {
  return money(
    opt?.displayPricing?.pricing?.totalAmount
    ?? opt?.pricing?.totalAmount
    ?? opt?.totalAmount
    ?? opt?.fare?.totalAmount,
  );
}

function airlineOf(opt) {
  return String(opt?.segments?.[0]?.airline?.code || '').toUpperCase();
}

function flightOf(opt) {
  return opt?.segments?.[0]?.flightNumber || null;
}

/** Extract INR fee lines related to cancel/change from fare rule text. */
function extractFeeBlocks(fareRules = []) {
  const full = (fareRules || []).map((r) => `${r.title || ''}\n${r.text || ''}`).join('\n\n');
  const lines = full.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const cancelSection = [];
  const changeSection = [];
  let mode = null;

  for (const line of lines) {
    if (/cancel|refund|penalt/i.test(line) && !/change|amend|modif/i.test(line)) mode = 'cancel';
    else if (/flight\s*change|change\s*fee|reissue|amend|modif|date\s*change|reschedul/i.test(line)) mode = 'change';

    const amounts = [...line.matchAll(/(?:INR|Rs\.?|₹)\s*([0-9][0-9,]*(?:\.[0-9]+)?)/gi)]
      .map((m) => Number(String(m[1]).replace(/,/g, '')))
      .filter((n) => Number.isFinite(n));

    if (!amounts.length) continue;
    const entry = { line, amounts };
    if (mode === 'cancel') cancelSection.push(entry);
    else if (mode === 'change') changeSection.push(entry);
  }

  // Also capture percentage-based rules
  const pct = [...full.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => Number(m[1]));

  return {
    cancelFees: uniqueAmounts(cancelSection.flatMap((x) => x.amounts)),
    changeFees: uniqueAmounts(changeSection.flatMap((x) => x.amounts)),
    cancelLines: cancelSection.slice(0, 8).map((x) => x.line),
    changeLines: changeSection.slice(0, 8).map((x) => x.line),
    percentages: [...new Set(pct)].sort((a, b) => a - b),
    ruleTitles: (fareRules || []).map((r) => r.title),
    textFingerprint: fingerprint(full),
    textPreview: full.slice(0, 600).replace(/\s+/g, ' ').trim(),
  };
}

function uniqueAmounts(arr) {
  return [...new Set(arr)].sort((a, b) => a - b);
}

function fingerprint(text) {
  // Normalize whitespace; keep fee-ish content for equality checks
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/INR\s*([0-9,]+(?:\.[0-9]+)?)/gi, (_, n) => `INR ${n}`)
    .trim()
    .slice(0, 1500);
}

function pickDiverseByPrice(options, max = 3) {
  const sorted = [...options]
    .map((o) => ({ o, fare: optionFare(o) }))
    .filter((x) => x.fare != null)
    .sort((a, b) => a.fare - b.fare);

  if (!sorted.length) return options.slice(0, max).map((o) => ({ o, fare: optionFare(o) }));

  const picks = [];
  const idxs = [0, Math.floor((sorted.length - 1) / 2), sorted.length - 1];
  for (const i of idxs) {
    const cand = sorted[i];
    if (!cand) continue;
    if (picks.some((p) => p.o.searchId === cand.o.searchId)) continue;
    // Prefer distinct fares when available
    if (picks.some((p) => p.fare === cand.fare) && sorted.length > picks.length + 1) {
      const alt = sorted.find((s) => !picks.some((p) => p.o.searchId === s.o.searchId || p.fare === s.fare));
      if (alt) {
        picks.push(alt);
        continue;
      }
    }
    picks.push(cand);
    if (picks.length >= max) break;
  }
  return picks.slice(0, max);
}

async function searchAirlineOptions(flight, route, airline, day) {
  const body = buildOneWaySearchBody(day, {
    origin: route.origin,
    destination: route.destination,
    fareType: 'NORMAL',
    maxStops: null,
  });
  body.preferences.airlines = [airline.code];
  try {
    const search = await flight.searchUntilComplete(body);
    const opts = (search.response?.data?.results || [])
      .flatMap((r) => r.options || [])
      .filter((o) => airlineOf(o) === airline.code);
    return opts;
  } catch (e) {
    return { error: e.message };
  }
}

async function main() {
  console.log('Base URL:', config.baseUrl);
  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const flight = new FlightService(session.client);

  const rows = [];

  for (const route of ROUTES) {
    for (const airline of AIRLINES) {
      console.log(`\n======== ${route.label} ${route.origin}-${route.destination} | ${airline.code} ${airline.name} ========`);
      let options = [];
      let searchError = null;

      for (const day of route.days) {
        const res = await searchAirlineOptions(flight, route, airline, day);
        if (res?.error) {
          searchError = res.error;
          console.log(`  search day+${day}: ERROR ${res.error}`);
          continue;
        }
        console.log(`  search day+${day}: ${res.length} options`);
        options = options.concat(res);
        if (options.length >= 3) break;
      }

      // de-dupe by searchId
      const byId = new Map();
      for (const o of options) {
        if (o?.searchId) byId.set(o.searchId, o);
      }
      options = [...byId.values()];

      if (!options.length) {
        rows.push({
          scope: route.label,
          route: `${route.origin}-${route.destination}`,
          airline: airline.code,
          airlineName: airline.name,
          status: 'NO_FLIGHTS',
          error: searchError,
        });
        continue;
      }

      const picks = pickDiverseByPrice(options, 3);
      console.log('  picked fares', picks.map((p) => ({ flight: flightOf(p.o), fare: p.fare })));

      const samples = [];
      for (const pick of picks) {
        const fr = await flight.getFareRules([pick.o.searchId], 'ONE_WAY');
        const fees = extractFeeBlocks(fr.data?.fareRules || []);
        const sample = {
          searchId: pick.o.searchId,
          flight: flightOf(pick.o),
          fareTotal: pick.fare,
          http: fr.status,
          ok: fr.ok,
          error: fr.data?.error ? `${fr.data.error.code}: ${fr.data.error.message}` : null,
          ...fees,
        };
        samples.push(sample);
        console.log(
          `  ${sample.flight} fare=${sample.fareTotal} cancel=[${sample.cancelFees}] change=[${sample.changeFees}] titles=${JSON.stringify(sample.ruleTitles)}`,
        );
      }

      const fares = samples.map((s) => s.fareTotal).filter((x) => x != null);
      const distinctFares = new Set(fares).size;
      const cancelSets = samples.map((s) => JSON.stringify(s.cancelFees));
      const changeSets = samples.map((s) => JSON.stringify(s.changeFees));
      const fpSets = samples.map((s) => s.textFingerprint);
      const cancelVaries = new Set(cancelSets).size > 1;
      const changeVaries = new Set(changeSets).size > 1;
      const textVaries = new Set(fpSets).size > 1;

      const summary = {
        scope: route.label,
        route: `${route.origin}-${route.destination}`,
        airline: airline.code,
        airlineName: airline.name,
        status: 'OK',
        flightsChecked: samples.length,
        fares,
        distinctFareCount: distinctFares,
        cancelFeesByFlight: samples.map((s) => ({ flight: s.flight, fare: s.fareTotal, cancelFees: s.cancelFees, cancelLines: s.cancelLines })),
        changeFeesByFlight: samples.map((s) => ({ flight: s.flight, fare: s.fareTotal, changeFees: s.changeFees, changeLines: s.changeLines })),
        cancelFeesVaryWithPrice: cancelVaries,
        changeFeesVaryWithPrice: changeVaries,
        fareRuleTextVaries: textVaries,
        sameCancelAcrossDifferentFares: distinctFares > 1 && !cancelVaries,
        sameChangeAcrossDifferentFares: distinctFares > 1 && !changeVaries,
        samples,
      };
      rows.push(summary);
      console.log(
        `  >> cancelVary=${cancelVaries} changeVary=${changeVaries} textVary=${textVaries} distinctFares=${distinctFares}`,
      );
    }
  }

  const report = {
    ranAt: new Date().toISOString(),
    env: config.baseUrl,
    question: 'Do cancellation/change prices in fareRules change for different-priced flights?',
    airlines: AIRLINES,
    routes: ROUTES.map((r) => `${r.label} ${r.origin}-${r.destination}`),
    rows,
    verdict: buildVerdict(rows),
  };

  fs.mkdirSync('reports/flight', { recursive: true });
  const outPath = path.join('reports/flight', 'fare-rules-cancel-change-by-price.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log('\n\n========== VERDICT ==========');
  console.log(JSON.stringify(report.verdict, null, 2));
  console.log('\nReport:', outPath);
}

function buildVerdict(rows) {
  const usable = rows.filter((r) => r.status === 'OK' && r.distinctFareCount > 1);
  const cancelSame = usable.filter((r) => r.sameCancelAcrossDifferentFares);
  const changeSame = usable.filter((r) => r.sameChangeAcrossDifferentFares);
  const cancelVary = usable.filter((r) => r.cancelFeesVaryWithPrice);
  const changeVary = usable.filter((r) => r.changeFeesVaryWithPrice);

  return {
    groupsWithMultipleFares: usable.length,
    cancelSameAcrossDifferentFares: cancelSame.map((r) => `${r.scope} ${r.route} ${r.airline}`),
    changeSameAcrossDifferentFares: changeSame.map((r) => `${r.scope} ${r.route} ${r.airline}`),
    cancelVariesWithPrice: cancelVary.map((r) => `${r.scope} ${r.route} ${r.airline}`),
    changeVariesWithPrice: changeVary.map((r) => `${r.scope} ${r.route} ${r.airline}`),
    noFlights: rows.filter((r) => r.status === 'NO_FLIGHTS').map((r) => `${r.scope} ${r.route} ${r.airline}`),
    summaryText:
      usable.length === 0
        ? 'Could not compare — not enough differently priced flights found.'
        : cancelVary.length === 0 && changeVary.length === 0
          ? 'Cancellation and change fee amounts in fareRules did NOT change across differently priced flights for the tested airline/route groups (same fee schedule / text).'
          : `Some groups show varying fees: cancelVary=${cancelVary.length}, changeVary=${changeVary.length}.`,
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
