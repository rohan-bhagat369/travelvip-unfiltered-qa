/**
 * Flight B2B pre-deploy regression — no reschedule.
 *
 *   $env:BASE_URL='https://api-staging.travelvip.ai'
 *   $env:TIER_ID='10546901'
 *   npm run flight:regression
 *
 * Tags: SMOKE,SEARCH,AUTH,VALIDATE,CORR,E2E,PRICE,CANCEL
 */
import path from 'path';
import { randomUUID } from 'crypto';
import { config } from '../../../shared/config/env.js';
import { openFlightSession, scoreRiyaLeak } from '../src/regression/session.js';
import { tally, printTables, row } from '../../hotel/src/regression/report.js';
import { writeRegressionReports } from '../../hotel/src/regression/writeReports.js';
import { runSmoke } from '../src/regression/layers/smoke.js';
import { runSearch } from '../src/regression/layers/search.js';
import { runValidate } from '../src/regression/layers/validate.js';
import { runAuth } from '../../hotel/src/regression/layers/auth.js';
import { runE2e } from '../src/regression/layers/e2ePrice.js';
import { runProductAuth } from '../src/regression/layers/productAuth.js';
import { runCancel } from '../src/regression/layers/cancel.js';
import { scoreCorrelation } from '../../hotel/src/regression/layers/corr.js';

const CWD = process.cwd();
const DEFAULT_TAGS = ['SMOKE', 'SEARCH', 'AUTH', 'VALIDATE', 'CORR', 'E2E', 'PRICE', 'CANCEL'];

function parseTags() {
  const argv = process.argv.slice(2);
  const idx = argv.findIndex((a) => a === '--tags' || a.startsWith('--tags='));
  let raw = process.env.FLIGHT_REGRESSION_TAGS || '';
  if (idx >= 0) {
    raw = argv[idx].includes('=') ? argv[idx].split('=')[1] : (argv[idx + 1] || '');
  }
  return new Set(
    (raw || DEFAULT_TAGS.join(','))
      .split(',')
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean),
  );
}

function want(tags, ...names) {
  return names.some((n) => tags.has(n));
}

function envLabel(url) {
  const u = String(url || '');
  if (u.includes('staging')) return 'staging';
  if (u.includes('canary')) return 'canary';
  if (u.includes('preprod')) return 'preprod';
  return 'api';
}

async function main() {
  if (!process.env.BASE_URL) process.env.BASE_URL = 'https://api-staging.travelvip.ai';
  if (!process.env.TIER_ID || String(process.env.TIER_ID).trim() === '') {
    process.env.TIER_ID = '10546901';
  }
  if (!process.env.CORRELATION_ID) process.env.CORRELATION_ID = randomUUID();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  process.env.SKIP_RESCHEDULE = process.env.SKIP_RESCHEDULE || '1';

  const tags = parseTags();
  const failFast = process.argv.includes('--fail-fast');
  if (want(tags, 'PRICE', 'CANCEL') && !tags.has('E2E')) tags.add('E2E');
  if (want(tags, 'VALIDATE')) tags.add('AUTH');
  if (tags.has('CORR') && !want(tags, 'SMOKE', 'SEARCH', 'E2E', 'CANCEL')) tags.add('SMOKE');

  console.log('Flight regression');
  console.log('Base:', config.baseUrl);
  console.log('Tier:', process.env.TIER_ID);
  console.log('Corr:', process.env.CORRELATION_ID);
  console.log('Tags:', [...tags].join(','));

  const rows = [];
  const started = Date.now();
  let ctx = { calls: [], corrId: process.env.CORRELATION_ID };

  const out = path.join('reports', `flight-regression-${envLabel(config.baseUrl)}-${new Date().toISOString().slice(0, 10)}.json`);

  const finish = (stoppedOn = null) => {
    const score = tally(rows);
    const report = {
      suite: 'Flight B2B regression',
      ranAt: new Date().toISOString(),
      elapsedMs: Date.now() - started,
      baseUrl: config.baseUrl,
      tags: [...tags],
      correlationId: process.env.CORRELATION_ID,
      bookingRefId: ctx.bookingRefId || null,
      bookingStatus: ctx.bookingStatus || null,
      e2eBooks: ctx.e2eBooks || [],
      stoppedOn,
      score,
      hops: ctx.calls || [],
      rows,
    };
    const paths = writeRegressionReports(report, out, { latestFolder: 'flight-regression' });
    printTables(rows);
    console.log('\n========== SCORE ==========');
    console.log(score);
    console.log('JSON:  ', paths.jsonPath);
    console.log('MD:    ', paths.mdPath);
    console.log('HTML:  ', paths.htmlPath);
    console.log('Excel: ', paths.xlsxPath);
    console.log('Latest:', paths.latest.md);
    if (score.BUG > 0) process.exitCode = 1;
    return score;
  };

  const stopIfFailFast = (layer) => {
    if (failFast && tally(rows).BUG > 0) {
      finish(layer);
      process.exit(1);
    }
  };

  if (want(tags, 'AUTH')) {
    console.log('\n----- AUTH token / refresh / user session -----');
    rows.push(...await runAuth(CWD));
    stopIfFailFast('AUTH');
  }

  if (want(tags, 'VALIDATE')) {
    console.log('\n----- VALIDATE issue-ticket -----');
    rows.push(...await runValidate(CWD));
    stopIfFailFast('VALIDATE');
  }

  const needLive = want(tags, 'SMOKE', 'SEARCH', 'CORR', 'E2E', 'PRICE', 'CANCEL', 'AUTH');
  if (needLive) ctx = await openFlightSession();

  if (want(tags, 'AUTH') && ctx.client) {
    console.log('\n----- AUTH product APIs -----');
    rows.push(...await runProductAuth(ctx));
    stopIfFailFast('AUTH');
  }

  if (want(tags, 'SMOKE')) {
    console.log('\n----- SMOKE -----');
    rows.push(...await runSmoke(ctx));
    stopIfFailFast('SMOKE');
  }

  if (want(tags, 'SEARCH')) {
    console.log('\n----- SEARCH / dates / RT O&D -----');
    rows.push(...await runSearch(ctx, CWD));
    stopIfFailFast('SEARCH');
  }

  if (want(tags, 'E2E', 'PRICE', 'CANCEL')) {
    console.log('\n----- E2E / PRICE -----');
    rows.push(...await runE2e(ctx, {
      cancel: tags.has('CANCEL'),
      checkPrice: tags.has('PRICE') || tags.has('E2E'),
    }));
    stopIfFailFast('E2E');
  }

  if (want(tags, 'CANCEL')) {
    console.log('\n----- CANCEL -----');
    rows.push(...await runCancel(ctx));
    stopIfFailFast('CANCEL');
  }

  if (needLive) {
    const leak = scoreRiyaLeak(ctx);
    rows.push(row(leak.tag, leak.section, leak.id, leak.rule, leak.how, leak.expected, leak.actual, leak.status));
  }

  if (want(tags, 'CORR')) {
    rows.push(...scoreCorrelation(ctx).map((r) => ({
      ...r,
      tag: 'CORR',
      rule: String(r.rule || '').replace('hotel hops', 'flight hops'),
    })));
  }

  finish();
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exitCode = 1;
});
