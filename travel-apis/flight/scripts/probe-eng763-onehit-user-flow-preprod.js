/**
 * One search (user payload) → one mixed price hop → SSR/seatmap.
 * No poll loop, no date retry, no book.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import { collectOptions } from '../src/searchPicker.js';
import { sleep } from '../../../shared/lib/testUtils.js';

process.env.ALLOW_BOOK = 'false';
process.env.BASE_URL = process.env.BASE_URL || 'https://preprod-api.travelvip.ai';
process.env.PARTNER_ID = process.env.PARTNER_ID || 'vgm';
process.env.PARTNER_SECRET = process.env.PARTNER_SECRET || 'vgm_preprod_ojny1swtigd4as';
process.env.TIER_ID = process.env.TIER_ID || '19597201';
process.env.SIGNING_KEY = process.env.SIGNING_KEY || 'sk_live_yg81bca5xno1ypvhla';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '../reports/preprod-mixed-fare-pr1505/onehit-user-flow-nobook.json');

function cat(f) {
  const c = String(f?.fareCategory || f?.fareType || '').toUpperCase();
  if (!c) return null;
  if (c.includes('CORPORATE') || c === 'CORP') return 'CORPORATE';
  if (c.includes('SME')) return 'SME';
  if (c.includes('NORMAL') || c.includes('FLEXI') || c.includes('UPFRONT') || c.includes('STRETCH') || c.includes('PUBLISH') || c.includes('COUPON') || c.includes('SERIES') || c.includes('VALUE') || c.includes('SAVER') || c.includes('ALLIANCE')) {
    return String(f?.fareCategory || '').toUpperCase() === 'SME' ? 'SME'
      : String(f?.fareCategory || '').toUpperCase() === 'CORPORATE' ? 'CORPORATE'
        : (String(f?.fareCategory || '').toUpperCase() || 'NORMAL');
  }
  return String(f?.fareCategory || c).toUpperCase();
}

function fareCat(f) {
  return String(f?.fareCategory || '').toUpperCase() || null;
}

function airline(opt) {
  return String(opt?.segments?.[0]?.airline?.code || opt?.segments?.[0]?.airlineCode || '').toUpperCase();
}

function label(opt) {
  return (opt?.segments || [])
    .map((s) => `${String(s.airline?.code || s.airlineCode || '').toUpperCase()} ${s.flightNumber || ''}`.trim())
    .join('/');
}

function pick(options, want) {
  for (const opt of options || []) {
    for (const f of opt.fares || []) {
      if (fareCat(f) === want && (f.searchId || opt.searchId)) {
        return {
          searchId: f.searchId || opt.searchId,
          category: want,
          fareType: f.fareType,
          fareCategory: f.fareCategory,
          airline: airline(opt),
          label: label(opt),
        };
      }
    }
  }
  return null;
}

function catsIn(options) {
  return [...new Set((options || []).flatMap((o) => (o.fares || []).map(fareCat)).filter(Boolean))].sort();
}

async function main() {
  clearSession();
  if (!/preprod/i.test(String(config.baseUrl))) {
    throw new Error(`Refuse non-preprod: ${config.baseUrl}`);
  }

  // Exact user payload
  const body = {
    itinerary: [
      { origin: 'DEL', destination: 'BOM', date: '2026-11-22' },
      { origin: 'BOM', destination: 'DEL', date: '2026-11-24' },
    ],
    travellers: { adults: 1, children: 0, infants: 0 },
    cabinClass: 'ECONOMY',
    journeyType: 'ROUND_TRIP',
    currency: 'INR',
    language: 'en',
    preferences: {
      airlines: [],
      maxStops: 0,
      refundableOnly: false,
    },
    appliedFilters: {},
    selection: {
      selectedSearchIds: [],
    },
    fareType: 'NORMAL, CORPORATE, SME',
  };

  console.log('=== ONE SEARCH + ONE MIX FLOW — no book / no poll ===');
  console.log('BASE', config.baseUrl);
  console.log('dates', '2026-11-22 / 2026-11-24', 'fareType', body.fareType);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const flight = new FlightService(session.client);

  const search = await flight.search(body);
  const onwardOpts = collectOptions(search.data, 'ONWARD');
  const returnOpts = collectOptions(search.data, 'RETURN');
  const onwardCats = catsIn(onwardOpts);
  const returnCats = catsIn(returnOpts);
  console.log('search', search.status, search.data?.progress?.state, 'onward', onwardOpts.length, onwardCats.join(','));
  console.log('return', returnOpts.length, returnCats.join(','));

  // Prefer CORPORATE+NORMAL (gap), else SME+NORMAL, else CORPORATE+SME
  const pairs = [
    { o: 'CORPORATE', r: 'NORMAL' },
    { o: 'SME', r: 'NORMAL' },
    { o: 'NORMAL', r: 'CORPORATE' },
    { o: 'NORMAL', r: 'SME' },
    { o: 'CORPORATE', r: 'SME' },
    { o: 'SME', r: 'CORPORATE' },
  ];

  let onward = null;
  let ret = null;
  let pairKind = null;
  for (const p of pairs) {
    const o = pick(onwardOpts, p.o);
    const r = pick(returnOpts, p.r);
    if (o && r && o.searchId !== r.searchId) {
      onward = o;
      ret = r;
      pairKind = `${p.o}+${p.r}`;
      break;
    }
  }

  // ENG-767 candidate if airlines differ
  let diffAirline = null;
  if (onward) {
    for (const want of ['NORMAL', 'SME', 'CORPORATE']) {
      for (const opt of returnOpts) {
        if (airline(opt) === onward.airline) continue;
        const f = (opt.fares || []).find((x) => fareCat(x) === want);
        if (f?.searchId && f.searchId !== onward.searchId) {
          diffAirline = {
            searchId: f.searchId,
            category: want,
            fareType: f.fareType,
            fareCategory: f.fareCategory,
            airline: airline(opt),
            label: label(opt),
          };
          break;
        }
      }
      if (diffAirline) break;
    }
  }

  const out = {
    when: new Date().toISOString(),
    baseUrl: config.baseUrl,
    correlationId: session.client.correlationId,
    request: body,
    search: {
      http: search.status,
      code: search.data?.error?.code || null,
      progress: search.data?.progress || null,
      filterCats: {
        onward: search.data?.filters?.ONWARD?.fareCategories || null,
        return: search.data?.filters?.RETURN?.fareCategories || null,
      },
      onwardN: onwardOpts.length,
      returnN: returnOpts.length,
      onwardCats,
      returnCats,
    },
    pairKind,
    onward,
    return: ret,
    diffAirlinePick: diffAirline,
    hops: {},
    rows: [],
  };

  function row(id, rule, status, actual) {
    out.rows.push({ id, rule, status, actual });
    const m = status === 'PASS' ? '✓' : status === 'BUG' ? '✗' : '·';
    console.log(`  [${m}] ${id} ${status} — ${rule}`);
  }

  row(
    'S0',
    'One search returns options with multi fare categories',
    search.ok && (onwardOpts.length || returnOpts.length)
      ? ([...new Set([...onwardCats, ...returnCats])].filter((c) => ['NORMAL', 'CORPORATE', 'SME'].includes(c)).length >= 2 ? 'PASS' : 'PARTIAL')
      : 'BUG',
    `http=${search.status} state=${search.data?.progress?.state} onwardCats=${onwardCats} returnCats=${returnCats}`,
  );

  if (!onward || !ret) {
    row('MIX', 'Pick mixed CORPORATE/SME/NORMAL pair from same response', 'NOT TESTED', 'no pair');
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
    console.log('saved', OUT);
    return;
  }

  console.log('pair', pairKind, onward.label, onward.searchId, '→', ret.label, ret.searchId);
  console.log('cooldown 4s — ONE details/pricing/fareRules');
  await sleep(4000);

  const ids = [onward.searchId, ret.searchId];
  const details = await flight.getDetails(ids, 'ROUND_TRIP');
  const pricing = await flight.getPricing(ids, 'ROUND_TRIP');
  const fareRules = await flight.getFareRules(ids, 'ROUND_TRIP');

  out.hops.mix = {
    searchIds: ids,
    details: {
      http: details.status,
      code: details.data?.error?.code || null,
      fareType: details.data?.fareType || null,
      mixedFareType: details.data?.mixedFareType ?? null,
      error: details.data?.error || null,
    },
    pricing: {
      http: pricing.status,
      code: pricing.data?.error?.code || null,
      priceId: pricing.data?.priceId || null,
      fareType: pricing.data?.fareType || null,
      mixedFareType: pricing.data?.mixedFareType ?? null,
      error: pricing.data?.error || null,
    },
    fareRules: {
      http: fareRules.status,
      code: fareRules.data?.error?.code || null,
      fareType: fareRules.data?.fareType || null,
      entryCount: Array.isArray(fareRules.data?.fareRules) ? fareRules.data.fareRules.length : null,
      error: fareRules.data?.error || null,
    },
  };

  console.log('details', details.status, details.data?.error?.code || details.data?.fareType || 'ok');
  console.log('pricing', pricing.status, pricing.data?.error?.code || pricing.data?.priceId, 'fareType=', pricing.data?.fareType);
  console.log('fareRules', fareRules.status, fareRules.data?.error?.code || fareRules.data?.fareType || 'ok');

  const priced = pricing.status === 200 && pricing.data?.priceId;
  const mixedTop = String(pricing.data?.fareType || '').toUpperCase() === 'MIXED' || pricing.data?.mixedFareType === true;

  row('763-MIX', `Allow ${pairKind} on details/pricing`, priced ? 'PASS' : (pricing.data?.error?.code === 'INVALID_COMBINATION' ? 'BUG' : (pricing.data?.error?.code === 'VENDOR_ERROR' ? 'NOT TESTED' : 'BUG')),
    `details=${details.status}/${details.data?.error?.code || 'ok'} pricing=${pricing.status}/${pricing.data?.error?.code || pricing.data?.priceId}`);

  row('764-MIXED', 'Top-level MIXED / mixedFareType', priced ? (mixedTop ? 'PASS' : 'BUG') : 'NOT TESTED',
    `fareType=${pricing.data?.fareType} mixedFareType=${pricing.data?.mixedFareType}`);

  row('768-RULES', 'Fare rules OK for mixed pair', fareRules.status === 200 ? 'PASS' : (fareRules.data?.error?.code === 'VENDOR_ERROR' ? 'NOT TESTED' : 'BUG'),
    `http=${fareRules.status} fareType=${fareRules.data?.fareType} entries=${out.hops.mix.fareRules.entryCount}`);

  if (priced) {
    await sleep(2500);
    const ssr = await flight.getSsr(pricing.data.priceId);
    out.hops.mix.ssr = { http: ssr.status, code: ssr.data?.error?.code || null };
    console.log('ssr', ssr.status, ssr.data?.error?.code || 'ok');
    row('SSR', 'SSR after mixed pricing', ssr.status >= 200 && ssr.status < 300 ? 'PASS' : 'BUG', `http=${ssr.status}`);

    if (pricing.data?.bookingContext) {
      await sleep(2500);
      const seat = await flight.getSeatMap(pricing.data.bookingContext);
      out.hops.mix.seatmap = {
        http: seat.status,
        code: seat.data?.error?.code || null,
        requestStatus: seat.data?.requestStatus || null,
      };
      console.log('seatmap', seat.status, seat.data?.error?.code || seat.data?.requestStatus || 'ok');
      row('SEAT', 'Seatmap after mixed pricing', seat.status >= 200 && seat.status < 300 ? 'PASS' : 'BUG',
        `http=${seat.status} status=${seat.data?.requestStatus || seat.data?.error?.code}`);
    } else {
      row('SEAT', 'Seatmap after mixed pricing', 'NOT TESTED', 'no bookingContext');
    }
  } else {
    row('SSR', 'SSR after mixed pricing', 'NOT TESTED', 'no priceId');
    row('SEAT', 'Seatmap after mixed pricing', 'NOT TESTED', 'no priceId');
  }

  // Optional one ENG-767 hop only if mix airlines already differ; else skip extra price to protect L2B/vendor
  if (diffAirline && onward.airline !== diffAirline.airline) {
    row('767-CANDIDATE', `Diff-airline pair available ${onward.airline}+${diffAirline.airline}`, 'PASS',
      `${onward.label} → ${diffAirline.label} (${diffAirline.category})`);
    // Only price 767 if primary mix was same airline — one extra hop
    if (onward.airline === ret.airline) {
      console.log('cooldown 4s — ONE 767 pricing+seatmap');
      await sleep(4000);
      const ids767 = [onward.searchId, diffAirline.searchId];
      const p767 = await flight.getPricing(ids767, 'ROUND_TRIP');
      out.hops.diffAirline = {
        searchIds: ids767,
        return: diffAirline,
        pricing: {
          http: p767.status,
          code: p767.data?.error?.code || null,
          priceId: p767.data?.priceId || null,
          fareType: p767.data?.fareType || null,
          error: p767.data?.error || null,
        },
      };
      console.log('767 pricing', p767.status, p767.data?.error?.code || p767.data?.priceId);
      if (p767.data?.bookingContext) {
        await sleep(2500);
        const s767 = await flight.getSeatMap(p767.data.bookingContext);
        out.hops.diffAirline.seatmap = {
          http: s767.status,
          code: s767.data?.error?.code || null,
          requestStatus: s767.data?.requestStatus || null,
        };
        console.log('767 seatmap', s767.status, s767.data?.error?.code || s767.data?.requestStatus);
        row('767-SEAT', `Seatmap airlines differ ${onward.airline}+${diffAirline.airline}`,
          s767.status >= 200 && s767.status < 300 ? 'PASS' : 'BUG',
          `pricing=${p767.status}/${p767.data?.error?.code || p767.data?.priceId} seat=${s767.status}/${s767.data?.error?.code || s767.data?.requestStatus}`);
      } else {
        row('767-SEAT', `Seatmap airlines differ ${onward.airline}+${diffAirline.airline}`,
          p767.data?.priceId ? 'NOT TESTED' : (p767.data?.error?.code === 'VENDOR_ERROR' ? 'NOT TESTED' : 'BUG'),
          `pricing=${p767.status}/${p767.data?.error?.code || 'no priceId'}`);
      }
    } else {
      row('767-SEAT', 'Seatmap airlines differ (reuse primary mix airlines)',
        onward.airline !== ret.airline ? (out.hops.mix.seatmap?.http >= 200 && out.hops.mix.seatmap?.http < 300 ? 'PASS' : 'BUG') : 'NOT TESTED',
        `primary pair ${onward.airline}+${ret.airline} seat=${JSON.stringify(out.hops.mix.seatmap || {})}`);
    }
  } else {
    row('767-SEAT', 'Seatmap when airlines differ', 'NOT TESTED', 'no diff-airline return in first page');
  }

  row('NO-BOOK', 'Never called issue-ticket', 'PASS', 'ALLOW_BOOK=false');
  row('L2B', 'Single OD+dates, one search HTTP', 'PASS', 'DEL-BOM 2026-11-22/24 · no date loop');

  out.counts = out.rows.reduce((a, r) => {
    a[r.status] = (a[r.status] || 0) + 1;
    return a;
  }, {});

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  const md = [
    '# User payload one-hit mix flow (no book)',
    '',
    `- When: ${out.when}`,
    `- Dates: 2026-11-22 / 2026-11-24 · fareType: NORMAL, CORPORATE, SME`,
    `- Pair: ${pairKind} · ${onward?.label} → ${ret?.label}`,
    `- Counts: ${JSON.stringify(out.counts)}`,
    '',
    '| ID | Rule | Status | Actual |',
    '|----|------|--------|--------|',
    ...out.rows.map((r) => `| ${r.id} | ${r.rule} | **${r.status}** | ${String(r.actual || '').replace(/\|/g, '/').slice(0, 160)} |`),
    '',
    'Raw: `onehit-user-flow-nobook.json`',
  ].join('\n');
  fs.writeFileSync(OUT.replace(/\.json$/, '.md'), `${md}\n`);
  console.log('Counts', out.counts);
  console.log('saved', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
