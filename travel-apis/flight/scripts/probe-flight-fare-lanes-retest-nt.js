/**
 * Fare Lanes — retest D-1/D-4/D-5/D-8/E-1/E-6 with full pagination.
 * Search → details/pricing/fareRules only. NO book.
 *
 *   BASE_URL=https://api-preprod.travelvip.ai node scripts/probe-flight-fare-lanes-retest-nt.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';
import {
  buildOneWaySearchBody,
  buildRoundTripSearchBody,
  isSearchProgressComplete,
} from '../src/helpers.js';
import { collectOptions } from '../src/searchPicker.js';
import { futureDate, sleep } from '../../../shared/lib/testUtils.js';

process.env.BASE_URL = process.env.BASE_URL || 'https://api-preprod.travelvip.ai';
process.env.PARTNER_ID = process.env.PARTNER_ID || 'vgm';
process.env.PARTNER_SECRET = process.env.PARTNER_SECRET || 'vgm_preprod_ojny1swtigd4as';
process.env.TIER_ID = process.env.TIER_ID || '19597201';
process.env.SIGNING_KEY = process.env.SIGNING_KEY || 'sk_live_yg81bca5xno1ypvhla';

const DAYS = Number(process.env.FARE_LANES_DAYS || '35');
const OUT = path.join('reports', 'flight-fare-lanes-retest-nt-api-preprod.json');
const OUT_MD = path.join('reports', 'flight-fare-lanes-retest-nt-api-preprod.md');

const rows = [];
function add(id, rule, status, detail = {}) {
  rows.push({ id, rule, status, ...detail });
  const m = status === 'PASS' ? '✓' : status === 'BUG' ? '✗' : '·';
  console.log(`  [${m}] ${id} ${status} — ${rule}`);
}

function errCode(res) {
  return res?.data?.error?.code || null;
}
function cat(f) {
  return String(f?.fareCategory || '').toUpperCase() || null;
}
function categoriesIn(options) {
  const set = new Set();
  for (const o of options || []) {
    for (const f of o.fares || []) {
      const c = cat(f);
      if (c) set.add(c);
    }
  }
  return [...set].sort();
}
function pickFareByCategory(options, category) {
  const want = String(category).toUpperCase();
  for (const opt of options || []) {
    for (const f of opt.fares || []) {
      if (cat(f) === want && (f.searchId || opt.searchId)) {
        return { opt, f, searchId: f.searchId || opt.searchId, category: want };
      }
    }
  }
  return null;
}
function facetCats(data, dir = 'ONWARD') {
  const block = data?.filters?.[dir] || {};
  const raw = block.fareCategories;
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((i) => ({
      value: String(i.value || i.name || '').toUpperCase(),
      count: Number(i.count ?? NaN),
    }));
  }
  return Object.entries(raw).map(([value, count]) => ({
    value: String(value).toUpperCase(),
    count: Number(count),
  }));
}

async function searchPage(client, body, { page = 0, perpage = 20 } = {}) {
  return client.request({
    method: 'POST',
    path: '/v1/flights/search',
    query: { lang: 'en', currency: 'INR', page, perpage, sortby: 'fare,asc' },
    body,
    correlation: true,
  });
}

async function waitSearch(client, body, { dir = 'ONWARD', max = 24 } = {}) {
  let last = null;
  for (let i = 0; i < max; i += 1) {
    last = await searchPage(client, body, { page: 0 });
    const opts = collectOptions(last?.data, dir);
    const st = last?.data?.progress || {};
    const done =
      isSearchProgressComplete(last?.data)
      || st.state === 'COMPLETE'
      || (st.lanesTotal != null && st.lanesReady != null && st.lanesReady >= st.lanesTotal);
    if (!last.ok && errCode(last) !== 'NO_FLIGHTS_FOUND') return last;
    if (last.ok && done && (opts.length || i >= 8)) return last;
    if (last.ok && opts.length && i >= 10) return last;
    await sleep(st.pollAfterMs || 2500);
  }
  return last;
}

/** Paginate ALL onward options after search is ready. */
async function paginateOnward(client, body, { maxPages = 40 } = {}) {
  const first = await waitSearch(client, body, { dir: 'ONWARD' });
  if (!first?.ok) return { ok: false, first, options: [], pages: 0, facet: [], total: null };
  const all = [];
  let page = 0;
  let total = null;
  let facet = facetCats(first.data);
  while (page < maxPages) {
    const res = page === 0 ? first : await searchPage(client, body, { page });
    if (!res.ok) break;
    const opts = collectOptions(res.data, 'ONWARD');
    if (page === 0) facet = facetCats(res.data);
    total =
      typeof res.data?.totalResults === 'number'
        ? res.data.totalResults
        : (res.data?.totalResults?.ONWARD ?? total);
    all.push(...opts);
    if (!opts.length) break;
    if (total != null && all.length >= total) break;
    if (opts.length < 20) break;
    page += 1;
  }
  return {
    ok: true,
    first,
    options: all,
    pages: page + 1,
    facet,
    total,
    page0Cats: categoriesIn(collectOptions(first.data, 'ONWARD')),
    allCats: categoriesIn(all),
  };
}

