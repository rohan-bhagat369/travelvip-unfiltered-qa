/**
 * Hotel B2B pre-deploy regression — same repo (Travel VIP API Automation).
 *
 *   $env:BASE_URL='https://api-staging.travelvip.ai'
 *   $env:TIER_ID='10546901'
 *   npm run hotel:regression
 *
 * Tags (comma): SMOKE,LISTING,STARBOOK,UNAVAIL,STARSRP,CHAINBRAND,CHAINBRANDVAL,NEGPRICE,AUTH,VALIDATE,ENCRYPT,CORR,E2E,PRICE,PAN,GST,CANCEL,TWONAME,RIYA
 * Default = SMOKE through CANCEL including UNAVAIL/STARSRP/CHAINBRAND/NEGPRICE (no book for those tags).
 * Reschedule is permanently out of this pack (hotel and flight).
 *
 *   npm run hotel:regression:smoke
 *   node scripts/hotel-regression-suite.js --tags LISTING,VALIDATE
 *   node scripts/hotel-regression-suite.js --tags NEGPRICE
 *   node scripts/hotel-regression-suite.js --tags E2E,PRICE,CANCEL
 */
import path from 'path';
import { randomUUID } from 'crypto';
import { config } from '../../../shared/config/env.js';
import { openHotelSession } from '../src/regression/session.js';
import { tally, printTables } from '../src/regression/report.js';
import { writeRegressionReports } from '../src/regression/writeReports.js';
import { runSmoke } from '../src/regression/layers/smoke.js';
import { runListing } from '../src/regression/layers/listing.js';
import { runStarBook } from '../src/regression/layers/starBook.js';
import { runUnavail } from '../src/regression/layers/unavail.js';
import { runStarSrp } from '../src/regression/layers/starSrp.js';
import { runChainBrand, runChainBrandValue } from '../src/regression/layers/chainBrand.js';
import { runNegPrice } from '../src/regression/layers/negPrice.js';
import { runValidate } from '../src/regression/layers/validate.js';
import { runAuth } from '../src/regression/layers/auth.js';
import { runEncrypt } from '../src/regression/layers/encrypt.js';
import { runPanGst } from '../src/regression/layers/panGst.js';
import { runE2e } from '../src/regression/layers/e2ePrice.js';
import { scoreCorrelation } from '../src/regression/layers/corr.js';

const CWD = process.cwd();

const DEFAULT_TAGS = [
  'SMOKE', 'LISTING', 'STARBOOK', 'UNAVAIL', 'STARSRP', 'CHAINBRAND', 'NEGPRICE',
  'AUTH', 'VALIDATE', 'ENCRYPT', 'CORR',
  'PAN', 'GST', 'E2E', 'PRICE', 'CANCEL',
];

