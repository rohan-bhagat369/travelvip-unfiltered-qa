/**
 * WH checklist #23-28 on Grow after password reset.
 * Usage: node run-checklist-wh.cjs
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'https://uat-byufuel.crediblesg.com';
const EMAIL = 'mayurmwh1@byufuel.in';
const PASS = process.env.WH_PASS || 'uSi7PC$8';
const OUT = path.join(__dirname, 'checklist-wh-results.json');

async function login(page) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(500);
  await page.locator('input').first().fill(EMAIL);
  await page.locator('input[type=password]').fill(PASS);
  await page.getByRole('button', { name: /^Login$/i }).click();
  await page.waitForURL(/dsh|dashboard|byu|uam/i, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(2500);
  return { url: page.url(), title: await page.title(), body: (await page.locator('body').innerText()).slice(0, 500) };
}

async function probe(page, id, name, urlPath, expectRe, deep) {
  const r = { id, case: name, status: 'FAIL', actual: '' };
  try {
    await page.goto(`${BASE}${urlPath}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500);
    const title = await page.title();
    const body = await page.locator('body').innerText();
    const ok = expectRe.test(title + '\n' + body) && !/invalid credentials|access denied|403/i.test(body.slice(0, 400));
    r.actual = `${title} · ${body.replace(/\s+/g, ' ').slice(0, 180)}`;
    if (deep === 'container') {
      const add = page.getByRole('button', { name: /add new container/i });
      if (await add.count()) {
        await add.first().click();
        await page.waitForTimeout(800);
        const menu = await page.locator('[role=menu], .mat-mdc-menu-panel, .cdk-overlay-pane').innerText().catch(() => '');
        const hasDevice = /device/i.test(menu);
        const hasCamera = /camera/i.test(menu);
        const hasManual = /manual/i.test(menu);
        r.actual += ` · Add menu Device=${hasDevice} Camera=${hasCamera} Manual=${hasManual}`;
        if (hasManual && !hasDevice && !hasCamera) {
          r.status = 'FAIL';
          r.actual += ' · Manual-only';
          await page.keyboard.press('Escape').catch(() => {});
          return r;
        }
      }
    }
    if (deep === 'qr') {
      const gen = page.getByRole('button', { name: /generate/i }).first();
      if (await gen.count()) {
        await gen.click();
        await page.waitForTimeout(1000);
        const dlg = await page.locator('[role=dialog], .mat-mdc-dialog-container, .cdk-overlay-pane').innerText().catch(() => '');
        const attach = /existing|attach|container code|select container/i.test(dlg);
        r.actual += ` · Generate dialog: ${dlg.replace(/\s+/g, ' ').slice(0, 160)} · attachExisting=${attach}`;
        if (!attach) {
          r.status = 'FAIL';
          await page.keyboard.press('Escape').catch(() => {});
          return r;
        }
      }
    }
    r.status = ok ? 'PASS' : 'FAIL';
  } catch (e) {
    r.actual = String(e.message || e).slice(0, 240);
  }
  return r;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const results = [];
  const loginInfo = await login(page);
  const loginOk = /dashboard|worker|warehouse|check.?in|collect|container|qr/i.test(loginInfo.title + loginInfo.body + loginInfo.url)
    && !/invalid credentials/i.test(loginInfo.body);
  results.push({
    id: 23,
    case: 'Login',
    status: loginOk ? 'PASS' : 'FAIL',
    actual: loginOk
      ? `WH login OK · ${loginInfo.url} · ${loginInfo.title}`
      : `WH login FAIL · ${loginInfo.url} · ${loginInfo.body.slice(0, 200)}`,
  });

  if (loginOk) {
    // Notifications: open bell
    try {
      const bell = page.getByRole('button', { name: /notifications/i }).first();
      await bell.click();
      await page.waitForTimeout(1200);
      const panel = await page.locator('body').innerText();
      const hasPanel = /notification|unread|mark all|no notification/i.test(panel);
      results.push({
        id: 24,
        case: 'Notifications',
        status: hasPanel ? 'PASS' : 'FAIL',
        actual: hasPanel
          ? `Notifications panel opened · ${panel.replace(/\s+/g, ' ').slice(0, 200)}`
          : 'Bell clicked but panel text not recognized',
      });
      await page.keyboard.press('Escape').catch(() => {});
    } catch (e) {
      results.push({ id: 24, case: 'Notifications', status: 'FAIL', actual: String(e.message || e).slice(0, 200) });
    }

    results.push(await probe(page, 25, 'Generate QR Codes', '/uam/container-qr-codes', /qr/i, 'qr'));
    results.push(await probe(page, 26, 'Inventory >>Container', '/uam/container-management', /container/i, 'container'));
    results.push(await probe(page, 27, 'Checkin Oil', '/byu/checkin-oil', /check.?in|itinerary|incoming|delivery/i));
    results.push(await probe(page, 28, 'Collect Oil from Supplier', '/byu/collect-oil', /collect|schedule|supplier|oil/i));
  }

  const counts = results.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
  const out = { env: BASE, when: new Date().toISOString(), email: EMAIL, counts, results };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
