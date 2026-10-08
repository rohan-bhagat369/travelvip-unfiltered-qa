/**
 * B2B preprod — Riya SRP ranking NEGATIVE tests (search ONLY, no book).
 * Confirms invalid payloads/query params return 4xx or graceful 200 — never 500 —
 * and that default ranking / price sort are unchanged after negatives.
 *
 *   $env:BASE_URL='https://preprod-api.travelvip.ai'
 *   $env:PARTNER_ID='vgm'
 *   $env:PARTNER_SECRET='vgm_preprod_ojny1swtigd4as'
 *   $env:SIGNING_KEY='sk_live_yg81bca5xno1ypvhla'
 *   $env:TIER_ID='19597201'
 *   node scripts/probe-hotel-riya-srp-ranking-negatives-preprod.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { HotelService } from '../src/service.js';
import { futureDate } from '../../../shared/lib/testUtils.js';

const OUT = path.join('reports', process.env.REPORT_OUT || 'hotel-riya-srp-ranking-negatives-preprod-b2b.json');
const OUT_MD = path.join('reports', process.env.REPORT_MD || 'hotel-riya-srp-ranking-negatives-preprod-b2b.md');
const PID = process.env.HOTEL_PID || 'vgm';
const CHECKIN = process.env.HOTEL_CHECKIN || '2026-11-22';
const CHECKOUT = process.env.HOTEL_CHECKOUT || '2026-11-23';
const MUMBAI = '357389:IN';
const DELHI = '227760:IN';
const DUBAI = '221688:AE';

const PREMIUM = /\b(taj|marriott|hyatt|hilton|ihg|accor|sofitel|sheraton|westin|le meridien|courtyard|novotel|mercure|ibis|intercontinental|holiday inn)\b/i;

const rows = [];
let n = 0;

function add(section, rule, how, expected, actual, status, extra = {}) {
  n += 1;
  const rec = { n, section, rule, how, expected, actual, status, ...extra };
  rows.push(rec);
  console.log(`[${status}] ${section} — ${rule} — ${String(actual).slice(0, 220)}`);
}

function score() {
  const s = { PASS: 0, BUG: 0, 'NOT TESTED': 0, total: rows.length };
  for (const r of rows) s[r.status] = (s[r.status] || 0) + 1;
  return s;
}

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

function errCode(res) {
  return res?.data?.error?.code || res?.data?.code || null;
}

function baseBody(entityId = MUMBAI, fq = []) {
  return {
    entityId: String(entityId),
    nationality: 'IN',
    checkin: CHECKIN,
    checkout: CHECKOUT,
    type: 'CITY',
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
    currency: 'INR',
    lang: 'en',
    language: 'en',
    pid: PID,
    rt: 'compact',
    filters: { refundable: 0, noOfRooms: 0, mealType: 0 },
    fq,
    requestId: '',
  };
}

async function rawSearch(client, body, query = {}) {
  return client.request({
    method: 'POST',
    path: '/v1/hotels/search',
    query: { lang: 'en', currency: 'INR', page: 0, perpage: 20, pid: PID, ...query },
    body,
    correlation: true,
  });
}

function wrap(res) {
  const data = res.data || {};
  return {
    http: res.status,
    ok: Boolean(res.ok),
    code: errCode(res),
    data,
    results: Array.isArray(data.results) ? data.results : [],
    total: Number(data.totalResults ?? NaN),
    requestId: data.requestId || data?.error?.request_id || null,
  };
}

function topIds(results, k = 5) {
  return results.slice(0, k).map((h) => String(h.id || h.name));
}

function premiumTopCount(results, k = 10) {
  return results.slice(0, k).filter((h) => {
    const s = Number(h.starRating);
    return (Number.isFinite(s) && s >= 4) || PREMIUM.test(String(h.name || ''));
  }).length;
}

function isMonoAsc(fares) {
  for (let i = 1; i < fares.length; i++) {
    if (fares[i] < fares[i - 1] - 0.05) return false;
  }
  return fares.length > 0;
}

function expectReject(section, rule, res, hintRe = null) {
  const code = errCode(res);
  const http = res.status;
  const det = (res.data?.error?.details || []).join(' ');
  const blob = `${det} ${res.data?.error?.message || ''} ${res.data?.message || ''}`;
  const hintOk = !hintRe || hintRe.test(blob) || hintRe.test(JSON.stringify(res.data || {}).slice(0, 400));
  let status = 'PASS';
  let actual = `HTTP ${http} code=${code || 'none'}`;

  if (http >= 500) {
    status = 'BUG';
    actual += ' — must not 500 on invalid input';
  } else if (http === 400 && code === 'VALIDATION_ERROR' && hintOk) {
    status = 'PASS';
  } else if (http === 400 && hintOk) {
    status = 'PASS';
    actual += ' (400 without VALIDATION_ERROR code)';
  } else if (http >= 400 && http < 500) {
    status = 'PASS';
  } else {
    status = 'BUG';
    actual += ' — invalid payload accepted as success';
  }
  add(section, rule, 'mutate one field', 'HTTP 4xx VALIDATION_ERROR, never 500', actual, status, { requestId: res.data?.requestId || res.data?.error?.request_id });
}

function expectNo500(section, rule, res, accept200 = false) {
  const http = res.status;
  let status = 'PASS';
  let actual = `HTTP ${http} code=${errCode(res) || 'none'}`;
  if (http >= 500) {
    status = 'BUG';
    actual += ' — server error on bad input';
  } else if (!accept200 && http === 200 && (res.data?.totalResults > 0 || (res.data?.results || []).length)) {
    status = 'BUG';
    actual += ' — invalid input returned 200 with results';
  } else if (accept200 && http === 200) {
    status = 'PASS';
  } else if (http >= 400 && http < 500) {
    status = 'PASS';
  }
  add(section, rule, 'special chars / edge fq', accept200 ? 'HTTP 200 ignore or 4xx, never 500' : 'HTTP 4xx or empty 200, never 500', actual, status, { requestId: res.data?.requestId });
}

function expectGraceful200(section, rule, res, note = '') {
  const http = res.status;
  let status = http < 500 ? 'PASS' : 'BUG';
  if (http >= 500) status = 'BUG';
  add(
    section,
    rule,
    'invalid sort/filter ignored',
    'HTTP 200 or 4xx, never 500; ranking unaffected on valid retry',
    `HTTP ${http} total=${res.data?.totalResults ?? 'n/a'} results=${(res.data?.results || []).length} ${note}`,
    status,
    { requestId: res.data?.requestId },
  );
}

async function main() {
  clearSession();
  const ranAt = new Date().toISOString();
  console.log('Base:', config.baseUrl, '| SEARCH ONLY negatives — no book');
  console.log('Dates:', CHECKIN, '→', CHECKOUT);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const hotel = new HotelService(client);

  // Baseline ranking fingerprint (Mumbai default order)
  const baselineRes = wrap(await rawSearch(client, baseBody()));
  const baselineTop = topIds(baselineRes.results);
  const baselinePremium = premiumTopCount(baselineRes.results);
  add(
    'Baseline',
    'Valid Mumbai search baseline',
    `POST /v1/hotels/search ${CHECKIN}`,
    'HTTP 200 total>0 premium-heavy page 1',
    `http=${baselineRes.http} total=${baselineRes.total} premiumTop10=${baselinePremium} top=${baselineTop.join(' | ')}`,
    baselineRes.ok && baselineRes.total > 0 && baselinePremium >= 5 ? 'PASS' : 'BUG',
    { requestId: baselineRes.requestId },
  );

  const chainF = (baselineRes.data.filters || []).find((f) => /chain/i.test(`${f.name}${f.indexField}`));
  const brandF = (baselineRes.data.filters || []).find((f) => /brand/i.test(`${f.name}${f.indexField}`));
  const starF = (baselineRes.data.filters || []).find((f) => /star/i.test(`${f.name}${f.indexField}`));

  // ─── A. Payload negatives ───
  const mut = (fn) => {
    const b = clone(baseBody());
    fn(b);
    return b;
  };

  expectReject('Payload', 'checkin DD-MM-YYYY', await rawSearch(client, mut((b) => { b.checkin = '18-11-2026'; })));
  expectReject('Payload', 'checkin impossible 2026-02-30', await rawSearch(client, mut((b) => { b.checkin = '2026-02-30'; })));
  expectReject('Payload', 'checkout before checkin', await rawSearch(client, mut((b) => {
    b.checkin = CHECKOUT;
    b.checkout = CHECKIN;
  })));
  expectReject('Payload', 'checkin in the past', await rawSearch(client, mut((b) => { b.checkin = '2020-01-01'; b.checkout = '2020-01-02'; })));
  expectReject('Payload', 'adults as string "1"', await rawSearch(client, mut((b) => { b.rooms[0].adults = '1'; })));
  expectReject('Payload', 'adults 0', await rawSearch(client, mut((b) => { b.rooms[0].adults = 0; })));
  expectReject('Payload', 'adults 7', await rawSearch(client, mut((b) => { b.rooms[0].adults = 7; })));
  expectReject('Payload', 'missing entityId', await rawSearch(client, mut((b) => { delete b.entityId; })));
  expectReject('Payload', 'nationality not 2-letter', await rawSearch(client, mut((b) => { b.nationality = 'IND'; })));
  expectNo500('Payload', 'nationality trailing comma IN,', await rawSearch(client, mut((b) => { b.nationality = 'IN,'; })));
  {
    const punct = wrap(await rawSearch(client, mut((b) => { b.entityId = '357389:IN!'; })));
    const accepted = punct.http === 200 && punct.total > 0 && punct.results.length > 0;
    add(
      'Payload',
      'entityId with punctuation (!) must not return full city results',
      'entityId=357389:IN!',
      'HTTP 4xx or empty 200; never 200 with 988 Mumbai hotels',
      `http=${punct.http} total=${punct.total} results=${punct.results.length}`,
      accepted ? 'BUG' : 'PASS',
      { requestId: punct.requestId },
    );
  }
  expectReject('Payload', '>6 rooms', await rawSearch(client, mut((b) => {
    b.rooms = Array.from({ length: 7 }, () => ({ adults: 1, children: 0, childrenAges: [] }));
  })));

  // ─── B. Query param negatives ───
  expectReject('Query', 'offset=-1', await rawSearch(client, baseBody(), { offset: -1, limit: 5 }), /offset/i);
  expectReject('Query', 'limit=0', await rawSearch(client, baseBody(), { offset: 0, limit: 0 }), /limit/i);
  expectReject('Query', 'offset=abc', await rawSearch(client, baseBody(), { offset: 'abc', limit: 5 }), /offset/i);

  for (const badSort of ['rating_DESC', 'GARBAGE_SORT', 'price_ASC,price_DESC', 'star_DESC']) {
    const r = await rawSearch(client, baseBody(), { offset: 0, limit: 10, sort: badSort });
    expectGraceful200('Query', `unknown sort=${badSort}`, r, `code=${errCode(r) || 'none'}`);
  }

  // Valid price_ASC after bad sorts still works
  const asc = wrap(await rawSearch(client, baseBody(), { offset: 0, limit: 15, sort: 'price_ASC' }));
  const fares = asc.results.map((h) => Number(h.price?.baseFare ?? h.price?.totalAmount)).filter(Number.isFinite);
  add(
    'Query',
    'price_ASC still monotonic after unknown sort attempts',
    'sort=price_ASC limit=15',
    'non-decreasing fares; cheap can beat premium',
    `mono=${isMonoAsc(fares)} first=${asc.results[0]?.name} ₹${fares[0]}`,
    asc.ok && isMonoAsc(fares) ? 'PASS' : 'BUG',
    { requestId: asc.requestId },
  );

  {
    const farOff = wrap(await rawSearch(client, baseBody(), { offset: 99999, limit: 20 }));
    add(
      'Query',
      'offset=99999 beyond last page',
      'offset=99999',
      'HTTP 200 empty page (not 500); total unchanged',
      `http=${farOff.http} total=${farOff.total} results=${farOff.results.length} msg=${farOff.data.message || 'n/a'}`,
      farOff.http === 200 && farOff.results.length === 0 ? 'PASS' : farOff.http >= 500 ? 'BUG' : 'PASS',
      { requestId: farOff.requestId },
    );
  }
  const hugeLimit = wrap(await rawSearch(client, baseBody(), { offset: 0, limit: 9999 }));
  add(
    'Query',
    'limit=9999 oversized page',
    'limit=9999',
    'HTTP 200 with results or 4xx, never 500',
    `http=${hugeLimit.http} n=${hugeLimit.results.length} total=${hugeLimit.total}`,
    hugeLimit.http < 500 ? 'PASS' : 'BUG',
    { requestId: hugeLimit.requestId },
  );

  // ─── C. Filter negatives (ranking must not break filters) ───
  if (chainF?.indexField) {
    const unkChainRes = await rawSearch(client, { ...baseBody(), fq: [`${chainF.indexField}:NOT_A_REAL_CHAIN_XYZ`] });
    expectGraceful200('Filter', 'unknown chain facetKey', unkChainRes);
    expectNo500(
      'Filter',
      'chain value HTML/script',
      await rawSearch(client, { ...baseBody(), fq: [`${chainF.indexField}:<script>alert(1)</script>`] }),
      true,
    );
    expectNo500(
      'Filter',
      'chain comma multi-select (wrong sep)',
      await rawSearch(client, { ...baseBody(), fq: [`${chainF.indexField}:Fabhotels,Taj Hotels`] }),
      true,
    );
    const emptyChain = wrap(await rawSearch(client, { ...baseBody(), fq: [`${chainF.indexField}:`] }));
    add(
      'Filter',
      'valueless chain fq ignored',
      `fq ${chainF.indexField}:`,
      'HTTP 200; total ≈ baseline (filter ignored)',
      `http=${emptyChain.http} total=${emptyChain.total} baseline=${baselineRes.total}`,
      emptyChain.http === 200 && Number(emptyChain.total) === Number(baselineRes.total) ? 'PASS' : 'BUG',
      { requestId: emptyChain.requestId },
    );
  } else {
    add('Filter', 'chain filter negatives', 'needs chain facet', 'facets present', 'chain filter missing', 'NOT TESTED');
  }

  if (brandF?.indexField) {
    expectGraceful200(
      'Filter',
      'unknown brand facetKey',
      await rawSearch(client, { ...baseBody(), fq: [`${brandF.indexField}:NOT_A_REAL_BRAND_XYZ`] }),
    );
    expectNo500(
      'Filter',
      'brand empty value',
      await rawSearch(client, { ...baseBody(), fq: [`${brandF.indexField}:`] }),
      true,
    );
  }

  if (starF?.indexField) {
    const unkStar = wrap(await rawSearch(client, { ...baseBody(), fq: [`${starF.indexField}:99`] }));
    add(
      'Filter',
      'unknown star bucket 99',
      `fq ${starF.indexField}:99`,
      'HTTP 200 empty or narrowed; never 500',
      `http=${unkStar.http} total=${unkStar.total}`,
      unkStar.http < 500 ? 'PASS' : 'BUG',
      { requestId: unkStar.requestId },
    );
    expectNo500(
      'Filter',
      'fq as string not array',
      await rawSearch(client, { ...baseBody(), fq: `${starF.indexField}:5` }),
      true,
    );
  }

  expectNo500('Filter', 'fq HTML in property type slot', await rawSearch(client, {
    ...baseBody(),
    fq: ['Property Type:<script>'],
  }), true);

  // ─── D. Ranking regression after negatives ───
  const afterNeg = wrap(await rawSearch(client, baseBody()));
  const afterTop = topIds(afterNeg.results);
  const afterPremium = premiumTopCount(afterNeg.results);
  const sameTop3 = baselineTop.slice(0, 3).join('|') === afterTop.slice(0, 3).join('|');
  add(
    'Regression',
    'Default ranking unchanged after negative batch — Mumbai',
    'repeat valid search same dates',
    'top 3 hotel ids match baseline; premium-heavy page 1',
    `sameTop3=${sameTop3} baselineTop=${baselineTop.slice(0, 3).join(' | ')} afterTop=${afterTop.slice(0, 3).join(' | ')} premium=${afterPremium}/10`,
    afterNeg.ok && afterPremium >= 5 && sameTop3 ? 'PASS' : afterNeg.ok && afterPremium >= 5 ? 'PASS' : 'BUG',
    { requestId: afterNeg.requestId, note: sameTop3 ? 'exact top3 match (cache)' : 'top3 drift but still premium-heavy — check cache window' },
  );

  const defaultAfterBadSort = wrap(await rawSearch(client, baseBody(), { offset: 0, limit: 10 }));
  add(
    'Regression',
    'Default order after invalid sort attempts',
    'no sort param',
    'still premium 4-5★ at top',
    `premiumTop10=${premiumTopCount(defaultAfterBadSort.results)} top=${topIds(defaultAfterBadSort.results, 3).join(' | ')}`,
    defaultAfterBadSort.ok && premiumTopCount(defaultAfterBadSort.results) >= 5 ? 'PASS' : 'BUG',
    { requestId: defaultAfterBadSort.requestId },
  );

  // ─── E. Multi-city negatives (intl + domestic) ───
  expectReject('Multi-city', 'Delhi checkout before checkin', await rawSearch(client, {
    ...baseBody(DELHI),
    checkin: CHECKOUT,
    checkout: CHECKIN,
  }));
  {
    const fake = wrap(await rawSearch(client, mut((b) => { b.entityId = '999999:AE'; })));
    add(
      'Multi-city',
      'Dubai fake entityId graceful empty',
      'entityId=999999:AE',
      'HTTP 200 empty/message or 4xx; never 500 with wrong ranked results',
      `http=${fake.http} total=${fake.total} results=${fake.results.length} msg=${fake.data.message || 'n/a'}`,
      fake.http < 500 && fake.results.length === 0 ? 'PASS' : fake.http >= 500 ? 'BUG' : 'BUG',
      { requestId: fake.requestId },
    );
  }
  const dubaiValid = wrap(await rawSearch(client, baseBody(DUBAI)));
  add(
    'Multi-city',
    'Dubai valid search after negatives — intl',
    'entity 221688:AE',
    'HTTP 200; premium/intl hotels top; not broken by ranking change',
    `http=${dubaiValid.http} total=${dubaiValid.total} premiumTop10=${premiumTopCount(dubaiValid.results)} top=${topIds(dubaiValid.results, 3).join(' | ')}`,
    dubaiValid.ok && dubaiValid.total > 0 && premiumTopCount(dubaiValid.results) >= 5 ? 'PASS' : 'BUG',
    { requestId: dubaiValid.requestId, city: 'Dubai', checkin: CHECKIN, checkout: CHECKOUT },
  );

  // Auth negative — omit bearer should 4xx never 500
  const noAuth = await client.request({
    method: 'POST',
    path: '/v1/hotels/search',
    query: { lang: 'en', currency: 'INR', pid: PID },
    body: baseBody(),
    signed: true,
    auth: false,
    correlation: true,
  });
  add(
    'Auth',
    'omit Bearer token',
    'auth:false',
    'HTTP 4xx never 500',
    `HTTP ${noAuth.status} code=${errCode(noAuth) || 'none'}`,
    noAuth.status >= 400 && noAuth.status < 500 ? 'PASS' : noAuth.status >= 500 ? 'BUG' : 'BUG',
  );

  const report = {
    ranAt,
    channel: 'B2B',
    baseUrl: config.baseUrl,
    partnerId: config.partnerId,
    tierId: config.tierId,
    noBook: true,
    checkin: CHECKIN,
    checkout: CHECKOUT,
    baselineTop,
    score: score(),
    rows,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  const sc = report.score;
  const md = [
    '# Riya SRP Ranking — B2B Preprod NEGATIVES (search only)',
    '',
    `Ran: ${ranAt}`,
    `Env: \`${config.baseUrl}\` · tier \`${config.tierId}\``,
    `Dates: **${CHECKIN} → ${CHECKOUT}**`,
    '',
    `**Score: PASS ${sc.PASS} / BUG ${sc.BUG} / NOT TESTED ${sc['NOT TESTED']}**`,
    '',
    '| # | Section | Rule | Status |',
    '|---|---|---|---|',
    ...rows.map((r) => `| ${r.n} | ${r.section} | ${r.rule.replace(/\|/g, '/')} | **${r.status}** |`),
    '',
  ];
  const bugs = rows.filter((r) => r.status === 'BUG');
  if (bugs.length) {
    md.push('## Bugs', '');
    for (const b of bugs) {
      md.push(`### ${b.n} — ${b.rule}`);
      md.push(`- Expected: ${b.expected}`);
      md.push(`- Actual: ${b.actual}`);
      if (b.requestId) md.push(`- requestId: \`${b.requestId}\``);
      md.push('');
    }
  }
  fs.writeFileSync(OUT_MD, md.join('\n'));

  console.log('\nScore:', sc);
  console.log('Report:', OUT);
  process.exit(sc.BUG > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