function parseTags() {
  const argv = process.argv.slice(2);
  const idx = argv.findIndex((a) => a === '--tags' || a.startsWith('--tags='));
  let raw = process.env.HOTEL_REGRESSION_TAGS || '';
  if (idx >= 0) {
    raw = argv[idx].includes('=') ? argv[idx].split('=')[1] : (argv[idx + 1] || '');
  }
  const tags = (raw || DEFAULT_TAGS.join(','))
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);
  return new Set(tags);
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

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  if (!process.env.BASE_URL) process.env.BASE_URL = 'https://api-staging.travelvip.ai';
  if (!process.env.TIER_ID || String(process.env.TIER_ID).trim() === '') {
    process.env.TIER_ID = '10546901';
  }
  if (!process.env.CORRELATION_ID) process.env.CORRELATION_ID = randomUUID();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || process.env.HOTEL_PID || 'vgm';

  const tags = parseTags();
  const failFast = process.argv.includes('--fail-fast');
  if (failFast) process.env.CATALOG_FAIL_FAST = '1';
  if (want(tags, 'PRICE', 'CANCEL') && !tags.has('E2E')) tags.add('E2E');
  if (want(tags, 'GST') && !tags.has('PAN')) tags.add('PAN');
  if (want(tags, 'VALIDATE')) tags.add('AUTH');
  if (tags.has('CORR') && !want(tags, 'SMOKE', 'ENCRYPT', 'PAN', 'E2E', 'TWONAME', 'RIYA')) {
    tags.add('SMOKE');
  }

  console.log('Hotel regression');
  console.log('Base:', config.baseUrl);
  console.log('Tier:', process.env.TIER_ID);
  console.log('Corr:', process.env.CORRELATION_ID);
  console.log('Tags:', [...tags].join(','));

  const rows = [];
  const started = Date.now();
  let ctx = { calls: [], corrId: process.env.CORRELATION_ID };

  const out = path.join(
    'reports',
    `hotel-regression-${envLabel(config.baseUrl)}-${stamp()}.json`,
  );

  const finish = (stoppedOn = null) => {
    const score = tally(rows);
    const report = {
      ranAt: new Date().toISOString(),
      elapsedMs: Date.now() - started,
      baseUrl: config.baseUrl,
      tags: [...tags],
      correlationId: process.env.CORRELATION_ID,
      suite: 'Hotel B2B regression',
      bookingRefId: ctx.bookingRefId || null,
      bookingStatus: ctx.bookingStatus || null,
      stoppedOn,
      score,
      hops: ctx.calls || [],
      rows,
    };
    const paths = writeRegressionReports(report, out);
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

  if (want(tags, 'LISTING')) {
    console.log('\n----- LISTING pack -----');
    rows.push(...await runListing(CWD));
    stopIfFailFast('LISTING');
  }

  if (want(tags, 'STARBOOK')) {
    console.log('\n----- STARBOOK filter/sort -----');
    rows.push(...await runStarBook(CWD));
    stopIfFailFast('STARBOOK');
  }

  if (want(tags, 'UNAVAIL')) {
    console.log('\n----- UNAVAIL no-availability SRP + details -----');
    rows.push(...await runUnavail(CWD));
    stopIfFailFast('UNAVAIL');
  }

  if (want(tags, 'STARSRP')) {
    console.log('\n----- STARSRP star filter vs details -----');
    rows.push(...await runStarSrp(CWD));
    stopIfFailFast('STARSRP');
  }

  if (want(tags, 'CHAINBRAND')) {
    console.log('\n----- CHAINBRAND Chain/Brand filters + regression -----');
    rows.push(...await runChainBrand(CWD));
    stopIfFailFast('CHAINBRAND');
  }

  if (want(tags, 'CHAINBRANDVAL')) {
    console.log('\n----- CHAINBRANDVAL Chain/Brand name spot-checks -----');
    rows.push(...await runChainBrandValue(CWD));
    stopIfFailFast('CHAINBRANDVAL');
  }

  if (want(tags, 'NEGPRICE')) {
    console.log('\n----- NEGPRICE no negative baseFare / breakup -----');
    rows.push(...await runNegPrice(CWD));
    stopIfFailFast('NEGPRICE');
  }

  if (want(tags, 'AUTH')) {
    console.log('\n----- AUTH token / refresh / user session -----');
    rows.push(...await runAuth(CWD));
    stopIfFailFast('AUTH');
  }

  if (want(tags, 'VALIDATE')) {
    console.log('\n----- VALIDATE payload -----');
    rows.push(...await runValidate(CWD));
    stopIfFailFast('VALIDATE');
  }

  const needLive = want(tags, 'SMOKE', 'ENCRYPT', 'CORR', 'PAN', 'GST', 'E2E', 'PRICE', 'CANCEL', 'TWONAME', 'RIYA');
  if (needLive) {
    ctx = await openHotelSession();
  }

  if (want(tags, 'SMOKE')) {
    console.log('\n----- SMOKE -----');
    rows.push(...await runSmoke(ctx));
    stopIfFailFast('SMOKE');
  }

  if (want(tags, 'ENCRYPT')) {
    console.log('\n----- ENCRYPT -----');
    rows.push(...await runEncrypt(ctx, { scanAllRiya: tags.has('RIYA') }));
    stopIfFailFast('ENCRYPT');
  }

  if (want(tags, 'PAN', 'GST', 'TWONAME')) {
    console.log('\n----- PAN / GST -----');
    rows.push(...await runPanGst(ctx, { twoName: tags.has('TWONAME') }));
    stopIfFailFast('PAN');
  }

  if (want(tags, 'E2E', 'PRICE', 'CANCEL')) {
    console.log('\n----- E2E / PRICE / CANCEL -----');
    rows.push(...await runE2e(ctx, {
      cancel: tags.has('CANCEL'),
      checkPrice: tags.has('PRICE') || tags.has('E2E'),
    }));
    stopIfFailFast('E2E');
  }

  if (want(tags, 'CORR')) {
    rows.push(...scoreCorrelation(ctx));
  }

  finish();
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exitCode = 1;
});
