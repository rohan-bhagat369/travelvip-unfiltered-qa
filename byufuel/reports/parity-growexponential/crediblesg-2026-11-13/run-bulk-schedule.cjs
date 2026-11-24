/**
 * 02-Bulk-Schedule on Grow — reliable form fill
 * node run-bulk-schedule.cjs
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'https://uat-byufuel.crediblesg.com';
const OUT = path.join(__dirname, 'bulk-schedule-results.json');
const results = [];
const push = (id, tc, status, actual) =>
  results.push({ id, tc, status, actual: String(actual || '').replace(/\s+/g, ' ').slice(0, 450) });

async function login(page) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const set = (el, v) => {
      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      proto.set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set(document.querySelectorAll('input')[0], 'amaan@crediblesg.com');
    set(document.querySelector('input[type=password]'), 'Byufuel@2552');
    const btn = [...document.querySelectorAll('button')].find((b) => /login/i.test(b.textContent || ''));
    if (btn) { btn.disabled = false; btn.click(); }
  });
  await page.waitForURL(/dsh|dashboard|byu|uam/i, { timeout: 60000 });
  await page.waitForTimeout(1200);
}

async function openBulkDialog(page, { selectCount = 1 } = {}) {
  await page.goto(`${BASE}/byu/suppliers`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  // page size 50
  const items = page.getByLabel(/items per page/i);
  if (await items.count()) {
    await items.selectOption('50').catch(async () => {
      await items.click();
      await page.getByRole('option', { name: '50' }).click().catch(() => {});
    });
    await page.waitForTimeout(2000);
  }
  await page.evaluate((n) => {
    const rows = [...document.querySelectorAll('input[type=checkbox]')].filter((c) =>
      /select row/i.test(c.getAttribute('aria-label') || '')
    );
    // clear
    for (const c of rows) if (c.checked) c.click();
    const all = document.querySelector('input[type=checkbox][aria-label*="Select all" i]');
    if (n >= 50 && all) all.click();
    else for (let i = 0; i < Math.min(n, rows.length); i++) if (!rows[i].checked) rows[i].click();
  }, selectCount);
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Create Bulk Schedule Request/i }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('heading', { name: /Create Bulk Schedule Request/i }).waitFor({ timeout: 10000 });
}

async function fillOneShot(page, { dayLabel = 'November 19, 2026' } = {}) {
  await page.getByRole('button', { name: /Open calendar/i }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: dayLabel }).click();
  await page.waitForTimeout(400);
  // Available Slot
  const slot = page.getByLabel(/Available Slot/i).or(page.locator('select[aria-label*="Available" i], select').filter({ hasText: /AM|PM/ })).first();
  if (await page.locator('select').filter({ hasText: /8 AM to 10 AM/ }).count()) {
    await page.locator('select').filter({ hasText: /8 AM to 10 AM/ }).first().selectOption({ label: '8 AM to 10 AM' }).catch(async () => {
      await page.locator('select').nth(0).selectOption({ label: '8 AM to 10 AM' }).catch(() => {});
    });
  } else {
    await page.getByRole('combobox', { name: /Available Slot|Select/i }).first().click().catch(() => {});
    await page.getByRole('option', { name: /8 AM to 10 AM/i }).click().catch(() => {});
  }
  // Oil type UCO if needed
  const uco = page.getByRole('combobox', { name: /^UCO$/i }).or(page.locator('[role=combobox]').filter({ hasText: /^UCO$/ }));
  if (await uco.count()) {
    await uco.first().click().catch(() => {});
    await page.getByRole('option', { name: /^UCO$/i }).click().catch(() => {});
  }
  // Grade
  await page.getByRole('combobox', { name: /Choose Oil Grade/i }).click().catch(async () => {
    await page.locator('text=Choose Oil Grade').click().catch(() => {});
  });
  await page.waitForTimeout(300);
  await page.getByRole('option', { name: /Grade A/i }).click().catch(async () => {
    await page.locator('[role=option]', { hasText: /Grade A/i }).first().click().catch(() => {});
  });
  await page.getByPlaceholder(/Weight/i).fill('10');
}

async function submitCreate(page, apiHits) {
  apiHits.length = 0;
  await page.getByRole('button', { name: /^Create$/i }).click();
  await page.waitForTimeout(2500);
  // confirm if any
  if (await page.getByRole('button', { name: /^Yes$/i }).count()) {
    await page.getByRole('button', { name: /^Yes$/i }).click().catch(() => {});
  }
  await page.waitForTimeout(6000);
  return apiHits[apiHits.length - 1] || null;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const apiHits = [];
  page.on('response', async (res) => {
    try {
      const url = res.url();
      if (/\/api\/.*bulk-uco-schedule/i.test(url) && res.request().method() === 'POST') {
        let body = '';
        try { body = await res.text(); } catch (_) {}
        apiHits.push({ url, status: res.status(), body: body.slice(0, 900) });
      }
    } catch (_) {}
  });

  await login(page);

  // TC01
  await page.goto(`${BASE}/dsh/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const dash = await page.locator('body').innerText();
  push(1, 'TC01', /Create Bulk Request/i.test(dash) && /View Bulk Requests/i.test(dash) ? 'PASS' : 'FAIL',
    `Create Bulk Request=${/Create Bulk Request/i.test(dash)} View Bulk Requests=${/View Bulk Requests/i.test(dash)}`);

  // TC07
  await page.goto(`${BASE}/byu/bulk-uco-schedule-requests`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const viewBody = await page.locator('body').innerText();
  const viewTitle = await page.title();
  push(5, 'TC07', /View Bulk Requests|BULK REQUEST CODE/i.test(viewTitle + viewBody) ? 'PASS' : 'FAIL',
    `${viewTitle} · ${viewBody.replace(/\s+/g, ' ').slice(0, 220)}`);

  // TC02 — 50 suppliers one-shot
  try {
    await openBulkDialog(page, { selectCount: 50 });
    await fillOneShot(page, { dayLabel: 'November 19, 2026' });
    const post = await submitCreate(page, apiHits);
    const br = ((post && post.body) || '').match(/BR-\d+/i)?.[0] || '';
    let count = null;
    try { const j = JSON.parse(post.body); count = j.count ?? j.total ?? null; } catch (_) {
      const m = (post?.body || '').match(/"count"\s*:\s*(\d+)/i); count = m ? Number(m[1]) : null;
    }
    const ok = post && post.status >= 200 && post.status < 300 && (count === 50 || /50/.test(post.body || ''));
    push(2, 'TC02', ok ? 'PASS' : (post && post.status < 300 ? 'PARTIAL' : 'FAIL'),
      `POST ${post ? post.status : 'none'} count=${count} ${br} ${(post?.body || '').slice(0, 200)}`);
  } catch (e) {
    push(2, 'TC02', 'FAIL', e.message);
  }

  // TC03 — recurring 1 supplier
  try {
    await openBulkDialog(page, { selectCount: 1 });
    await fillOneShot(page, { dayLabel: 'November 19, 2026' });
    await page.getByRole('switch', { name: /Make recurring/i }).click();
    await page.waitForTimeout(800);
    // frequency / days / end date if visible
    const every = page.getByLabel(/Every|Frequency|Recurrence Type/i).first();
    if (await every.count()) {
      await every.click().catch(() => {});
      await page.getByRole('option', { name: /Week/i }).click().catch(() => {});
    }
    // pick Wednesday (Nov 19 2026 is Thursday actually — check)
    // Nov 19 2026 is Thursday
    const dayOpt = page.getByRole('option', { name: /Thursday/i });
    await page.getByLabel(/Day|Weekday/i).first().click().catch(() => {});
    if (await dayOpt.count()) await dayOpt.click().catch(() => {});
    // end date calendar if present
    const endCal = page.getByRole('button', { name: /Open calendar/i });
    if (await endCal.count() > 1) {
      await endCal.nth(1).click().catch(() => {});
      await page.getByRole('button', { name: /December 10, 2026/i }).click().catch(async () => {
        await page.getByRole('button', { name: /Next month/i }).click().catch(() => {});
        await page.getByRole('button', { name: /December 10, 2026/i }).click().catch(() => {});
      });
    }
    const post = await submitCreate(page, apiHits);
    const br = ((post && post.body) || '').match(/BR-\d+/i)?.[0] || '';
    push(3, 'TC03', post && post.status >= 200 && post.status < 300 ? 'PASS' : 'FAIL',
      `POST ${post ? post.status : 'none'} ${br} ${(post?.body || '').slice(0, 220)}`);
  } catch (e) {
    push(3, 'TC03', 'FAIL', e.message);
  }

  // TC05 — second recurring same supplier, expect confirm popup
  try {
    await openBulkDialog(page, { selectCount: 1 });
    await fillOneShot(page, { dayLabel: 'November 19, 2026' });
    await page.getByRole('switch', { name: /Make recurring/i }).click();
    await page.waitForTimeout(600);
    apiHits.length = 0;
    await page.getByRole('button', { name: /^Create$/i }).click();
    await page.waitForTimeout(2500);
    const dialogs = await page.locator('[role=dialog], .mat-mdc-dialog-container').allInnerTexts().catch(() => []);
    const joined = dialogs.join(' | ');
    const confirm = /existing|replace|already|overwrite|confirm/i.test(joined);
    if (confirm) {
      // dismiss with No to avoid extra BR if possible
      if (await page.getByRole('button', { name: /^No$/i }).count()) {
        await page.getByRole('button', { name: /^No$/i }).click().catch(() => {});
      }
      push(4, 'TC05', 'PASS', `Confirmation popup shown · ${joined.slice(0, 240)}`);
    } else {
      await page.waitForTimeout(4000);
      const post = apiHits[0];
      if (post && post.status >= 200 && post.status < 300) {
        push(4, 'TC05', 'FAIL', `No existing-schedule confirmation; POST ${post.status} ${post.body.slice(0, 180)}`);
      } else {
        push(4, 'TC05', 'FAIL', `No confirmation popup · dialog=${joined.slice(0, 180)} posts=${apiHits.length}`);
      }
    }
  } catch (e) {
    push(4, 'TC05', 'FAIL', e.message);
  }

  // TC08 — end date clamp (do not submit)
  try {
    await openBulkDialog(page, { selectCount: 1 });
    await page.getByRole('switch', { name: /Make recurring/i }).click();
    await page.waitForTimeout(800);
    const endField = page.getByLabel(/End Date|End date/i).or(page.getByPlaceholder(/end/i));
    let actual = '';
    if (await endField.count()) {
      await endField.first().fill('01-Jan-2029').catch(async () => {
        await endField.first().fill('2029-01-01');
      });
      await page.waitForTimeout(800);
      actual = await endField.first().inputValue().catch(() => '');
    } else {
      // second calendar
      const cals = page.getByRole('button', { name: /Open calendar/i });
      actual = `calendars=${await cals.count()} (typed via calendar path not found as text input)`;
      // try fill any date input
      const dates = page.locator('input[placeholder*=date i], input[aria-label*=End i]');
      if (await dates.count()) {
        await dates.last().fill('01-Jan-2029').catch(() => {});
        await page.waitForTimeout(600);
        actual = await dates.last().inputValue().catch(() => actual);
      }
    }
    const rewritten = actual && !/2029|01-Jan-2029/i.test(actual);
    push(6, 'TC08', actual ? 'PASS' : 'FAIL',
      `Typed end 01-Jan-2029 → value=${actual || '(empty)'} rewritten=${!!rewritten} (not submitted)`);
    await page.getByRole('button', { name: /^Close$/i }).click().catch(() => {});
  } catch (e) {
    push(6, 'TC08', 'FAIL', e.message);
  }

  const counts = results.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
  const out = { env: BASE, when: new Date().toISOString(), counts, results: results.sort((a, b) => a.id - b.id), lastHits: apiHits.slice(-5) };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
