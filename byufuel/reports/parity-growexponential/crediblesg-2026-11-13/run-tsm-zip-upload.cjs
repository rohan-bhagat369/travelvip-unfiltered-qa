/** TC09 bulk zip upload only */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const BASE = 'https://uat-byufuel.crediblesg.com';
const OUT = path.join(__dirname, 'tsm-web-results.json');

async function login(page) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const set = (el, v) => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set(document.querySelectorAll('input')[0], 'amaan@crediblesg.com');
    set(document.querySelector('input[type=password]'), 'Byufuel@2552');
    const btn = [...document.querySelectorAll('button')].find((b) => /login/i.test(b.textContent || ''));
    if (btn) {
      btn.disabled = false;
      btn.click();
    }
  });
  await page.waitForURL(/dsh|dashboard|byu|uam|iam/i, { timeout: 60000 });
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  await login(page);
  await page.goto(`${BASE}/uam/tsm-zipcodes`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.getByRole('button', { name: /Download TSM ZipCodes/i }).click(),
  ]);
  const dlPath = path.join(__dirname, `_tsm_zip_dl_${Date.now()}.xlsx`);
  await download.saveAs(dlPath);
  const wb = XLSX.readFile(dlPath);
  const sheetName = wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(sheetName ? wb.Sheets[sheetName] : {}, { defval: '' });
  let patched = false;
  for (const r of rows) {
    const keys = Object.keys(r);
    const pinKey = keys.find((k) => /pin|zip/i.test(k));
    const emailKey = keys.find((k) => /email/i.test(k));
    if (pinKey && emailKey && /grow\.tsm\.1118/i.test(String(r[emailKey]))) {
      r[pinKey] = '500001';
      patched = true;
      break;
    }
  }
  if (!patched) {
    // append a row for GrowTsm if template empty pin exists
    for (const r of rows) {
      const keys = Object.keys(r);
      const pinKey = keys.find((k) => /pin|zip/i.test(k));
      if (pinKey && (!r[pinKey] || String(r[pinKey]).trim() === '')) {
        r[pinKey] = '500001';
        const emailKey = keys.find((k) => /email/i.test(k));
        if (emailKey) r[emailKey] = 'grow.tsm.1118@yopmail.com';
        patched = true;
        break;
      }
    }
  }
  if (!patched && rows.length) {
    const keys = Object.keys(rows[0]);
    const pinKey = keys.find((k) => /pin|zip/i.test(k)) || 'PinCode';
    rows[0][pinKey] = '500001';
    patched = true;
  }
  const outSheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Email: 'grow.tsm.1118@yopmail.com', PinCode: '500001' }]);
  const outWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(outWb, outSheet, sheetName || 'Sheet1');
  const upPath = path.join(__dirname, `_tsm_zip_up_${Date.now()}.xlsx`);
  XLSX.writeFile(outWb, upPath);

  await page.getByRole('button', { name: /Upload TSM ZipCodes/i }).click();
  await page.waitForTimeout(800);
  let http = 0;
  const fileInput = page.locator('input[type=file]').first();
  const respP = page
    .waitForResponse((r) => /zip|upload|import|tsm/i.test(r.url()) && !['GET', 'OPTIONS'].includes(r.request().method()), {
      timeout: 45000,
    })
    .catch(() => null);
  await fileInput.setInputFiles(upPath);
  const upBtn = page.getByRole('button', { name: /^(Upload|Submit|Save|Ok)$/i });
  if (await upBtn.count()) await upBtn.first().click().catch(() => {});
  const resp = await respP;
  if (resp) http = resp.status();
  await page.waitForTimeout(2000);
  await page.getByPlaceholder(/Quick search/i).fill('500001');
  await page.getByRole('button', { name: /Run quick search/i }).click();
  await page.waitForTimeout(1500);
  const body = await page.locator('body').innerText();
  const shown = /500001/.test(body);
  const result = {
    id: 9,
    tc: 'TC09',
    status: http === 200 || shown ? 'PASS' : 'FAIL',
    actual: `Download OK · patched→500001 · upload HTTP ${http || 'n/a'} · list ${shown ? 'shows 500001' : 'no 500001'} · ${path.basename(upPath)}`,
  };

  const prior = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { results: [] };
  const results = prior.results || [];
  const i = results.findIndex((r) => r.id === 9);
  if (i >= 0) results[i] = result;
  else results.push(result);
  fs.writeFileSync(OUT, JSON.stringify({ ...prior, when: new Date().toISOString(), results }, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
