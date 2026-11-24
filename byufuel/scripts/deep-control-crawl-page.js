/**
 * Playwright MCP helper: deep-control fingerprint one env.
 * Used via browser_run_code_unsafe filename — expects `page` already logged in.
 *
 * Set globalThis.__DEEP_CRAWL__ = { base, role, outPrefix } before import if needed.
 * This file exports default async (page) => result
 */
import fs from 'fs';
import path from 'path';

const OUT_DIR = 'd:/Travel VIP API Automation/byufuel/reports/parity-growexponential/crediblesg-2026-11-13/deep-controls';

const ADMIN_PATHS = [
  '/dsh/dashboard',
  '/uam/admin-users',
  '/uam/tsm-leads',
  '/uam/tsm-zipcodes',
  '/uam/wh-users',
  '/uam/drivers',
  '/uam/prospects',
  '/uam/suppliers',
  '/uam/roles',
  '/byu/suppliers',
  '/byu/bulk-uco-schedule-requests',
  '/byu/uco-schedules',
  '/byu/uco-schedule-itineraries',
  '/uam/warehouses',
  '/mdm/types',
  '/mdm/uco-configuration',
  '/mdm/time-slots',
  '/mdm/countries',
  '/mdm/rate-configuration',
  '/mdm/operational-areas',
  '/uam/container-qr-codes',
  '/byu/vehicles',
  '/uam/container-management',
  '/byu/uco',
  '/byu/supplier-payment',
  '/byu/supplier-cancellation-amounts',
  '/uam/customer-support',
  '/byu/chat-settings',
  '/byu/incoming-deliveries',
  '/byu/reports',
];

const WH_PATHS = [
  '/dsh/dashboard',
  '/uam/container-qr-codes',
  '/uam/container-management',
  '/byu/checkin-oil',
  '/byu/collect-oil',
];

const ACTION_RE = /^(Add|Create|New|Generate|Transfer|Scan|Export|Advance Search|Reset Search|Pay|Approve|Reject|Assign|Unassigned|Edit|Deactivate|Activate|Reset Password|Confirm|Collect|Check.?[Ii]n|Upload|Print|Download|Filter|Show Hide|Run quick|Contacts|Messages|Support|Call Log|Operational Area Rate|Supplier Rate)/i;

function slug(s) {
  return String(s || 'x').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
}

async function safeGoto(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1800);
  if ((await page.title()) === 'BYUFUEL | Centvis') {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  }
}

async function pageControls(page) {
  return page.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const buttons = [...document.querySelectorAll('button, a[mat-button], a[mat-raised-button], a[mat-stroked-button], [role="button"]')]
      .map((b) => ({
        text: norm(b.innerText || b.getAttribute('aria-label') || ''),
        disabled: b.disabled || b.getAttribute('aria-disabled') === 'true',
      }))
      .filter((b) => b.text && b.text.length < 80);
    const uniqButtons = [];
    const seen = new Set();
    for (const b of buttons) {
      const k = b.text.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      uniqButtons.push(b);
    }
    const tabs = [...document.querySelectorAll('[role="tab"], .mat-mdc-tab, .mdc-tab')]
      .map((t) => norm(t.innerText)).filter(Boolean);
    const inputs = [...document.querySelectorAll('input, textarea, mat-select, select')]
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || '',
        placeholder: el.getAttribute('placeholder') || '',
        name: el.getAttribute('name') || el.getAttribute('formcontrolname') || '',
        aria: el.getAttribute('aria-label') || '',
        label: (() => {
          const id = el.id;
          if (id) {
            const lab = document.querySelector(`label[for="${id}"]`);
            if (lab) return norm(lab.innerText);
          }
          const wrap = el.closest('mat-form-field, .mat-mdc-form-field');
          const lab = wrap && wrap.querySelector('mat-label, .mat-mdc-form-field-label, label');
          return lab ? norm(lab.innerText) : '';
        })(),
      }))
      .filter((i) => i.placeholder || i.label || i.name || i.aria);
    const headers = [...document.querySelectorAll('th, .mat-mdc-header-cell, [role="columnheader"]')]
      .map((h) => norm(h.innerText)).filter(Boolean);
    const headings = [...document.querySelectorAll('h1,h2,h3')].map((h) => norm(h.innerText)).filter(Boolean);
    return {
      title: document.title,
      url: location.href,
      headings,
      tabs: [...new Set(tabs)],
      headers,
      buttons: uniqButtons,
      inputs,
    };
  });
}

