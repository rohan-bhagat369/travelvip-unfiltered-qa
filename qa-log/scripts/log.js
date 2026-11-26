#!/usr/bin/env node
// QA log CLI — used by you and by every agent after testing.
//
//   node qa-log/scripts/log.js entry --task ENG-901 --title "Hotel search filter" \
//        --product Hotel --result Pass --source "Dev changelog" \
//        [--bugs BUG-1,BUG-2] [--evidence path1,path2] [--notes "..."] [--date YYYY-MM-DD]
//
//   node qa-log/scripts/log.js bug --id HTL-01 --title "..." --product Hotel --severity High \
//        [--task ENG-901] [--report path] [--date YYYY-MM-DD]
//
//   node qa-log/scripts/log.js bug-status HTL-01 fixed|retest|closed|open|wontfix [--date YYYY-MM-DD]
//
// Every command rebuilds the dashboard at the end.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildDashboard } from './build-dashboard.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DAYS = path.join(ROOT, 'days');
const BUGS = path.join(ROOT, 'bugs.json');

const RESULTS = ['Pass', 'Fail', 'Blocked', 'Partial'];
const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];
const STATUSES = ['open', 'fixed', 'retest', 'closed', 'wontfix'];
const today = () => new Date().toISOString().slice(0, 10);
const list = (v) => (v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : []);
const die = (m) => { console.error(`qa-log: ${m}`); process.exit(1); };
const readJson = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n');

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    task: { type: 'string' }, title: { type: 'string' }, product: { type: 'string' },
    agent: { type: 'string' }, source: { type: 'string' }, result: { type: 'string' },
    bugs: { type: 'string' }, evidence: { type: 'string' }, notes: { type: 'string' },
    date: { type: 'string' }, id: { type: 'string' }, severity: { type: 'string' },
    report: { type: 'string' },
  },
});
const [cmd, ...rest] = positionals;
const date = o.date || today();
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) die('--date must be YYYY-MM-DD');

if (cmd === 'entry') {
  if (!o.title || !o.product || !o.result) die('entry needs --title --product --result');
  const result = RESULTS.find((r) => r.toLowerCase() === o.result.toLowerCase());
  if (!result) die(`--result must be one of ${RESULTS.join('|')}`);
  const bugIds = list(o.bugs);
  const known = new Set(readJson(BUGS, []).map((b) => b.id));
  const unknown = bugIds.filter((b) => !known.has(b));
  if (unknown.length) die(`unknown bug id(s): ${unknown.join(', ')} — add with "bug" first`);
  fs.mkdirSync(DAYS, { recursive: true });
  const file = path.join(DAYS, `${date}.json`);
  const day = readJson(file, { date, entries: [] });
  day.entries.push({
    task: o.task || '', title: o.title, product: o.product, agent: o.agent || o.product,
    source: o.source || 'Dev changelog', result, bugs: bugIds,
    evidence: list(o.evidence), notes: o.notes || '',
  });
  writeJson(file, day);
  console.log(`logged: ${date} · ${o.product} · ${o.title} → ${result}`);
} else if (cmd === 'bug') {
  if (!o.id || !o.title || !o.product || !o.severity) die('bug needs --id --title --product --severity');
  const severity = SEVERITIES.find((s) => s.toLowerCase() === o.severity.toLowerCase());
  if (!severity) die(`--severity must be one of ${SEVERITIES.join('|')}`);
  const bugs = readJson(BUGS, []);
  if (bugs.some((b) => b.id === o.id)) die(`bug ${o.id} already exists (use bug-status to update)`);
  bugs.push({
    id: o.id, title: o.title, product: o.product, severity, status: 'open', found: date,
    task: o.task || '', report: o.report || '', history: [{ date, status: 'open' }],
  });
  writeJson(BUGS, bugs);
  console.log(`bug added: ${o.id} (${severity})`);
} else if (cmd === 'bug-status') {
  const [id, status] = rest;
  if (!id || !STATUSES.includes(status)) die(`usage: bug-status <ID> ${STATUSES.join('|')}`);
  const bugs = readJson(BUGS, []);
  const bug = bugs.find((b) => b.id === id);
  if (!bug) die(`no such bug: ${id}`);
  bug.status = status;
  bug.history = [...(bug.history || [{ date: bug.found, status: 'open' }]), { date, status }];
  writeJson(BUGS, bugs);
  console.log(`bug ${id} → ${status} (${date})`);
} else if (cmd === 'build') {
  // fall through to rebuild only
} else {
  die('commands: entry | bug | bug-status | build  (see header of this file)');
}

const out = buildDashboard();
console.log(`dashboard: ${out}`);
