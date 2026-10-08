/**
 * Canary — page through ALL wallet activity pages; trace every feed id → detail.
 * Read-only. hold_released → detail committed is EXPECTED.
 *
 *   BASE_URL=https://canary-api.travelvip.ai node scripts/probe-wallet-activity-trace-all.js
 */
import fs from 'fs';
import path from 'path';
import { config } from '../../../shared/config/env.js';

const BASE = (process.env.BASE_URL || 'https://canary-api.travelvip.ai').replace(/\/$/, '');
const OUT = path.join('reports', 'wallet-activity-trace-all-canary.json');
const MAX_PAGES = process.env.MAX_PAGES ? Number(process.env.MAX_PAGES) : null; // null = all
const DETAIL_CONCURRENCY = Number(process.env.DETAIL_CONCURRENCY || '2');
const SLEEP_MS = Number(process.env.SLEEP_MS || '80');
const RETRIES = Number(process.env.RETRIES || '4');
const RETRY_MS = Number(process.env.RETRY_MS || '800');

const FORBIDDEN = [
  'idempotencyKey', 'referenceType', 'transactionCategory', 'assetType',
  'walletPartnerId', 'walletId', 'ownerId', 'partnerId', 'bookingId', 'referenceId',
];
const CATEGORIES = new Set([
  'top_up', 'booking_payment', 'credit_drawn', 'credit_repaid', 'refund', 'adjustment',
  'funds_held', 'hold_released', 'hold_expired', 'reward', 'promotion', 'redemption', 'other',
]);
const KINDS = new Set(['credit', 'debit', 'hold', null]);
const HOLD_TYPES = new Set(['hold', 'committed', 'released', 'expired']);
const DETAIL_TYPES = new Set(['hold', 'committed', 'released', 'expired', 'transaction']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function leaks(node, p = 'body') {
  let found = [];
  if (Array.isArray(node)) node.forEach((v, i) => { found = found.concat(leaks(v, `${p}[${i}]`)); });
  else if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) {
      if (FORBIDDEN.includes(k)) found.push(`${p}.${k}`);
      found = found.concat(leaks(node[k], `${p}.${k}`));
    }
  }
  return found;
}

async function partnerToken() {
  const res = await fetch(`${BASE}/auth/partner/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Request-Id': `tr-auth-${Date.now()}` },
    body: JSON.stringify({ partner_id: config.partnerId, partner_secret: config.partnerSecret }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Auth ${res.status} ${JSON.stringify(data)}`);
  return data.access_token;
}

async function get(urlPath, token) {
  let last;
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    const res = await fetch(`${BASE}${urlPath}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'X-Request-Id': `tr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      },
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    last = { status: res.status, data };
    const code = data?.error?.code || data?.code;
    const retryable = res.status === 502 || res.status === 503 || code === 'WALLET_ERROR' || code === 'WALLET_UNAVAILABLE';
    if (!retryable) return last;
    if (attempt < RETRIES) await sleep(RETRY_MS * attempt);
  }
  return last;
}

function scoreFeedRow(e) {
  const issues = [];
  if (!e?.id) issues.push('missing_id');
  if (!CATEGORIES.has(e.category)) issues.push(`bad_category:${e.category}`);
  if (e.kind != null && !['credit', 'debit', 'hold'].includes(e.kind)) issues.push(`bad_kind:${e.kind}`);
  if (!Object.prototype.hasOwnProperty.call(e, 'reference')) issues.push('missing_reference_key');
  if (e.category === 'funds_held' && e.kind !== 'hold') issues.push('funds_held_kind_mismatch');
  if (e.kind === 'hold' && e.category !== 'funds_held') issues.push('hold_category_mismatch');
  if (!e.currency) issues.push('missing_currency');
  return issues;
}

function scoreDetail(feed, detail, http) {
  const issues = [];
  if (http !== 200) {
    issues.push(`http_${http}`);
    return issues;
  }
  if (!DETAIL_TYPES.has(detail?.type)) issues.push(`bad_type:${detail?.type}`);
  if (!Object.prototype.hasOwnProperty.call(detail || {}, 'reference')) issues.push('missing_reference_key');
  const leak = leaks(detail);
  if (leak.length) issues.push(`leaks:${leak.slice(0, 3).join('|')}`);

  const isHold = HOLD_TYPES.has(detail.type);
  if (isHold) {
    if (!Array.isArray(detail.legs)) issues.push('hold_missing_legs');
    if (Object.prototype.hasOwnProperty.call(detail, 'status')) issues.push('hold_has_status');
    if (detail.held != null) {
      const sum = (detail.committed || 0) + (detail.released || 0) + (detail.stillHeld || 0);
      if (Math.abs(detail.held - sum) >= 0.005) issues.push(`hold_math_fail held=${detail.held} sum=${sum}`);
    }
    if (Array.isArray(detail.legs)) {
      for (const leg of detail.legs) {
        if (Object.keys(leg).sort().join(',') !== 'amount,date,kind,label') {
          issues.push('leg_shape');
          break;
        }
      }
    }
  } else if (detail.type === 'transaction') {
    if (Object.prototype.hasOwnProperty.call(detail, 'legs')) issues.push('transaction_has_legs');
  }

  // Trace: detail should be reachable from feed id (200 is the main gate).
  // hold_released → committed is EXPECTED.
  if (feed.category === 'funds_held' && detail.type !== 'hold') {
    issues.push(`open_hold_type:${detail.type}`);
  }
  if (feed.category === 'top_up' && detail.type !== 'transaction') {
    issues.push(`top_up_type:${detail.type}`);
  }
  if (feed.category === 'booking_payment' && detail.type !== 'committed' && detail.type !== 'transaction') {
    issues.push(`booking_payment_type:${detail.type}`);
  }

  return issues;
}

