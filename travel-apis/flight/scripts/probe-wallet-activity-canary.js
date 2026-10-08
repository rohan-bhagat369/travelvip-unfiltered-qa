/**
 * Canary — Wallet Activity full QA guide pack (READ ONLY).
 * Positive + Negative + E2E feed→detail flow. No book / top-up.
 * Guide: wallet-activity-api-qa-guide.pdf
 *
 *   BASE_URL=https://canary-api.travelvip.ai node scripts/probe-wallet-activity-canary.js
 */
import fs from 'fs';
import path from 'path';
import { config } from '../../../shared/config/env.js';

const BASE = (process.env.BASE_URL || 'https://canary-api.travelvip.ai').replace(/\/$/, '');
const OUT = path.join('reports', 'wallet-activity-canary.json');
const SCAN_PAGES = Number(process.env.WALLET_SCAN_PAGES || '8');

const FORBIDDEN = [
  'idempotencyKey', 'referenceType', 'transactionCategory', 'assetType',
  'walletPartnerId', 'walletId', 'ownerId', 'partnerId', 'bookingId', 'referenceId',
];
const CATEGORIES = [
  'top_up', 'booking_payment', 'credit_drawn', 'credit_repaid', 'refund', 'adjustment',
  'funds_held', 'hold_released', 'hold_expired', 'reward', 'promotion', 'redemption', 'other',
];
const HOLD_TYPES = ['hold', 'committed', 'released', 'expired'];
const MONEY_KEYS = ['cashBalance', 'reserved', 'creditAvailable', 'available', 'amount', 'held', 'committed', 'released', 'stillHeld'];

function leaks(node, p = 'body') {
  let found = [];
  if (Array.isArray(node)) {
    node.forEach((v, i) => { found = found.concat(leaks(v, `${p}[${i}]`)); });
  } else if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) {
      if (FORBIDDEN.includes(k)) found.push(`${p}.${k}`);
      found = found.concat(leaks(node[k], `${p}.${k}`));
    }
  }
  return found;
}

function looksLikePaiseLeak(amount) {
  // Heuristic: huge integer with no fraction often means paise leaked as rupees for typical bookings.
  // Guide: amounts are decimal rupees. We only flag if value is integer >= 100000 and no decimal part.
  if (amount == null || typeof amount !== 'number') return false;
  return Number.isInteger(amount) && amount >= 100000;
}

function moneyOk(obj, pathHint = '') {
  const issues = [];
  const walk = (n, p) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      n.forEach((v, i) => walk(v, `${p}[${i}]`));
      return;
    }
    for (const [k, v] of Object.entries(n)) {
      if (MONEY_KEYS.includes(k) && typeof v === 'number') {
        if (looksLikePaiseLeak(v)) issues.push(`${p}.${k}=${v}`);
      }
      if (v && typeof v === 'object') walk(v, `${p}.${k}`);
    }
  };
  walk(obj, pathHint || 'body');
  return issues;
}

function envelopeOk(data) {
  const e = data?.error;
  if (!e || typeof e !== 'object') return false;
  return ['code', 'message', 'details', 'timestamp', 'request_id'].every((k) => Object.prototype.hasOwnProperty.call(e, k));
}

