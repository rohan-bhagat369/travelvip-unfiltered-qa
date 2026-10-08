/**
 * Own Chromium process — does NOT use Playwright MCP (avoids fighting parent browser).
 * Tunnel only. Skips mutating SCH-000006640.
 *
 *   node scripts/probe-byufuel-parallel-remaining.js
 *   HEADED=1 node scripts/probe-byufuel-parallel-remaining.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BYUFUEL_BASE || 'https://creature-bacon-travel-realm.trycloudflare.com';
const EMAIL = process.env.BYUFUEL_ADMIN_EMAIL || 'adminm@yopmail.com';
const PASS = process.env.BYUFUEL_ADMIN_PASS || 'Byufuel@12345';
const HEADED = process.env.HEADED === '1' || process.env.HEADED === 'true';
const OUT_DIR = path.join(__dirname, '..', 'reports', 'byufuel-drive');
const OUT_JSON = path.join(OUT_DIR, 'parallel-remaining-2026-09-24.json');
const SKIP_SCH = 'SCH-000006640';

function row(id, rule, how, status, expected, actual, evidence) {
  return { id, rule, howTested: how, status, expected, actual, evidence: evidence || null };
}

async function login(page) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.getByRole('textbox', { name: 'Email' }).fill(EMAIL);
  await page.getByRole('textbox', { name: 'Password' }).fill(PASS);
  await page.getByRole('button', { name: 'Login' }).click();
  await page.waitForTimeout(4000);
  if (!(await page.evaluate(() => !!localStorage.getItem('bf:access_token')))) {
    throw new Error('Login failed — no bf:access_token');
  }
}

async function mainText(page) {
  return ((await page.locator('main').innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const cases = [];
  const browser = await chromium.launch({ headless: !HEADED });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  try {
    await login(page);

    // #29 Supplier Penalty
    await page.goto(`${BASE}/byu/supplier-cancellation-amounts`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3500);
    const penMain = await mainText(page);
    const penTitle = await page.title();
    const penEmpty = /NO DATA AVAILABLE|0 of 0/i.test(penMain);
    let penPost = null;
    try {
      penPost = await page.evaluate(async () => {
        const token = JSON.parse(localStorage.getItem('bf:access_token') || 'null');
        const r = await fetch('/api/supplier-cancellation-amounts', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({}),
        });
        return { status: r.status, body: (await r.text()).slice(0, 400) };
      });
    } catch (e) {
      penPost = { error: String(e.message || e) };
    }
    cases.push(
      row(
        'P29',
        '#29 Supplier Penalty',
        'Open /byu/supplier-cancellation-amounts; empty POST probe',
        penTitle.includes('Cancellation') || /PENALTY|SCHEDULE CODE/i.test(penMain) ? (penPost?.status === 201 ? 'BUG' : 'PASS') : 'FAIL',
        'List loads; empty POST rejected 4xx',
        `title=${penTitle}; emptyGrid=${penEmpty}; POST status=${penPost?.status}; body=${penPost?.body || penPost?.error}`,
        { url: page.url(), penPost }
      )
    );

    // #31 Incoming Deliveries
    await page.goto(`${BASE}/byu/incoming-deliveries`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3500);
    const incMain = await mainText(page);
    const has6640 = incMain.includes(SKIP_SCH);
    const hasOther = /SCH-00000662[0-9]|SCH-00000661/i.test(incMain);
    const gridEmpty = /NO DATA AVAILABLE|Items per page:.*0 of 0/i.test(incMain) && !/SCH-/i.test(incMain);
    const tabResults = {};
    for (const tab of ['All', 'Ongoing', 'Upcoming', 'History']) {
      const t = page.getByRole('tab', { name: new RegExp(`^${tab}$`, 'i') });
      if (await t.count()) {
        await t.first().click().catch(() => {});
        await page.waitForTimeout(1500);
        const m = await mainText(page);
        tabResults[tab] = {
          hasSch: /SCH-/i.test(m),
          empty: /0 of 0/i.test(m) && !/SCH-/i.test(m),
          snippet: m.slice(0, 220),
        };
      } else {
        tabResults[tab] = { missingTab: true };
      }
    }
    cases.push(
      row(
        'P31',
        '#31 Incoming Deliveries',
        'Open Incoming; cycle All/Ongoing/Upcoming/History; do not open SCH-6640',
        gridEmpty ? 'FAIL' : 'PASS',
        'Grids show schedules; tabs usable',
        `hasOther=${hasOther}; has6640Listed=${has6640}; gridEmpty=${gridEmpty}; tabs=${JSON.stringify(tabResults)}`,
        { url: page.url(), tabResults }
      )
    );

    // Supplier Payment smoke
    await page.goto(`${BASE}/byu/supplier-payments`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(async () => {
      await page.goto(`${BASE}/byu/payments`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    });
    await page.waitForTimeout(3000);
    let payUrl = page.url();
    let payMain = await mainText(page);
    if (!/payment/i.test(payUrl + payMain + (await page.title()))) {
      // try menu click
      const link = page.getByRole('link', { name: /Supplier Payment/i });
      if (await link.count()) {
        await link.first().click();
        await page.waitForTimeout(3000);
        payUrl = page.url();
        payMain = await mainText(page);
      }
    }
    cases.push(
      row(
        'P28-smoke',
        '#28 Supplier Payment (smoke)',
        'Open Supplier Payment list read-only',
        /payment|CREDITED|VERIFIED|SCH-/i.test(payMain + payUrl) ? 'PASS' : 'NOT TESTED',
        'List page loads',
        `url=${payUrl}; snippet=${payMain.slice(0, 280)}`,
        { url: payUrl }
      )
    );

    // Drop — web only
    const dropLink = page.getByRole('link', { name: /drop/i });
    const dropCount = await dropLink.count();
    cases.push(
      row(
        'P-DROP',
        'Supplier Drop (web)',
        'Look for Drop in admin/supplier web nav',
        dropCount ? 'PASS' : 'NOT TESTED',
        'Drop reachable on web or document APK-only',
        dropCount ? `found ${dropCount} drop link(s)` : 'No Drop nav on admin web — likely APK-only',
        null
      )
    );
  } catch (e) {
    cases.push(row('SETUP', 'Parallel probe setup', 'Login + navigate tunnel', 'FAIL', 'Tunnel reachable', String(e.message || e), null));
  } finally {
    await browser.close().catch(() => {});
  }

  const summary = cases.reduce(
    (a, c) => {
      a[c.status] = (a[c.status] || 0) + 1;
      return a;
    },
    {}
  );
  const report = {
    ranAt: new Date().toISOString(),
    portal: BASE,
    browser: 'own-chromium (not MCP)',
    headed: HEADED,
    skippedSchedule: SKIP_SCH,
    summary,
    cases,
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
  const notes = path.join(OUT_DIR, 'PARALLEL-AGENT-NOTES.md');
  fs.writeFileSync(
    notes,
    `# Parallel remaining QA\n\n- Ran: ${report.ranAt}\n- Browser: **own Chromium** (separate from parent MCP)\n- Portal: ${BASE}\n- Skipped mutate: ${SKIP_SCH}\n- Summary: ${JSON.stringify(summary)}\n\nSee \`${path.basename(OUT_JSON)}\`.\n`
  );
  console.log(JSON.stringify({ out: OUT_JSON, summary, cases: cases.map((c) => ({ id: c.id, status: c.status })) }, null, 2));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