async function waitReturn(client, refined, { max = 20 } = {}) {
  let last = null;
  for (let i = 0; i < max; i += 1) {
    last = await searchPage(client, refined, { page: 0 });
    const ret = collectOptions(last?.data, 'RETURN');
    const done = isSearchProgressComplete(last?.data) || last?.data?.progress?.state === 'COMPLETE';
    if (last.ok && (ret.length || done) && (ret.length || i >= 6)) return last;
    await sleep(last?.data?.progress?.pollAfterMs || 2500);
  }
  return last;
}

async function main() {
  console.log('=== Fare Lanes NT retest (paginate onward, pricing OK, no book) ===');
  console.log('BASE', process.env.BASE_URL, 'days', DAYS);
  clearSession();
  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);
  const dumps = { at: new Date().toISOString(), base: process.env.BASE_URL };

  // ─── D-1: RT NORMAL,SME — pick SME from ALL onward pages ───────────────
  console.log('\n## D-1');
  {
    const base = buildRoundTripSearchBody(DAYS, DAYS + 7, {
      origin: 'DEL',
      destination: 'BOM',
      maxStops: null,
      fareType: 'NORMAL,SME',
    });
    const paged = await paginateOnward(client, base);
    dumps.D1_inventory = {
      total: paged.total,
      pages: paged.pages,
      n: paged.options.length,
      page0Cats: paged.page0Cats,
      allCats: paged.allCats,
      facet: paged.facet,
    };
    const sme = pickFareByCategory(paged.options, 'SME');
    if (!sme) {
      add('D-1', 'RT NORMAL,SME — select SME onward → both dirs SME', 'NOT TESTED', {
        expected: 'SME onward somewhere in pagination',
        actual: JSON.stringify(dumps.D1_inventory),
      });
    } else {
      const refined = { ...base, selection: { selectedSearchIds: [sme.searchId] } };
      const rr = await waitReturn(client, refined);
      const onwardCats = categoriesIn(collectOptions(rr?.data, 'ONWARD'));
      const returnCats = categoriesIn(collectOptions(rr?.data, 'RETURN'));
      const returnOpts = collectOptions(rr?.data, 'RETURN');
      dumps.D1 = {
        smeSid: sme.searchId,
        onwardCats,
        returnCats,
        returnN: returnOpts.length,
      };
      const ok =
        returnOpts.length > 0
        && onwardCats.every((c) => c === 'SME')
        && returnCats.every((c) => c === 'SME')
        && returnCats.length > 0;
      add('D-1', 'RT NORMAL,SME — select SME onward → both dirs SME', ok ? 'PASS' : 'BUG', {
        expected: 'ONWARD+RETURN only SME',
        actual: JSON.stringify(dumps.D1),
      });

      // same-category pricing (bonus for D-1 path)
      if (returnOpts.length) {
        const ret = pickFareByCategory(returnOpts, 'SME') || {
          searchId: returnOpts[0].fares?.[0]?.searchId || returnOpts[0].searchId,
        };
        const price = await flight.getPricing([sme.searchId, ret.searchId], 'ROUND_TRIP');
        dumps.D1_price = { http: price.status, code: errCode(price), priceId: price.data?.priceId };
        add('D-1-price', 'SME RT pair → pricing 200 (no book)', price.ok ? 'PASS' : 'BUG', {
          actual: JSON.stringify(dumps.D1_price),
        });
      }
    }
  }

  // ─── D-2: RT NORMAL,SME — pick NORMAL from ALL onward pages ─────────────
  console.log('\n## D-2');
  {
    const base = buildRoundTripSearchBody(DAYS, DAYS + 7, {
      origin: 'DEL',
      destination: 'BOM',
      maxStops: null,
      fareType: 'NORMAL,SME',
    });
    const paged = await paginateOnward(client, base);
    const normal = pickFareByCategory(paged.options, 'NORMAL');
    dumps.D2_inventory = {
      total: paged.total,
      pages: paged.pages,
      n: paged.options.length,
      page0Cats: paged.page0Cats,
      allCats: paged.allCats,
    };
    if (!normal) {
      add('D-2', 'RT — select NORMAL onward → both dirs NORMAL', 'NOT TESTED', {
        actual: JSON.stringify(dumps.D2_inventory),
      });
    } else {
      const refined = { ...base, selection: { selectedSearchIds: [normal.searchId] } };
      const rr = await waitReturn(client, refined);
      const onwardOpts = collectOptions(rr?.data, 'ONWARD');
      const returnOpts = collectOptions(rr?.data, 'RETURN');
      const onwardCats = categoriesIn(onwardOpts);
      const returnCats = categoriesIn(returnOpts);
      dumps.D2 = {
        sid: normal.searchId,
        http: rr?.status,
        code: errCode(rr),
        progress: rr?.data?.progress || null,
        onwardN: onwardOpts.length,
        returnN: returnOpts.length,
        onwardCats,
        returnCats,
      };
      const ok =
        returnOpts.length > 0
        && onwardCats.every((c) => c === 'NORMAL')
        && returnCats.every((c) => c === 'NORMAL')
        && returnCats.length > 0;
      add('D-2', 'RT — select NORMAL onward → both dirs NORMAL', ok ? 'PASS' : 'BUG', {
        expected: 'ONWARD+RETURN only NORMAL',
        actual: JSON.stringify(dumps.D2),
      });
      if (returnOpts.length) {
        const ret = pickFareByCategory(returnOpts, 'NORMAL') || {
          searchId: returnOpts[0].fares?.[0]?.searchId || returnOpts[0].searchId,
        };
        const price = await flight.getPricing([normal.searchId, ret.searchId], 'ROUND_TRIP');
        dumps.D6 = { http: price.status, code: errCode(price), priceId: price.data?.priceId };
        add('D-6', 'Same-category RT → pricing succeeds', price.ok ? 'PASS' : 'BUG', {
          expected: '200',
          actual: JSON.stringify(dumps.D6),
        });
      } else {
        add('D-6', 'Same-category RT → pricing succeeds', 'NOT TESTED', {
          actual: 'no NORMAL return after select',
        });
      }
    }
  }

  // ─── D-4 / D-5: CORPORATE onward from ALL pages + NORMAL return ────────
  console.log('\n## D-4 / D-5');
  {
    const base = buildRoundTripSearchBody(DAYS, DAYS + 7, {
      origin: 'DEL',
      destination: 'BOM',
      maxStops: null,
      fareType: 'NORMAL,SME,CORPORATE',
    });
    const paged = await paginateOnward(client, base);
    dumps.D4_inventory = {
      total: paged.total,
      pages: paged.pages,
      n: paged.options.length,
      page0Cats: paged.page0Cats,
      allCats: paged.allCats,
      facet: paged.facet,
    };
    const corp = pickFareByCategory(paged.options, 'CORPORATE');
    if (!corp) {
      add('D-4', 'Cross-category RT → pricing INVALID_COMBINATION', 'NOT TESTED', {
        actual: `no CORPORATE in ${paged.pages} pages / facet=${JSON.stringify(paged.facet)}`,
      });
      add('D-5', 'Cross pair → details + fareRules INVALID_COMBINATION', 'NOT TESTED', {
        actual: 'depends on D-4',
      });
    } else {
      // NORMAL return from a NORMAL RT flow
      const nBase = buildRoundTripSearchBody(DAYS, DAYS + 7, {
        origin: 'DEL',
        destination: 'BOM',
        maxStops: null,
        fareType: 'NORMAL',
      });
      const nPaged = await paginateOnward(client, nBase);
      const nOn = pickFareByCategory(nPaged.options, 'NORMAL');
      let normalRetSid = null;
      if (nOn) {
        const refinedN = { ...nBase, selection: { selectedSearchIds: [nOn.searchId] } };
        const rr = await waitReturn(client, refinedN);
        const retPick = pickFareByCategory(collectOptions(rr?.data, 'RETURN'), 'NORMAL');
        normalRetSid = retPick?.searchId
          || collectOptions(rr?.data, 'RETURN')[0]?.fares?.[0]?.searchId
          || collectOptions(rr?.data, 'RETURN')[0]?.searchId;
      }
      dumps.D4_ids = { corpSid: corp.searchId, normalRetSid };
      if (!normalRetSid) {
        add('D-4', 'Cross-category RT → pricing INVALID_COMBINATION', 'NOT TESTED', {
          actual: `have corp=${corp.searchId} but no NORMAL return`,
        });
        add('D-5', 'Cross pair → details + fareRules INVALID_COMBINATION', 'NOT TESTED');
      } else {
        const price = await flight.getPricing([corp.searchId, normalRetSid], 'ROUND_TRIP');
        dumps.D4 = { http: price.status, code: errCode(price), body: price.data?.error };
        add('D-4', 'Cross-category RT → pricing INVALID_COMBINATION', price.status === 400 && errCode(price) === 'INVALID_COMBINATION' ? 'PASS' : 'BUG', {
          expected: '400 INVALID_COMBINATION',
          actual: `http=${price.status} code=${errCode(price)}`,
          response: price.data?.error,
        });

        const det = await flight.getDetails([corp.searchId, normalRetSid], 'ROUND_TRIP');
        const rules = await flight.getFareRules([corp.searchId, normalRetSid], 'ROUND_TRIP');
        dumps.D5 = {
          details: { http: det.status, code: errCode(det) },
          rules: { http: rules.status, code: errCode(rules) },
        };
        const dOk = errCode(det) === 'INVALID_COMBINATION';
        const rOk = errCode(rules) === 'INVALID_COMBINATION';
        add('D-5', 'Cross pair → details + fareRules INVALID_COMBINATION', dOk && rOk ? 'PASS' : 'BUG', {
          expected: 'INVALID_COMBINATION both',
          actual: `details=${det.status}/${errCode(det)} rules=${rules.status}/${errCode(rules)}`,
        });
      }
    }
  }

  // ─── D-8: Intl RT DEL→DXB — paginate onward, wait return, price ────────
  console.log('\n## D-8');
  {
    const base = buildRoundTripSearchBody(DAYS + 5, DAYS + 12, {
      origin: 'DEL',
      destination: 'DXB',
      maxStops: null,
      fareType: 'NORMAL',
    });
    // try a couple date bumps if return empty
    let priced = null;
    let lastDump = null;
    for (const bump of [0, 7, 14]) {
      const b = buildRoundTripSearchBody(DAYS + 5 + bump, DAYS + 12 + bump, {
        origin: 'DEL',
        destination: 'DXB',
        maxStops: null,
        fareType: 'NORMAL',
      });
      const paged = await paginateOnward(client, b);
      const on = pickFareByCategory(paged.options, 'NORMAL')
        || (paged.options[0]
          ? {
              searchId: paged.options[0].fares?.[0]?.searchId || paged.options[0].searchId,
            }
          : null);
      if (!on?.searchId) {
        lastDump = { bump, reason: 'no onward', inventory: { total: paged.total, n: paged.options.length } };
        continue;
      }
      const refined = { ...b, selection: { selectedSearchIds: [on.searchId] } };
      const rr = await waitReturn(client, refined, { max: 24 });
      const retOpts = collectOptions(rr?.data, 'RETURN');
      const ret = pickFareByCategory(retOpts, 'NORMAL')
        || (retOpts[0]
          ? { searchId: retOpts[0].fares?.[0]?.searchId || retOpts[0].searchId }
          : null);
      lastDump = {
        bump,
        dates: b.itinerary,
        onwardN: paged.options.length,
        onwardPages: paged.pages,
        returnN: retOpts.length,
        onSid: on.searchId,
        retSid: ret?.searchId || null,
      };
      if (ret?.searchId) {
        priced = await flight.getPricing([on.searchId, ret.searchId], 'ROUND_TRIP');
        lastDump.price = { http: priced.status, code: errCode(priced), priceId: priced.data?.priceId };
        break;
      }
    }
    dumps.D8 = lastDump;
    if (!priced) {
      add('D-8', 'Intl RT select onward, re-search, price succeeds', 'NOT TESTED', {
        actual: JSON.stringify(lastDump),
      });
    } else {
      add('D-8', 'Intl RT select onward, re-search, price succeeds', priced.ok ? 'PASS' : 'BUG', {
        expected: '200 pricing',
        actual: JSON.stringify(dumps.D8),
      });
    }
  }

  // ─── E-1 / E-6: CORPORATE from ALL OW pages → details/pricing/rules ────
  console.log('\n## E-1 / E-6');
  {
    const body = buildOneWaySearchBody(DAYS, {
      origin: 'DEL',
      destination: 'BOM',
      maxStops: null,
      fareType: 'NORMAL,SME,CORPORATE',
    });
    const paged = await paginateOnward(client, body);
    dumps.E1_inventory = {
      total: paged.total,
      pages: paged.pages,
      n: paged.options.length,
      page0Cats: paged.page0Cats,
      allCats: paged.allCats,
      facet: paged.facet,
    };
    const corp = pickFareByCategory(paged.options, 'CORPORATE');
    if (!corp) {
      add('E-1', 'Corporate searchId → details/pricing/fareRules 200', 'NOT TESTED', {
        actual: JSON.stringify(dumps.E1_inventory),
      });
      add('E-6', 'pricing chain', 'NOT TESTED', { actual: 'no corporate' });
    } else {
      const det = await flight.getDetails([corp.searchId], 'ONE_WAY');
      const price = await flight.getPricing([corp.searchId], 'ONE_WAY');
      const rules = await flight.getFareRules([corp.searchId], 'ONE_WAY');
      dumps.E1 = {
        sid: corp.searchId,
        det: det.status,
        price: price.status,
        rules: rules.status,
        rulesCode: errCode(rules),
        priceId: price.data?.priceId,
      };
      add(
        'E-1',
        'Corporate searchId → details/pricing/fareRules 200',
        det.ok && price.ok && (rules.ok || errCode(rules) === 'VENDOR_ERROR') ? 'PASS' : 'BUG',
        { expected: 'all 200 (rules may VENDOR_ERROR)', actual: JSON.stringify(dumps.E1) },
      );

      const priceId = price.data?.priceId;
      if (!price.ok || !priceId) {
        add('E-6', 'pricing chain', 'NOT TESTED', { actual: 'no priceId after corporate pricing' });
      } else {
        const tryPaths = [
          { name: 'refresh-token', path: '/v1/flights/pricing/refresh-token', body: { priceId } },
          {
            name: 'selection-pricing',
            path: '/v1/flights/selection/pricing',
            body: { priceId, searchIds: [corp.searchId] },
          },
        ];
        const e6 = [];
        for (const t of tryPaths) {
          const r = await client.request({
            method: 'POST',
            path: t.path,
            query: { lang: 'en', currency: 'INR' },
            body: t.body,
            correlation: true,
          });
          e6.push({ name: t.name, http: r.status, code: errCode(r) });
        }
        dumps.E6 = e6;
        if (!e6.length || e6.every((x) => x.http === 404)) {
          add('E-6', 'pricing → refresh-token / selection-pricing', 'NOT TESTED', {
            actual: JSON.stringify(e6) + ' (paths 404 on B2B)',
          });
        } else {
          const ok = e6.every((x) => x.http === 200);
          add('E-6', 'pricing chain', ok ? 'PASS' : 'BUG', { actual: JSON.stringify(e6) });
        }
      }
    }
  }

  const summary = {
    PASS: rows.filter((r) => r.status === 'PASS').length,
    BUG: rows.filter((r) => r.status === 'BUG').length,
    NOT_TESTED: rows.filter((r) => r.status === 'NOT TESTED').length,
  };
  const report = {
    at: dumps.at,
    base: process.env.BASE_URL,
    noBook: true,
    correlationId: client.correlationId,
    summary,
    rows,
    dumps,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  const md = [
    '# Fare Lanes — NT retest (paginate + pricing, no book)',
    '',
    `- Base: \`${process.env.BASE_URL}\``,
    `- **${summary.PASS} PASS / ${summary.BUG} BUG / ${summary.NOT_TESTED} NOT TESTED**`,
    '',
    '| Id | Rule | Status |',
    '|----|------|--------|',
    ...rows.map((r) => `| ${r.id} | ${r.rule} | **${r.status}** |`),
  ];
  fs.writeFileSync(OUT_MD, md.join('\n'));
  console.log('\n=== SUMMARY ===', summary);
  console.log('Wrote', OUT, OUT_MD);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