async function mapPool(items, concurrency, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i;
      i += 1;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return out;
}

async function main() {
  console.log('=== Trace ALL wallet activities (feed → detail) ===');
  console.log('BASE', BASE);
  const token = await partnerToken();
  console.log('auth OK');

  const page1 = await get('/v1/wallet/activity?page=1', token);
  if (page1.status !== 200) {
    console.error('feed page1 failed', page1.status, page1.data);
    process.exit(1);
  }

  const totalPages = page1.data.pagination?.totalPages || 1;
  const total = page1.data.pagination?.total || 0;
  const perPage = page1.data.pagination?.perPage || 15;
  const pagesToRun = MAX_PAGES ? Math.min(MAX_PAGES, totalPages) : totalPages;
  console.log(`pagination total=${total} perPage=${perPage} totalPages=${totalPages} scanning=${pagesToRun}`);

  const feedRows = [];
  const pageIssues = [];
  const seenIds = new Set();
  let dupIds = 0;

  for (let p = 1; p <= pagesToRun; p += 1) {
    const res = p === 1 ? page1 : await get(`/v1/wallet/activity?page=${p}`, token);
    if (res.status !== 200 || !Array.isArray(res.data?.activity)) {
      pageIssues.push({ page: p, status: res.status, code: res.data?.error?.code || null });
      console.log(`[BUG] page ${p} http=${res.status}`);
      continue;
    }
    if (res.data.pagination?.page !== p) {
      pageIssues.push({ page: p, issue: `echo_page=${res.data.pagination?.page}` });
    }
    if (res.data.pagination?.perPage !== 15) {
      pageIssues.push({ page: p, issue: `perPage=${res.data.pagination?.perPage}` });
    }
    for (const e of res.data.activity) {
      if (seenIds.has(e.id)) dupIds += 1;
      else seenIds.add(e.id);
      feedRows.push({ page: p, ...e });
    }
    if (p % 20 === 0 || p === pagesToRun) {
      console.log(`  feed pages ${p}/${pagesToRun} rows=${feedRows.length}`);
    }
    if (p > 1) await sleep(SLEEP_MS);
  }

  console.log(`feed collected ${feedRows.length} (unique ids ${seenIds.size}, dups ${dupIds})`);
  console.log(`tracing detail for each (concurrency=${DETAIL_CONCURRENCY})...`);

  const failures = [];
  const byCategory = {};
  const byDetailType = {};
  let feedFieldBugs = 0;
  let detailPass = 0;
  let detailFail = 0;

  const results = await mapPool(feedRows, DETAIL_CONCURRENCY, async (row) => {
    const feedIssues = scoreFeedRow(row);
    if (feedIssues.length) feedFieldBugs += 1;

    const d = await get(`/v1/wallet/activity/${encodeURIComponent(row.id)}`, token);
    const detail = d.data || {};
    const detailIssues = scoreDetail(row, detail, d.status);
    const allIssues = [...feedIssues.map((x) => `feed:${x}`), ...detailIssues.map((x) => `detail:${x}`)];

    byCategory[row.category] = (byCategory[row.category] || 0) + 1;
    if (d.status === 200) {
      byDetailType[detail.type] = (byDetailType[detail.type] || 0) + 1;
    }

    const ok = allIssues.length === 0;
    if (ok) detailPass += 1;
    else {
      detailFail += 1;
      if (failures.length < 80) {
        failures.push({
          page: row.page,
          id: row.id,
          category: row.category,
          kind: row.kind,
          feedReference: row.reference,
          detailHttp: d.status,
          detailType: detail.type,
          detailReference: detail.reference,
          issues: allIssues,
        });
      }
    }
    return ok;
  });

  const tracedOk = results.filter(Boolean).length;

  // Pagination integrity
  const expectedMin = pagesToRun === totalPages ? total : pagesToRun * perPage;
  const paginationPass =
    pageIssues.length === 0 &&
    dupIds === 0 &&
    (pagesToRun < totalPages || feedRows.length === total);

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: BASE,
    partnerId: config.partnerId,
    note: 'Full pagination + every feed id → detail. hold_released→committed expected. Read-only.',
    pagination: {
      total,
      perPage,
      totalPages,
      pagesScanned: pagesToRun,
      rowsCollected: feedRows.length,
      uniqueIds: seenIds.size,
      duplicateIds: dupIds,
      pageIssues,
      verdict: paginationPass ? 'PASS' : 'BUG',
    },
    trace: {
      attempted: feedRows.length,
      pass: detailPass,
      fail: detailFail,
      feedFieldBugs,
      byCategory,
      byDetailType,
    },
    counts: {
      PASS: detailPass + (paginationPass ? 1 : 0),
      FAIL: detailFail + (paginationPass ? 0 : 1),
    },
    failureSamples: failures,
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log('\n=== PAGINATION ===');
  console.log(JSON.stringify(report.pagination, null, 2));
  console.log('\n=== TRACE ===');
  console.log(`traced OK ${tracedOk}/${feedRows.length} | FAIL ${detailFail} | feedFieldBugs ${feedFieldBugs}`);
  console.log('byCategory', byCategory);
  console.log('byDetailType', byDetailType);
  if (failures.length) {
    console.log('\n=== FAIL SAMPLES (up to 15) ===');
    for (const f of failures.slice(0, 15)) {
      console.log(`  [${f.category}] ${f.id} → http=${f.detailHttp} type=${f.detailType} issues=${f.issues.join('; ')}`);
    }
  }
  console.log('\nReport', OUT);
  if (detailFail > 0 || !paginationPass) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
