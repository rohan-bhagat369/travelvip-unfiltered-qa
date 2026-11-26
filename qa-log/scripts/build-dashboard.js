#!/usr/bin/env node
// Builds qa-log/dashboard/index.html — one self-contained file (data embedded), safe to
// email, host, or publish. Re-run any time: `npm run qa:dashboard`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadData() {
  const daysDir = path.join(ROOT, 'days');
  const days = fs.existsSync(daysDir)
    ? fs.readdirSync(daysDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
        .map((f) => JSON.parse(fs.readFileSync(path.join(daysDir, f), 'utf8')))
        .sort((a, b) => b.date.localeCompare(a.date))
    : [];
  const bugsFile = path.join(ROOT, 'bugs.json');
  const bugs = fs.existsSync(bugsFile) ? JSON.parse(fs.readFileSync(bugsFile, 'utf8')) : [];
  return { generated: new Date().toISOString(), days, bugs };
}

export function buildDashboard() {
  const data = loadData();
  const tpl = fs.readFileSync(path.join(ROOT, 'scripts', 'dashboard.template.html'), 'utf8');
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const html = tpl.replace('/*__DATA__*/null', json);
  const out = path.join(ROOT, 'dashboard', 'index.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`dashboard: ${buildDashboard()}`);
}