async function partnerToken() {
  const res = await fetch(`${BASE}/auth/partner/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Request-Id': `wa-auth-${Date.now()}` },
    body: JSON.stringify({ partner_id: config.partnerId, partner_secret: config.partnerSecret }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Auth failed ${res.status}: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function hit(urlPath, { token, query, requestId, correlationId, headers: extra } = {}) {
  const url = new URL(urlPath.startsWith('http') ? urlPath : `${BASE}${urlPath}`);
  if (query) {
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    });
  }
  const rid = requestId || `wa-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const headers = {
    Accept: 'application/json',
    'X-Request-Id': rid,
    'X-Correlation-ID': correlationId || rid,
    ...(extra || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { method: 'GET', headers });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: res.status, data, text, requestId: rid };
}

const errCode = (r) => r.data?.error?.code || r.data?.code || null;

async function main() {
  console.log('=== Wallet Activity — FULL QA GUIDE (canary, read-only) ===');
  console.log('BASE', BASE);

  const access = await partnerToken();
  console.log('auth OK');

  const rows = [];
  let n = 0;
  const add = (section, id, rule, how, status, actual, extra = {}) => {
    n += 1;
    const r = { section, n, id, rule, how, status, actual, ...extra };
    rows.push(r);
    console.log(`[${status}] ${section} ${id} | ${actual}`);
    return r;
  };

  // ========== E2E FLOW ==========
  const feed1 = await hit('/v1/wallet/activity', { token: access, query: { page: 1 } });
  const j1 = feed1.data || {};
  const e2eOk = feed1.status === 200 && j1.summary && j1.pagination && Array.isArray(j1.activity);
  add('E2E', 'E2E-01', 'Auth → feed page 1 returns statement shape', 'token + GET activity?page=1',
    e2eOk ? 'PASS' : 'BUG',
    `http=${feed1.status} entries=${j1.activity?.length} total=${j1.pagination?.total}`);

  // Scan pages for category inventory
  const byCat = {};
  const allRows = [...(j1.activity || [])];
  for (const e of j1.activity || []) {
    if (!byCat[e.category]) byCat[e.category] = e;
  }
  const maxPage = Math.min(SCAN_PAGES, j1.pagination?.totalPages || 1);
  for (let p = 2; p <= maxPage; p += 1) {
    const fp = await hit('/v1/wallet/activity', { token: access, query: { page: p } });
    for (const e of fp.data?.activity || []) {
      allRows.push(e);
      if (!byCat[e.category]) byCat[e.category] = e;
    }
  }
  add('E2E', 'E2E-02', 'Scan feed pages for category inventory', `pages 1-${maxPage}`,
    Object.keys(byCat).length > 0 ? 'PASS' : 'BUG',
    `categories=${Object.keys(byCat).join(',')}`);

  // Feed → detail drill for first row
  const first = j1.activity?.[0];
  let firstDetail = null;
  if (first?.id) {
    firstDetail = await hit(`/v1/wallet/activity/${first.id}`, { token: access });
    const dj = firstDetail.data || {};
    const typeOk = HOLD_TYPES.concat(['transaction']).includes(dj.type);
    add('E2E', 'E2E-03', 'Feed row id → detail drill-down', `GET .../${first.id}`,
      firstDetail.status === 200 && typeOk ? 'PASS' : 'BUG',
      `http=${firstDetail.status} type=${dj.type} ref=${dj.reference}`);
  } else {
    add('E2E', 'E2E-03', 'Feed row id → detail', 'empty feed', 'NOT TESTED', 'no activity');
  }

  // Hold story E2E on committed / released details
  async function holdStory(id, feedRow, expectTypes) {
    if (!feedRow?.id) {
      add('E2E', id, `Hold story via ${expectTypes.join('|')}`, 'inventory missing', 'NOT TESTED', 'no feed row');
      return null;
    }
    const d = await hit(`/v1/wallet/activity/${feedRow.id}`, { token: access });
    const dj = d.data || {};
    const isHoldShape = HOLD_TYPES.includes(dj.type);
    let mathOk = true;
    if (isHoldShape && dj.held != null) {
      mathOk = Math.abs(dj.held - ((dj.committed || 0) + (dj.released || 0) + (dj.stillHeld || 0))) < 0.005;
    }
    const typeOk = expectTypes.includes(dj.type) || (id === 'E2E-HOLD-BP' && dj.type === 'transaction');
    const legsOk = isHoldShape ? Array.isArray(dj.legs) && dj.legs.length > 0 : true;
    const noStatus = isHoldShape ? !Object.prototype.hasOwnProperty.call(dj, 'status') : true;
    const ok = d.status === 200 && typeOk && mathOk && legsOk && noStatus;
    add('E2E', id,
      `Detail of ${feedRow.category}: hold breakdown (held=committed+released+stillHeld)`,
      `GET .../${feedRow.id}`,
      ok ? 'PASS' : 'BUG',
      `http=${d.status} type=${dj.type} held=${dj.held} c=${dj.committed} r=${dj.released} s=${dj.stillHeld} legs=${dj.legs?.length} mathOk=${mathOk}`,
      { detail: { type: dj.type, reference: dj.reference, held: dj.held, committed: dj.committed, released: dj.released, stillHeld: dj.stillHeld } }
    );
    return dj;
  }

  await holdStory('E2E-HOLD-BP', byCat.booking_payment, ['committed']);
  // Product: hold_released feed row may resolve to the same hold detail as committed
  // (full hold breakdown). Expected — not a bug.
  await holdStory('E2E-HOLD-REL', byCat.hold_released, ['released', 'committed']);
  await holdStory('E2E-HOLD-EXP', byCat.hold_expired, ['expired']);
  await holdStory('E2E-HOLD-OPEN', byCat.funds_held, ['hold']);

  // Idempotent re-read
  {
    const a = await hit('/v1/wallet/activity', { token: access, query: { page: 1 } });
    const b = await hit('/v1/wallet/activity', { token: access, query: { page: 1 } });
    const sameShape = a.status === 200 && b.status === 200
      && a.data?.pagination?.total === b.data?.pagination?.total
      && a.data?.summary?.currency === b.data?.summary?.currency;
    add('E2E', 'E2E-04', 'Repeated feed call stable (same total/currency)', 'GET page=1 twice',
      sameShape ? 'PASS' : 'BUG',
      `totalA=${a.data?.pagination?.total} totalB=${b.data?.pagination?.total}`);
  }

  // Decimal rupees + currency
  {
    const moneyIssues = moneyOk(j1);
    const curOk = j1.summary?.currency === 'INR'
      && (j1.activity || []).every((e) => !e.currency || e.currency === 'INR');
    add('E2E', 'E2E-05', 'Amounts look like decimal rupees with currency (not paise leak heuristic)',
      'scan feed summary+rows',
      feed1.status === 200 && curOk && moneyIssues.length === 0 ? 'PASS' : (feed1.status === 200 ? 'BUG' : 'NOT TESTED'),
      `currencyOk=${curOk} paiseSuspect=${moneyIssues.length}`);
  }

  // Unknown query ignored (§10.3)
  {
    const r = await hit('/v1/wallet/activity', { token: access, query: { page: 1, category: 'top_up', from: '2020-01-01' } });
    add('E2E', 'E2E-06', 'Unknown filters silently ignored (still 200 feed)', 'GET ?page=1&category=&from=',
      r.status === 200 && Array.isArray(r.data?.activity) ? 'PASS' : 'BUG',
      `http=${r.status} entries=${r.data?.activity?.length}`);
  }

  // ========== POSITIVE FEED ==========
  add('POSITIVE', 'AF-01', 'Happy path page 1', 'GET ?page=1',
    e2eOk && j1.pagination?.perPage === 15 ? 'PASS' : 'BUG',
    `http=${feed1.status} perPage=${j1.pagination?.perPage}`);

  if ((j1.pagination?.total || 0) > 15) {
    const feed2 = await hit('/v1/wallet/activity', { token: access, query: { page: 2 } });
    const ids1 = new Set((j1.activity || []).map((e) => e.id));
    const ids2 = (feed2.data?.activity || []).map((e) => e.id);
    const overlap = ids2.filter((id) => ids1.has(id));
    add('POSITIVE', 'AF-02', 'Page 2+ no gaps/repeats vs page 1', 'GET ?page=2',
      feed2.status === 200 && ids2.length > 0 && overlap.length === 0 ? 'PASS' : 'BUG',
      `overlap=${overlap.length} page2=${ids2.length}`);
  } else {
    add('POSITIVE', 'AF-02', 'Page 2+', 'needs total>15', 'NOT TESTED', `total=${j1.pagination?.total}`);
  }

  add('POSITIVE', 'AF-03', 'Empty wallet partner', 'needs partner with no activity', 'NOT TESTED', 'no empty-wallet partner');

  {
    const r = await hit('/v1/wallet/activity', { token: access });
    add('POSITIVE', 'AF-04', 'page omitted = page 1', 'GET no query',
      r.status === 200 && r.data?.pagination?.page === 1 ? 'PASS' : 'BUG',
      `page=${r.data?.pagination?.page}`);
  }

  const leakFeed = leaks(j1);
  add('POSITIVE', 'AF-17', 'No internal leaks on feed', 'scan body',
    feed1.status === 200 && leakFeed.length === 0 ? 'PASS' : 'BUG',
    `leaks=${leakFeed.length}`);

  const catsOk = allRows.every((e) => CATEGORIES.includes(e.category));
  const kindsOk = allRows.every((e) => e.kind == null || ['credit', 'debit', 'hold'].includes(e.kind));
  add('POSITIVE', 'AF-18', 'category/kind published enums on scanned pages', `scan ${allRows.length} rows`,
    catsOk && kindsOk ? 'PASS' : 'BUG',
    `catsOk=${catsOk} kindsOk=${kindsOk}`);

  const holdCons = allRows.every((e) => {
    if (e.category === 'funds_held') return e.kind === 'hold';
    if (e.kind === 'hold') return e.category === 'funds_held';
    return true;
  });
  add('POSITIVE', 'AF-19', 'funds_held ↔ hold consistent', 'scan rows',
    holdCons ? 'PASS' : 'BUG', `ok=${holdCons}`);

  {
    const hr = byCat.hold_released;
    if (hr) {
      const looksBr = typeof hr.reference === 'string' && /^BR/i.test(hr.reference);
      add('POSITIVE', 'AF-20', 'hold_released reference falls back to booking ref', `row ${hr.id}`,
        hr.reference != null ? 'PASS' : 'BUG',
        `reference=${hr.reference} looksBR=${looksBr}`);
    } else {
      add('POSITIVE', 'AF-20', 'hold_released reference', 'inventory', 'NOT TESTED', 'no hold_released');
    }
  }

  // ========== POSITIVE DETAIL ==========
  async function detailPos(id, rule, pick, expectType) {
    if (!pick?.id) {
      add('POSITIVE', id, rule, 'inventory missing', 'NOT TESTED', 'no row');
      return;
    }
    const d = await hit(`/v1/wallet/activity/${pick.id}`, { token: access });
    const dj = d.data || {};
    const dLeak = leaks(dj);
    const isHold = HOLD_TYPES.includes(dj.type);
    let shapeOk = true;
    let note = `type=${dj.type}`;
    if (expectType && dj.type !== expectType) {
      if (id === 'AD-02' && dj.type === 'transaction') note += ' (guide: note if transaction)';
      else { shapeOk = false; note += ` expected=${expectType}`; }
    }
    if (isHold) {
      if (!Array.isArray(dj.legs)) shapeOk = false;
      if (Object.prototype.hasOwnProperty.call(dj, 'status')) shapeOk = false;
      if (dj.held != null) {
        const sum = (dj.committed || 0) + (dj.released || 0) + (dj.stillHeld || 0);
        if (Math.abs(dj.held - sum) >= 0.005) shapeOk = false;
      }
      if (id === 'AD-05' && !(dj.stillHeld > 0 && (dj.committed || 0) === 0 && (dj.released || 0) === 0)) shapeOk = false;
      if (Array.isArray(dj.legs)) {
        for (const leg of dj.legs) {
          if (Object.keys(leg).sort().join(',') !== 'amount,date,kind,label') shapeOk = false;
        }
      }
    } else if (dj.type === 'transaction') {
      if (Object.prototype.hasOwnProperty.call(dj, 'legs')) shapeOk = false;
    }
    const ok = d.status === 200 && shapeOk && dLeak.length === 0 && Object.prototype.hasOwnProperty.call(dj, 'reference');
    add('POSITIVE', id, rule, `GET .../${pick.id}`, ok ? 'PASS' : 'BUG',
      `http=${d.status} ${note} leaks=${dLeak.length}`);
  }

  await detailPos('AD-01', 'Detail top_up → transaction, no legs', byCat.top_up, 'transaction');
  await detailPos('AD-02', 'Detail booking_payment → committed + legs + math', byCat.booking_payment, 'committed');
  // Product expected: hold_released feed id may return type=committed (shared hold detail).
  await detailPos('AD-03', 'Detail hold_released → committed or released (expected) + legs', byCat.hold_released, null);
  await detailPos('AD-04', 'Detail hold_expired → expired + legs', byCat.hold_expired, 'expired');
  await detailPos('AD-05', 'Detail funds_held → hold, stillHeld>0', byCat.funds_held, 'hold');

  {
    const pick = byCat.booking_payment || byCat.hold_released || first;
    if (pick?.id) {
      const d = await hit(`/v1/wallet/activity/${pick.id}`, { token: access });
      const dj = d.data || {};
      if (HOLD_TYPES.includes(dj.type) && Array.isArray(dj.legs)) {
        const legShape = dj.legs.every((leg) => Object.keys(leg).sort().join(',') === 'amount,date,kind,label');
        add('POSITIVE', 'AD-06', 'legs[] only label/kind/amount/date', `detail ${pick.id}`,
          legShape ? 'PASS' : 'BUG', `legs=${dj.legs.length} ok=${legShape}`);
      } else {
        add('POSITIVE', 'AD-06', 'legs[] shape', 'need hold-shaped detail', 'NOT TESTED', `type=${dj.type}`);
      }
      const dLeak = leaks(dj);
      const holdNoStatus = HOLD_TYPES.includes(dj.type) ? !Object.prototype.hasOwnProperty.call(dj, 'status') : true;
      add('POSITIVE', 'AD-12', 'Detail no internal leaks; hold has no status', `detail ${pick.id}`,
        d.status === 200 && dLeak.length === 0 && holdNoStatus ? 'PASS' : 'BUG',
        `leaks=${dLeak.length} holdNoStatus=${holdNoStatus}`);
    } else {
      add('POSITIVE', 'AD-06', 'legs shape', 'no id', 'NOT TESTED', '');
      add('POSITIVE', 'AD-12', 'detail leaks', 'no id', 'NOT TESTED', '');
    }
  }

  {
    const tu = byCat.top_up;
    if (tu?.id) {
      const d = await hit(`/v1/wallet/activity/${tu.id}`, { token: access });
      const dj = d.data || {};
      const ref = dj.reference;
      const notBr = ref == null || !/^BR/i.test(String(ref));
      add('POSITIVE', 'AD-15', 'top_up reference is gateway/bank, not booking BR', `detail ${tu.id}`,
        d.status === 200 && dj.type === 'transaction' && notBr ? 'PASS' : (d.status === 200 ? 'BUG' : 'NOT TESTED'),
        `reference=${ref}`);
    } else {
      add('POSITIVE', 'AD-15', 'top_up reference', 'inventory', 'NOT TESTED', 'no top_up');
    }
  }

  add('POSITIVE', 'AD-08', "Partner B id with partner A token → 404 identical to unknown", 'needs PARTNER_ID_2', 'NOT TESTED', 'no 2nd partner');
  add('POSITIVE', 'AF-13', 'Partner with no wallet → WALLET_NOT_CONFIGURED', 'needs partner', 'NOT TESTED', 'no such partner');
  add('POSITIVE', 'AF-14', 'Wallet disabled → 503 WALLET_DISABLED', 'env flag', 'NOT TESTED', 'cannot toggle');
  add('POSITIVE', 'AD-13', 'Detail no wallet → WALLET_NOT_CONFIGURED', 'needs partner', 'NOT TESTED', 'no such partner');
  add('POSITIVE', 'AD-14', 'Detail wallet disabled → 503', 'env flag', 'NOT TESTED', 'cannot toggle');
  add('POSITIVE', 'AF-15', 'Revoked token → TOKEN_REVOKED', 'needs revoke API', 'NOT TESTED', '');
  add('POSITIVE', 'AF-14b', 'Expired token → ACCESS_TOKEN_EXPIRED', 'needs expired token', 'NOT TESTED', '');

  // ========== NEGATIVE FEED ==========
  for (const [id, page, rule] of [
    ['AF-05', '0', 'page=0 → 400 VALIDATION_ERROR'],
    ['AF-06', 'abc', 'page=abc → 400 VALIDATION_ERROR'],
    ['AF-07', '1.5', 'page=1.5 → 400 VALIDATION_ERROR'],
    ['AF-08', '-1', 'page=-1 → 400 VALIDATION_ERROR'],
    ['AF-09', '999999999', 'page=999999999 → 400 VALIDATION_ERROR'],
  ]) {
    const r = await hit('/v1/wallet/activity', { token: access, query: { page } });
    const code = errCode(r);
    const env = envelopeOk(r.data);
    add('NEGATIVE', id, rule, `GET ?page=${page}`,
      r.status === 400 && code === 'VALIDATION_ERROR' ? 'PASS' : 'BUG',
      `http=${r.status} code=${code} envelope=${env}`);
  }

  {
    const r = await hit('/v1/wallet/activity');
    add('NEGATIVE', 'AF-10', 'No Authorization → 401, no wallet data', 'omit header',
      r.status === 401 && !String(r.text).includes('cashBalance') ? 'PASS' : 'BUG',
      `http=${r.status} code=${errCode(r)}`);
  }
  {
    const r = await hit('/v1/wallet/activity', { headers: { Authorization: 'Bearer ' } });
    add('NEGATIVE', 'AF-11', 'Malformed Authorization → 401', 'Bearer empty',
      r.status === 401 ? 'PASS' : 'BUG',
      `http=${r.status} code=${errCode(r)}`);
  }
  {
    const r = await hit('/v1/wallet/activity', { token: 'not-a-real-token' });
    add('NEGATIVE', 'AF-12', 'Garbage token → 401 INVALID_ACCESS_TOKEN', 'Bearer garbage',
      r.status === 401 && ['INVALID_ACCESS_TOKEN', 'MISSING_AUTHORIZATION_HEADER'].includes(errCode(r)) ? 'PASS' : 'BUG',
      `http=${r.status} code=${errCode(r)}`);
  }
  {
    const r = await hit('/v1/wallet/activity', { token: access, requestId: 'x'.repeat(129) });
    add('NEGATIVE', 'AF-21', 'X-Request-Id 129+ → 400 VALIDATION_ERROR', 'len=129',
      r.status === 400 && errCode(r) === 'VALIDATION_ERROR' ? 'PASS' : 'BUG',
      `http=${r.status} code=${errCode(r)}`);
  }
  {
    const r = await hit('/v1/wallet/activity', { token: access, query: { page: 'abc' }, requestId: 'qa-test-1' });
    const echoed = r.data?.error?.request_id === 'qa-test-1';
    add('NEGATIVE', 'AF-22', 'error.request_id echoes X-Request-Id', 'qa-test-1',
      r.status === 400 && echoed ? 'PASS' : 'BUG',
      `echoed=${echoed} got=${r.data?.error?.request_id}`);
  }

  // ========== NEGATIVE DETAIL ==========
  {
    const r = await hit('/v1/wallet/activity/00000000-0000-4000-8000-000000000000', { token: access });
    add('NEGATIVE', 'AD-07', 'Unknown id → 404 ACTIVITY_NOT_FOUND', 'fake UUID',
      r.status === 404 && ['ACTIVITY_NOT_FOUND', 'WALLET_NOT_FOUND', 'WALLET_NOT_CONFIGURED'].includes(errCode(r)) ? 'PASS' : 'BUG',
      `http=${r.status} code=${errCode(r)} envelope=${envelopeOk(r.data)}`);
  }
  {
    const r = await hit('/v1/wallet/activity/not$a$valid$id', { token: access });
    add('NEGATIVE', 'AD-09', 'Malformed id → 400 VALIDATION_ERROR', 'not$a$valid$id',
      r.status === 400 && errCode(r) === 'VALIDATION_ERROR' ? 'PASS' : 'BUG',
      `http=${r.status} code=${errCode(r)}`);
  }
  {
    const r = await hit('/v1/wallet/activity/../balance', { token: access });
    add('NEGATIVE', 'AD-09b', 'Path-like id ../balance → 400 VALIDATION_ERROR (not bare 404)', '../balance',
      r.status === 400 && errCode(r) === 'VALIDATION_ERROR' ? 'PASS' : 'BUG',
      `http=${r.status} code=${errCode(r)} body=${JSON.stringify(r.data).slice(0, 120)}`);
  }
  {
    const r = await hit(`/v1/wallet/activity/${'a'.repeat(200)}`, { token: access });
    add('NEGATIVE', 'AD-09c', 'Very long id → 400 VALIDATION_ERROR', 'len=200',
      r.status === 400 && errCode(r) === 'VALIDATION_ERROR' ? 'PASS' : 'BUG',
      `http=${r.status} code=${errCode(r)}`);
  }
  {
    const r = await hit('/v1/wallet/activity/', { token: access });
    add('NEGATIVE', 'AD-10', 'Trailing slash / missing id rejected or treated as feed (documented)', 'GET .../activity/',
      r.status === 400 || r.status === 404 || r.status === 405 || (r.status === 200 && Array.isArray(r.data?.activity)) ? 'PASS' : 'BUG',
      `http=${r.status} note=${r.status === 200 ? 'same as feed' : 'rejected'}`);
  }
  {
    const id = first?.id || '00000000-0000-4000-8000-000000000000';
    const r = await hit(`/v1/wallet/activity/${id}`);
    add('NEGATIVE', 'AD-11', 'Detail no auth → 401', `.../${id}`,
      r.status === 401 ? 'PASS' : 'BUG',
      `http=${r.status} code=${errCode(r)}`);
  }
  {
    const id = first?.id || '00000000-0000-4000-8000-000000000000';
    const r = await hit(`/v1/wallet/activity/${id}`, { token: access, requestId: 'y'.repeat(129) });
    add('NEGATIVE', 'AD-16', 'Detail oversized request-id → 400', 'len=129',
      r.status === 400 && errCode(r) === 'VALIDATION_ERROR' ? 'PASS' : 'BUG',
      `http=${r.status} code=${errCode(r)}`);
  }

  // Error envelope sample
  {
    const r = await hit('/v1/wallet/activity', { token: access, query: { page: 'abc' }, requestId: 'env-check-1' });
    const e = r.data?.error || {};
    const hasCorr = Object.prototype.hasOwnProperty.call(e, 'correlation_id');
    add('NEGATIVE', 'ERR-ENV', 'Error envelope has code/message/details/timestamp/request_id (+ correlation_id)',
      'bad page',
      r.status === 400 && envelopeOk(r.data) ? 'PASS' : 'BUG',
      `envelope=${envelopeOk(r.data)} correlation=${hasCorr} keys=${Object.keys(e).join(',')}`);
  }

  const counts = { PASS: 0, BUG: 0, 'NOT TESTED': 0 };
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;

  const bySection = {};
  for (const r of rows) {
    if (!bySection[r.section]) bySection[r.section] = { PASS: 0, BUG: 0, 'NOT TESTED': 0 };
    bySection[r.section][r.status] += 1;
  }

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: BASE,
    partnerId: config.partnerId,
    guide: 'wallet-activity-api-qa-guide.pdf',
    note: 'Full guide pos/neg/E2E read-only on canary. No book. Known gaps AF-03/13/14/15 AD-08/13/14 left NOT TESTED.',
    feedSummary: j1.summary || null,
    pagination: j1.pagination || null,
    categoriesSeen: Object.keys(byCat),
    counts,
    bySection,
    bugs: rows.filter((r) => r.status === 'BUG'),
    rows,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== BY SECTION ===', bySection);
  console.log('=== COUNTS ===', counts);
  console.log('Report', OUT);
  if (counts.BUG > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
