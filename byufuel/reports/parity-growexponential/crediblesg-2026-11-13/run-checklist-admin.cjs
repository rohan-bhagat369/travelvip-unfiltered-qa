const { chromium } = require('d:/Travel VIP API Automation/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'https://uat-byufuel.crediblesg.com';
const OUT = path.join(__dirname, 'checklist-crediblesg-results.json');

const probes = [
  { id: 1, case: 'Login', kind: 'login' },
  { id: 2, case: 'User Management >>Roles', path: '/uam/roles', expect: /manage roles|new role/i },
  { id: 3, case: 'User Management >>Admin Users', path: '/uam/admin-users', expect: /admin/i },
  { id: 4, case: 'MDM >> Types', path: '/mdm/types', expect: /type/i },
  { id: 5, case: 'MDM >> UCO Configuration', path: '/mdm/uco-configuration', expect: /uco|configuration/i, deep: 'uco' },
  { id: 6, case: 'MDM>>Time Slots', path: '/mdm/time-slots', expect: /time|slot/i },
  { id: 7, case: 'MDM>>Countries', path: '/mdm/countries', expect: /countr/i },
  { id: 8, case: 'MDM>>Rate Configuration', path: '/mdm/rate-configuration', expect: /rate/i },
  { id: 9, case: 'Warehouse Management', path: '/uam/warehouses', expect: /warehouse/i },
  { id: 10, case: 'User Management >>WH Worker', path: '/uam/wh-workers', expect: /worker/i },
  { id: 11, case: 'Inventory >>Vehicles', path: '/byu/vehicles', expect: /vehicle/i },
  { id: 12, case: 'User Management >>Driver', path: '/uam/drivers', expect: /driver/i },
  { id: 13, case: 'User Management >>Supplier', path: '/uam/suppliers', expect: /supplier/i },
  { id: 14, case: 'Inventory >>Container', path: '/uam/container-management', expect: /container/i, deep: 'container' },
  { id: 15, case: 'Generate QR Codes', path: '/uam/container-qr-codes', expect: /qr/i },
  { id: 16, case: 'Inventory >>UCO', path: '/byu/uco', expect: /uco/i },
  { id: 17, case: 'Request Management', path: '/byu/uco-schedules', expect: /request|schedule|manage/i },
  { id: 18, case: 'Itinerary Management', path: '/byu/uco-schedule-itineraries', expect: /itinerary/i },
  { id: 19, case: 'Supplier Payment', path: '/byu/supplier-payment', expect: /payment/i, deep: 'pay' },
  { id: 20, case: 'Supplier Penalty', path: '/byu/supplier-cancellation-amounts', expect: /penalt|cancellation|amount/i },
  { id: 21, case: 'Customer Support', path: '/uam/customer-support', expect: /support|customer|message/i },
  { id: 22, case: 'Incoming Deliveries', path: '/byu/incoming-deliveries', expect: /incoming|deliver/i },
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const results = [];

  // Login
  await page.goto(BASE + '/auth/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.getByRole('textbox', { name: /email/i }).fill('amaan@crediblesg.com');
  await page.getByRole('textbox', { name: /^Password$/i }).fill('Byufuel@2552');
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForTimeout(2500);
  const loggedIn = !page.url().includes('/auth/login');
  results.push({
    id: 1,
    case: 'Login',
    status: loggedIn ? 'PASS' : 'FAIL',
    actual: loggedIn ? `Admin login OK · ${page.url()}` : 'Login failed',
  });
  if (!loggedIn) {
    fs.writeFileSync(OUT, JSON.stringify({ env: BASE, results }, null, 2));
    await browser.close();
    process.exit(1);
  }

  for (const p of probes.slice(1)) {
    await page.goto(BASE + p.path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    if (page.url().includes('/auth/login')) {
      results.push({ id: p.id, case: p.case, status: 'FAIL', actual: 'Redirected to login' });
      continue;
    }
    const title = await page.title();
    const body = await page.evaluate(() => document.body.innerText.slice(0, 3500));
    const headings = await page.locator('h1,h2,h3').allTextContents().catch(() => []);
    const hay = `${title}\n${headings.join('\n')}\n${body}`;
    let status = 'PASS';
    let actual = `${title} · ${headings.filter(Boolean).slice(0, 2).join(' / ')}`.slice(0, 180);

    if (body.trim().length < 40) {
      status = 'FAIL';
      actual = 'Empty page';
    } else if (/403|forbidden|access denied|something went wrong/i.test(body)) {
      status = 'FAIL';
      actual = body.slice(0, 160).replace(/\s+/g, ' ');
    } else if (!p.expect.test(hay)) {
      status = 'PARTIAL';
      actual = `Loaded, expected label weak · ${actual}`;
    }

    if (p.deep === 'container') {
      const add = page.getByRole('button', { name: /Add New Container/i });
      if (await add.count()) {
        await add.first().click();
        await page.waitForTimeout(500);
        const menu = await page.evaluate(() => document.body.innerText);
        const hasDevice = /\bDevice\b/i.test(menu);
        const hasCamera = /\bCamera\b/i.test(menu);
        const hasManual = /\bManual\b/i.test(menu);
        await page.keyboard.press('Escape');
        if (hasManual && !(hasDevice && hasCamera)) {
          status = 'FAIL';
          actual = `Add New Container menu Manual-only (Device=${hasDevice}, Camera=${hasCamera})`;
        } else {
          actual += ` · menu D/C/M=${hasDevice}/${hasCamera}/${hasManual}`;
        }
      }
      const transfer = page.getByRole('button', { name: /Transfer UCO/i });
      if (await transfer.count()) {
        await transfer.first().click();
        await page.waitForTimeout(500);
        const menu = await page.evaluate(() => document.body.innerText);
        const hasDevice = /\bDevice\b/i.test(menu);
        const hasCamera = /\bCamera\b/i.test(menu);
        const hasManual = /\bManual\b/i.test(menu);
        await page.keyboard.press('Escape');
        if (hasManual && !(hasDevice && hasCamera)) {
          status = 'FAIL';
          actual += ' · Transfer UCO also Manual-only';
        }
      }
    }

    if (p.deep === 'uco') {
      const add = page.getByRole('button', { name: /Add New UCO Configuration/i });
      if (await add.count()) {
        await add.first().click();
        await page.waitForTimeout(900);
        const form = await page.evaluate(() => document.body.innerText);
        const hasBody = /Template Body/i.test(form);
        const hasFooter = /Template Footer/i.test(form);
        await page.keyboard.press('Escape');
        const back = page.getByRole('button', { name: /back|cancel|close/i });
        if (await back.count()) await back.first().click().catch(() => {});
        if (!hasBody || !hasFooter) {
          status = 'FAIL';
          actual = `Add UCO form missing Template Body/Footer (body=${hasBody}, footer=${hasFooter})`;
        } else {
          actual += ' · Template Body+Footer present';
        }
      }
    }

    if (p.deep === 'pay') {
      // open first available View if any
      const viewBtn = page.locator('button:has-text("View"), a:has-text("View")').first();
      if (await viewBtn.count()) {
        await viewBtn.click().catch(() => {});
        await page.waitForTimeout(1200);
        const pay = page.getByRole('button', { name: /^Pay$/i });
        if (await pay.count()) {
          await pay.first().click();
          await page.waitForTimeout(600);
          const menu = await page.evaluate(() => document.body.innerText);
          const methods = ['Cash', 'UPI', 'Card', 'Others'].filter((m) => new RegExp(`\\b${m}\\b`, 'i').test(menu));
          await page.keyboard.press('Escape');
          if (methods.length === 1 && /cash/i.test(methods[0])) {
            status = 'FAIL';
            actual = `Pay menu Cash-only (methods=${methods.join(',')})`;
          } else {
            actual += ` · Pay methods=${methods.join(',') || 'none'}`;
          }
        }
      }
    }

    results.push({ id: p.id, case: p.case, status, actual: actual.slice(0, 240) });
    console.log(`${p.id}\t${status}\t${p.case}\t${actual.slice(0, 100)}`);
  }

  const summary = {
    env: BASE,
    when: new Date().toISOString(),
    counts: results.reduce((a, r) => {
      a[r.status] = (a[r.status] || 0) + 1;
      return a;
    }, {}),
    results,
  };
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log('wrote', OUT, summary.counts);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