async function openMenusAndDialogs(page, role, pathKey, shotDir) {
  const probed = [];
  const candidates = await page.evaluate((reSrc) => {
    const re = new RegExp(reSrc, 'i');
    return [...document.querySelectorAll('button')]
      .map((b, idx) => ({ idx, text: (b.innerText || b.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim() }))
      .filter((b) => b.text && re.test(b.text) && b.text.length < 60)
      .slice(0, 12);
  }, ACTION_RE.source);

  // Prefer unique by text
  const seen = new Set();
  const list = [];
  for (const c of candidates) {
    const k = c.text.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    list.push(c);
  }

  for (const c of list) {
    const entry = { control: c.text, kind: null, items: [], fields: [], error: null };
    try {
      const btn = page.getByRole('button', { name: c.text, exact: true }).first();
      if (!(await btn.count())) {
        // fuzzy
        const fuzzy = page.getByRole('button', { name: new RegExp(c.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first();
        if (!(await fuzzy.count())) continue;
        await fuzzy.click({ timeout: 3000 });
      } else {
        await btn.click({ timeout: 3000 });
      }
      await page.waitForTimeout(700);

      const menuItems = await page.evaluate(() => [...document.querySelectorAll('.mat-mdc-menu-item, [role="menuitem"], .mat-menu-item')]
        .map((e) => e.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean));
      if (menuItems.length) {
        entry.kind = 'menu';
        entry.items = menuItems;
        const shot = path.join(shotDir, `${role}_${slug(pathKey)}_${slug(c.text)}_menu.png`);
        await page.screenshot({ path: shot, type: 'png' });
        entry.shot = shot;
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        probed.push(entry);
        continue;
      }

      const dialog = await page.evaluate(() => {
        const d = document.querySelector('mat-dialog-container, [role="dialog"]');
        if (!d) return null;
        const labels = [...d.querySelectorAll('label, mat-label, .mat-mdc-form-field-label, .mdc-floating-label')]
          .map((e) => e.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean);
        const buttons = [...d.querySelectorAll('button')].map((b) => b.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean);
        const placeholders = [...d.querySelectorAll('input, textarea')].map((i) => i.getAttribute('placeholder') || '').filter(Boolean);
        return {
          title: (d.querySelector('h1,h2,h3,.mat-mdc-dialog-title') || {}).innerText || '',
          labels: [...new Set(labels)],
          placeholders,
          buttons: [...new Set(buttons)],
          text: d.innerText.slice(0, 400).replace(/\s+/g, ' '),
        };
      });
      if (dialog) {
        entry.kind = 'dialog';
        entry.fields = dialog;
        const shot = path.join(shotDir, `${role}_${slug(pathKey)}_${slug(c.text)}_dialog.png`);
        await page.screenshot({ path: shot, type: 'png' });
        entry.shot = shot;
        // close
        const close = page.getByRole('button', { name: /Close|Cancel|No|Back/i }).first();
        if (await close.count()) await close.click({ timeout: 2000 }).catch(() => {});
        else await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
        probed.push(entry);
        continue;
      }

      // maybe navigated or panel opened
      entry.kind = 'click-no-overlay';
      probed.push(entry);
      // if URL changed away from list, go back later by caller
    } catch (e) {
      entry.error = String(e.message || e).slice(0, 160);
      probed.push(entry);
      await page.keyboard.press('Escape').catch(() => {});
    }
  }
  return probed;
}

async function probeFirstRowDetail(page, role, pathKey, shotDir) {
  const out = { opened: false, url: null, buttons: [], menus: [] };
  try {
    // click first data link in table if any
    const link = page.locator('table tbody a, .mat-mdc-row a, td a').first();
    if (!(await link.count())) return out;
    await link.click({ timeout: 3000 });
    await page.waitForTimeout(2000);
    out.opened = true;
    out.url = page.url();
    const controls = await pageControls(page);
    out.buttons = controls.buttons;
    out.headings = controls.headings;
    const shot = path.join(shotDir, `${role}_${slug(pathKey)}_detail.png`);
    await page.screenshot({ path: shot, type: 'png' });
    out.shot = shot;

    // probe Scan / Reset Password / Edit / Confirm menus on detail
    for (const name of ['Scan', 'Add New Container', 'Transfer UCO', 'Reset Password', 'Edit', 'Confirm Checkin', 'Generate QR Codes']) {
      const btn = page.getByRole('button', { name: new RegExp(`^${name}$|${name}`, 'i') }).first();
      if (!(await btn.count())) continue;
      await btn.click({ timeout: 2500 }).catch(() => {});
      await page.waitForTimeout(600);
      const items = await page.evaluate(() => [...document.querySelectorAll('.mat-mdc-menu-item, [role="menuitem"]')]
        .map((e) => e.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean));
      const dialog = await page.evaluate(() => {
        const d = document.querySelector('mat-dialog-container, [role="dialog"]');
        if (!d) return null;
        return {
          labels: [...d.querySelectorAll('label, mat-label')].map((e) => e.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean),
          buttons: [...d.querySelectorAll('button')].map((b) => b.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean),
          text: d.innerText.slice(0, 300).replace(/\s+/g, ' '),
        };
      });
      if (items.length || dialog) {
        const s2 = path.join(shotDir, `${role}_${slug(pathKey)}_detail_${slug(name)}.png`);
        await page.screenshot({ path: s2, type: 'png' });
        out.menus.push({ control: name, items, dialog, shot: s2 });
      }
      await page.keyboard.press('Escape').catch(() => {});
      const close = page.getByRole('button', { name: /Close|Cancel|No|Back/i }).first();
      if (dialog && await close.count()) await close.click().catch(() => {});
      await page.waitForTimeout(300);
    }
  } catch (e) {
    out.error = String(e.message || e).slice(0, 160);
  }
  return out;
}

export default async function crawl(page) {
  const cfg = globalThis.__DEEP_CRAWL__ || {};
  const base = cfg.base || 'https://uat-byufuel.crediblesg.com';
  const role = cfg.role || 'admin-grow';
  const paths = cfg.paths || (String(role).includes('wh') ? WH_PATHS : ADMIN_PATHS);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const shotDir = path.join(OUT_DIR, role);
  fs.mkdirSync(shotDir, { recursive: true });

  const pages = [];
  for (const p of paths) {
    const url = base.replace(/\/$/, '') + p;
    console.log('CRAWL', role, p);
    await safeGoto(page, url);
    // stay on auth? abort
    if (/auth\/login/.test(page.url())) {
      pages.push({ path: p, error: 'logged-out' });
      break;
    }
    const controls = await pageControls(page);
    const listShot = path.join(shotDir, `${slug(p)}_list.png`);
    await page.screenshot({ path: listShot, type: 'png' });
    const overlays = await openMenusAndDialogs(page, role, p, shotDir);
    // if overlay click navigated away, go back to list
    if (!page.url().includes(p.split('?')[0]) && !/auth\/login/.test(page.url())) {
      await safeGoto(page, url);
    }
    let detail = null;
    // detail probe for list-like pages
    if (controls.headers.length || /list|management|users|payment|schedules|itinerar|container|checkin|collect/i.test(controls.title + p)) {
      detail = await probeFirstRowDetail(page, role, p, shotDir);
      // return to list for next path
      await safeGoto(page, url);
    }
    pages.push({
      path: p,
      controls,
      listShot,
      overlays,
      detail,
    });
  }

  const out = {
    when: new Date().toISOString(),
    base,
    role,
    pageCount: pages.length,
    pages,
  };
  const outFile = path.join(OUT_DIR, `${role}.json`);
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  return { outFile, pageCount: pages.length, loggedOut: pages.some((x) => x.error === 'logged-out') };
}
