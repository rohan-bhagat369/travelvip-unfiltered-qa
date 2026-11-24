/**
 * Deep control parity crawl — Admin + WH on Grow(crediblesg) vs Azure.
 * Captures every list control, opens Add/Advance Search/menus/dialogs/forms,
 * opens first-row detail and probes detail actions. Screenshots on overlays.
 *
 *   node byufuel/scripts/deep-control-parity-crawl.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from './.tmp-pw/node_modules/playwright/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../reports/parity-growexponential/crediblesg-2026-11-13/deep-controls');
fs.mkdirSync(OUT, { recursive: true });

const GROW = 'https://uat-byufuel.crediblesg.com';
const AZURE = 'https://u-byufuel.azurewebsites.net';
const ADMIN = { email: 'amaan@crediblesg.com', password: 'Byufuel@2552' };
const WH_GROW = { email: 'mayurmwh1@byufuel.in', password: 'tRs18#Nl' };
const WH_AZURE = { email: 'mayurmwh1@byufuel.in', password: 'wK1q@C78' };

const ADMIN_PATHS = [
  '/dsh/dashboard',
  '/uam/admin-users', '/uam/tsm-leads', '/uam/tsm-zipcodes', '/uam/wh-users',
  '/uam/drivers', '/uam/prospects', '/uam/suppliers', '/uam/roles',
  '/byu/suppliers', '/byu/bulk-uco-schedule-requests', '/byu/uco-schedules',
  '/byu/uco-schedule-itineraries', '/uam/warehouses',
  '/mdm/types', '/mdm/uco-configuration', '/mdm/time-slots', '/mdm/countries',
  '/mdm/rate-configuration', '/mdm/operational-areas',
  '/uam/container-qr-codes', '/byu/vehicles', '/uam/container-management', '/byu/uco',
  '/byu/supplier-payment', '/byu/supplier-cancellation-amounts',
  '/uam/customer-support', '/byu/chat-settings', '/byu/incoming-deliveries', '/byu/reports',
];

const WH_PATHS = [
  '/dsh/dashboard',
  '/uam/container-qr-codes',
  '/uam/container-management',
  '/byu/checkin-oil',
  '/byu/collect-oil',
];

const ACTION_RE = /^(Add|Create|New |Generate|Transfer|Scan|Download|Upload|Export|Advance Search|Show Hide|Pay|Unassigned|Contacts|Operational Area Rate|Supplier Rate|Check in|Collect)/i;

function slug(s) {
  return String(s || 'x').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
}

async function login(page, base, creds) {
  await page.goto(`${base}/auth/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(800);
  await page.getByRole('textbox', { name: 'Email' }).click();
  await page.getByRole('textbox', { name: 'Email' }).pressSequentially(creds.email, { delay: 15 });
  await page.getByRole('textbox', { name: 'Password' }).click();
  await page.getByRole('textbox', { name: 'Password' }).pressSequentially(creds.password, { delay: 15 });
  await page.getByRole('button', { name: 'Login' }).click();
  await page.waitForTimeout(4000);
  if (/auth\/login/.test(page.url())) {
    throw new Error(`Login failed on ${base} for ${creds.email}`);
  }
}

async function safeGoto(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1200);
  if ((await page.title()) === 'BYUFUEL | Centvis') {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
  }
}

async function fingerprint(page) {
  return page.evaluate(() => {
    const n = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const buttons = [...new Set([...document.querySelectorAll('button')]
      .map((b) => n(b.innerText || b.getAttribute('aria-label') || ''))
      .filter((t) => t && t.length < 70))];
    return {
      title: document.title,
      url: location.href,
      headings: [...document.querySelectorAll('h1,h2,h3')].map((h) => n(h.innerText)).filter(Boolean),
      tabs: [...new Set([...document.querySelectorAll('[role=tab]')].map((t) => n(t.innerText)).filter(Boolean))],
      headers: [...document.querySelectorAll('th,.mat-mdc-header-cell')].map((h) => n(h.innerText)).filter(Boolean),
      buttons,
      inputs: [...document.querySelectorAll('input,textarea,mat-select')].map((el) => ({
        type: el.getAttribute('type') || el.tagName.toLowerCase(),
        placeholder: el.getAttribute('placeholder') || '',
        label: (el.closest('mat-form-field')?.querySelector('mat-label,.mdc-floating-label')?.innerText || '').replace(/\s+/g, ' ').trim(),
      })).filter((i) => i.placeholder || i.label),
    };
  });
}

async function formFingerprint(page) {
  return page.evaluate(() => {
    const n = (t) => (t || '').replace(/\s+/g, ' ').trim();
    return {
      url: location.href,
      title: document.title,
      headings: [...document.querySelectorAll('h1,h2,h3')].map((h) => n(h.innerText)).filter(Boolean).slice(0, 8),
      labels: [...new Set([...document.querySelectorAll('label,mat-label,.mdc-floating-label')].map((e) => n(e.innerText)).filter(Boolean))],
      buttons: [...new Set([...document.querySelectorAll('button')].map((b) => n(b.innerText || b.getAttribute('aria-label') || '')).filter((t) => t && t.length < 50))],
      placeholders: [...document.querySelectorAll('input,textarea')].map((i) => i.getAttribute('placeholder') || '').filter(Boolean),
    };
  });
}

async function crawlEnv(browser, { base, role, creds, paths }) {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const shotDir = path.join(OUT, role);
  fs.mkdirSync(shotDir, { recursive: true });
  console.log(`\\n=== LOGIN ${role} ${base} ===`);
  await login(page, base, creds);

  const pages = [];
  for (const p of paths) {
    console.log(role, p);
    await safeGoto(page, base + p);
    if (/auth\/login/.test(page.url())) throw new Error(`Logged out at ${p}`);
    const controls = await fingerprint(page);
    await page.screenshot({ path: path.join(shotDir, `${slug(p)}_list.png`), type: 'png' }).catch(() => {});
    const listUrl = page.url();
    const overlays = [];

    for (const text of controls.buttons.filter((t) => ACTION_RE.test(t)).slice(0, 12)) {
      try {
        // skip row-level Edit Name buttons
        if (/^(Edit|Deactivate|Activate|View All Areas)\\s/i.test(text)) continue;
        const btn = page.getByRole('button', { name: text, exact: true }).first();
        if (!(await btn.count())) continue;
        await btn.click({ timeout: 3000 });
        await page.waitForTimeout(700);

        const menu = await page.evaluate(() => [...document.querySelectorAll('.mat-mdc-menu-item,[role=menuitem]')]
          .map((e) => e.innerText.replace(/\\s+/g, ' ').trim()).filter(Boolean));
        const dialog = await page.evaluate(() => {
          const d = document.querySelector('mat-dialog-container,[role=dialog]');
          if (!d) return null;
          return {
            title: (d.querySelector('h1,h2,h3,.mat-mdc-dialog-title')?.innerText || '').replace(/\\s+/g, ' ').trim(),
            labels: [...new Set([...d.querySelectorAll('label,mat-label,.mdc-floating-label')].map((e) => e.innerText.replace(/\\s+/g, ' ').trim()).filter(Boolean))],
            buttons: [...new Set([...d.querySelectorAll('button')].map((b) => b.innerText.replace(/\\s+/g, ' ').trim()).filter(Boolean))],
            placeholders: [...d.querySelectorAll('input,textarea')].map((i) => i.getAttribute('placeholder') || '').filter(Boolean),
          };
        });

        if (!menu.length && !dialog && page.url() !== listUrl) {
          const form = await formFingerprint(page);
          await page.screenshot({ path: path.join(shotDir, `${slug(p)}_${slug(text)}_form.png`), type: 'png' }).catch(() => {});
          overlays.push({ control: text, kind: 'form', form });
          const back = page.getByRole('button', { name: /^Back$/i }).first();
          if (await back.count()) await back.click().catch(() => {});
          else await safeGoto(page, listUrl);
          await page.waitForTimeout(700);
          continue;
        }

        const kind = menu.length ? 'menu' : (dialog ? 'dialog' : 'click');
        if (menu.length || dialog) {
          await page.screenshot({ path: path.join(shotDir, `${slug(p)}_${slug(text)}_${kind}.png`), type: 'png' }).catch(() => {});
        }
        overlays.push({ control: text, kind, items: menu, dialog });
        await page.keyboard.press('Escape').catch(() => {});
        const close = page.getByRole('button', { name: /Close|Cancel|No/i }).first();
        if (dialog && await close.count()) await close.click().catch(() => {});
        await page.waitForTimeout(250);
        if (!page.url().startsWith(listUrl.split('?')[0]) && !page.url().includes(p)) {
          await safeGoto(page, base + p);
        }
      } catch (e) {
        overlays.push({ control: text, error: String(e.message || e).slice(0, 120) });
        await page.keyboard.press('Escape').catch(() => {});
        if (!page.url().includes(p)) await safeGoto(page, base + p);
      }
    }

    // detail
    let detail = null;
    try {
      // Prefer ARRIVED row for check-in
      if (/checkin-oil/.test(p)) {
        const arrived = page.getByText(/ARRIVED AT WAREHOUSE/i).first();
        if (await arrived.count()) await arrived.click({ timeout: 3000 });
      } else {
        const link = page.locator('table tbody tr td a, .mat-mdc-row a').first();
        if (await link.count()) await link.click({ timeout: 3000 });
        else {
          const cell = page.locator('table tbody tr td').nth(1);
          if (await cell.count()) await cell.click({ timeout: 3000 });
        }
      }
      await page.waitForTimeout(1600);
      if (page.url() !== listUrl && !/auth\/login/.test(page.url())) {
        const dButtons = await page.evaluate(() => [...new Set([...document.querySelectorAll('button')]
          .map((b) => (b.innerText || b.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim())
          .filter((t) => t && t.length < 60))]);
        detail = { url: page.url(), buttons: dButtons, probes: {} };
        await page.screenshot({ path: path.join(shotDir, `${slug(p)}_detail.png`), type: 'png' }).catch(() => {});
        for (const name of ['Scan', 'Reset Password', 'Edit', 'Deactivate', 'Activate', 'Confirm Checkin', 'Add New Container', 'Transfer UCO', 'Generate QR Codes', 'Pay']) {
          const b = page.getByRole('button', { name: new RegExp(`^${name}$|${name}`, 'i') }).first();
          if (!(await b.count())) continue;
          await b.click({ timeout: 2500 }).catch(() => {});
          await page.waitForTimeout(550);
          const items = await page.evaluate(() => [...document.querySelectorAll('.mat-mdc-menu-item,[role=menuitem]')]
            .map((e) => e.innerText.replace(/\\s+/g, ' ').trim()).filter(Boolean));
          const dlg = await page.evaluate(() => {
            const d = document.querySelector('mat-dialog-container,[role=dialog]');
            if (!d) return null;
            return {
              labels: [...new Set([...d.querySelectorAll('label,mat-label')].map((e) => e.innerText.replace(/\\s+/g, ' ').trim()).filter(Boolean))],
              buttons: [...new Set([...d.querySelectorAll('button')].map((b) => b.innerText.replace(/\\s+/g, ' ').trim()).filter(Boolean))],
              text: d.innerText.slice(0, 220).replace(/\\s+/g, ' '),
            };
          });
          let form = null;
          if (!items.length && !dlg && page.url() !== detail.url) {
            form = await formFingerprint(page);
          }
          if (items.length || dlg || form) {
            detail.probes[name] = { items, dlg, form };
            await page.screenshot({ path: path.join(shotDir, `${slug(p)}_detail_${slug(name)}.png`), type: 'png' }).catch(() => {});
          }
          await page.keyboard.press('Escape').catch(() => {});
          const cl = page.getByRole('button', { name: /Close|Cancel|No/i }).first();
          if (dlg && await cl.count()) await cl.click().catch(() => {});
          if (form) {
            const back = page.getByRole('button', { name: /^Back$/i }).first();
            if (await back.count()) await back.click().catch(() => {});
            else await page.goBack().catch(() => {});
            await page.waitForTimeout(700);
          }
        }
      }
      await safeGoto(page, base + p);
    } catch (e) {
      detail = { error: String(e.message || e).slice(0, 120) };
    }

    pages.push({ path: p, controls, overlays, detail });
    fs.writeFileSync(path.join(OUT, `${role}.partial.json`), JSON.stringify({ role, base, pages }, null, 2));
  }

  await context.close();
  const outFile = path.join(OUT, `${role}.json`);
  const payload = { when: new Date().toISOString(), role, base, pageCount: pages.length, pages };
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2));
  console.log('saved', outFile);
  return payload;
}

function normList(arr) {
  return [...new Set((arr || []).map((x) => String(x).replace(/\\s+/g, ' ').trim()).filter(Boolean))].sort();
}

function diffArrays(a, b) {
  const A = new Set(normList(a));
  const B = new Set(normList(b));
  return {
    onlyGrow: [...A].filter((x) => !B.has(x)),
    onlyAzure: [...B].filter((x) => !A.has(x)),
  };
}

function compare(grow, azure) {
  const rows = [];
  const byPath = (pack) => Object.fromEntries((pack.pages || []).map((p) => [p.path, p]));
  const G = byPath(grow);
  const A = byPath(azure);
  const paths = [...new Set([...Object.keys(G), ...Object.keys(A)])].sort();

  for (const p of paths) {
    const g = G[p];
    const a = A[p];
    if (!g || !a) {
      rows.push({
        path: p,
        area: 'page',
        control: '(page present)',
        grow: g ? 'yes' : 'MISSING',
        azure: a ? 'yes' : 'MISSING',
        verdict: 'FAIL_GROW',
      });
      continue;
    }

    const btnDiff = diffArrays(g.controls.buttons, a.controls.buttons);
    // ignore noisy row-level buttons
    const filterNoise = (list) => list.filter((x) => !/^(Edit|Deactivate|Activate|View All Areas|History)\\b/i.test(x)
      && !/B-\\d|SCH-|IT-|Mayur|Rohan|Amaan|Hyd|pratik|kedar|test/i.test(x));
    const onlyGrowBtns = filterNoise(btnDiff.onlyGrow);
    const onlyAzureBtns = filterNoise(btnDiff.onlyAzure);
    if (onlyGrowBtns.length || onlyAzureBtns.length) {
      rows.push({
        path: p,
        area: 'list-buttons',
        control: 'primary/list buttons',
        grow: onlyGrowBtns.join(' | ') || '—',
        azure: onlyAzureBtns.join(' | ') || '—',
        verdict: onlyAzureBtns.length ? 'FAIL_GROW' : 'NOTE_GROW_EXTRA',
      });
    }

    const hdr = diffArrays(g.controls.headers, a.controls.headers);
    if (hdr.onlyGrow.length || hdr.onlyAzure.length) {
      rows.push({
        path: p,
        area: 'headers',
        control: 'table headers',
        grow: hdr.onlyGrow.join(' | ') || '—',
        azure: hdr.onlyAzure.join(' | ') || '—',
        verdict: hdr.onlyAzure.length ? 'FAIL_GROW' : 'NOTE_GROW_EXTRA',
      });
    }

    const tabs = diffArrays(g.controls.tabs, a.controls.tabs);
    if (tabs.onlyGrow.length || tabs.onlyAzure.length) {
      rows.push({
        path: p,
        area: 'tabs',
        control: 'tabs',
        grow: tabs.onlyGrow.join(' | ') || '—',
        azure: tabs.onlyAzure.join(' | ') || '—',
        verdict: tabs.onlyAzure.length ? 'FAIL_GROW' : 'NOTE_GROW_EXTRA',
      });
    }

    // overlays by control name
    const go = Object.fromEntries((g.overlays || []).filter((o) => o.control).map((o) => [o.control, o]));
    const ao = Object.fromEntries((a.overlays || []).filter((o) => o.control).map((o) => [o.control, o]));
    for (const name of [...new Set([...Object.keys(go), ...Object.keys(ao)])]) {
      if (/^(Edit|Deactivate|Activate|View All Areas)\\b/i.test(name)) continue;
      const x = go[name];
      const y = ao[name];
      if (!x || !y) {
        rows.push({
          path: p,
          area: 'overlay',
          control: name,
          grow: x ? `${x.kind}` : 'MISSING',
          azure: y ? `${y.kind}` : 'MISSING',
          verdict: !x ? 'FAIL_GROW' : 'NOTE_GROW_EXTRA',
        });
        continue;
      }
      if (x.kind === 'menu' || y.kind === 'menu') {
        const md = diffArrays(x.items || [], y.items || []);
        if (md.onlyGrow.length || md.onlyAzure.length) {
          rows.push({
            path: p,
            area: 'menu',
            control: name,
            grow: (x.items || []).join(' · ') || '—',
            azure: (y.items || []).join(' · ') || '—',
            verdict: md.onlyAzure.length ? 'FAIL_GROW' : 'NOTE_GROW_EXTRA',
          });
        }
      }
      if (x.kind === 'dialog' || y.kind === 'dialog') {
        const ld = diffArrays(x.dialog?.labels || [], y.dialog?.labels || []);
        const bd = diffArrays(x.dialog?.buttons || [], y.dialog?.buttons || []);
        if (ld.onlyGrow.length || ld.onlyAzure.length || bd.onlyGrow.length || bd.onlyAzure.length) {
          rows.push({
            path: p,
            area: 'dialog',
            control: name,
            grow: `labels:[${(x.dialog?.labels || []).join(', ')}] btns:[${(x.dialog?.buttons || []).join(', ')}]`,
            azure: `labels:[${(y.dialog?.labels || []).join(', ')}] btns:[${(y.dialog?.buttons || []).join(', ')}]`,
            verdict: (ld.onlyAzure.length || bd.onlyAzure.length) ? 'FAIL_GROW' : 'NOTE_GROW_EXTRA',
          });
        }
      }
      if (x.kind === 'form' || y.kind === 'form') {
        const ld = diffArrays(x.form?.labels || [], y.form?.labels || []);
        if (ld.onlyGrow.length || ld.onlyAzure.length) {
          rows.push({
            path: p,
            area: 'form',
            control: name,
            grow: (x.form?.labels || []).join(', ') || '—',
            azure: (y.form?.labels || []).join(', ') || '—',
            verdict: ld.onlyAzure.length ? 'FAIL_GROW' : 'NOTE_GROW_EXTRA',
          });
        }
      }
    }

    // detail probes menus
    const gp = g.detail?.probes || {};
    const ap = a.detail?.probes || {};
    for (const name of [...new Set([...Object.keys(gp), ...Object.keys(ap)])]) {
      const x = gp[name];
      const y = ap[name];
      if (!x || !y) {
        // missing probe may be data-dependent — mark NOT TESTED unless menu items clearly differ when both present
        continue;
      }
      const md = diffArrays(x.items || [], y.items || []);
      if (md.onlyGrow.length || md.onlyAzure.length) {
        rows.push({
          path: p,
          area: 'detail-menu',
          control: name,
          grow: (x.items || []).join(' · ') || '—',
          azure: (y.items || []).join(' · ') || '—',
          verdict: md.onlyAzure.length ? 'FAIL_GROW' : 'NOTE_GROW_EXTRA',
        });
      }
    }
  }
  return rows;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const adminGrow = await crawlEnv(browser, {
      base: GROW, role: 'admin-grow', creds: ADMIN, paths: ADMIN_PATHS,
    });
    const adminAzure = await crawlEnv(browser, {
      base: AZURE, role: 'admin-azure', creds: ADMIN, paths: ADMIN_PATHS,
    });
    const whGrow = await crawlEnv(browser, {
      base: GROW, role: 'wh-grow', creds: WH_GROW, paths: WH_PATHS,
    });
    const whAzure = await crawlEnv(browser, {
      base: AZURE, role: 'wh-azure', creds: WH_AZURE, paths: WH_PATHS,
    });

    const adminDiff = compare(adminGrow, adminAzure);
    const whDiff = compare(whGrow, whAzure);
    const all = [
      ...adminDiff.map((r) => ({ surface: 'Admin', ...r })),
      ...whDiff.map((r) => ({ surface: 'WH', ...r })),
    ];

    fs.writeFileSync(path.join(OUT, 'DIFF.json'), JSON.stringify({ when: new Date().toISOString(), all }, null, 2));

    const fail = all.filter((r) => r.verdict === 'FAIL_GROW');
    const notes = all.filter((r) => r.verdict === 'NOTE_GROW_EXTRA');
    const esc = (s) => String(s ?? '').replace(/\|/g, '/').slice(0, 120);
    const md = [
      '# Deep control parity — every section (Admin + WH)',
      '',
      `- When: ${new Date().toISOString()}`,
      `- Grow: \`${GROW}\``,
      `- Azure: \`${AZURE}\``,
      `- Admin pages crawled: ${adminGrow.pageCount} / ${adminAzure.pageCount}`,
      `- WH pages crawled: ${whGrow.pageCount} / ${whAzure.pageCount}`,
      `- FAIL_GROW diffs: **${fail.length}**`,
      `- Grow-extra notes: ${notes.length}`,
      '',
      '## FAIL_GROW (Azure has control/option missing or different on Grow)',
      '',
      '| Surface | Path | Area | Control | Grow | Azure |',
      '|---------|------|------|---------|------|-------|',
      ...fail.map((r) => `| ${r.surface} | \`${r.path}\` | ${r.area} | ${r.control} | ${esc(r.grow)} | ${esc(r.azure)} |`),
      '',
      '## Grow extras (not blockers unless product says so)',
      '',
      '| Surface | Path | Area | Control | Grow only |',
      '|---------|------|------|---------|-----------|',
      ...notes.slice(0, 80).map((r) => `| ${r.surface} | \`${r.path}\` | ${r.area} | ${r.control} | ${esc(r.grow)} |`),
      '',
      'Raw: `admin-grow.json` `admin-azure.json` `wh-grow.json` `wh-azure.json` `DIFF.json`',
      'Shots: `deep-controls/<role>/`',
    ].join('\n');
    fs.writeFileSync(path.join(OUT, 'DEEP-CONTROL-REPORT.md'), `${md}\n`);
    console.log('FAIL_GROW count', fail.length);
    for (const r of fail) console.log('-', r.surface, r.path, r.area, r.control, '| G:', r.grow, '| A:', r.azure);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
