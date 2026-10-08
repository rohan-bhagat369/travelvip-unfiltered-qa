import fs from 'fs';
import path from 'path';

export function tally(rows) {
  return {
    PASS: rows.filter((r) => r.status === 'PASS').length,
    BUG: rows.filter((r) => r.status === 'BUG').length,
    'NOT TESTED': rows.filter((r) => r.status === 'NOT TESTED' || r.status === 'NOT_TESTED').length,
    total: rows.length,
  };
}

export function row(tag, section, id, rule, how, expected, actual, status, extra = {}) {
  const rec = { tag, section, id, rule, how, expected, actual, status, ...extra };
  console.log(`${String(status).padEnd(11)} | ${tag}.${id} | ${rule} | ${actual}`);
  return rec;
}

export function errCode(res) {
  return res?.data?.error?.code || res?.data?.code || null;
}

export function brief(d, n = 360) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d).slice(0, n); }
}

export function printTables(rows) {
  const tags = [...new Set(rows.map((r) => r.tag))];
  for (const tag of tags) {
    const list = rows.filter((r) => r.tag === tag);
    console.log(`\n### ${tag}  (${tally(list).PASS} PASS / ${tally(list).BUG} BUG / ${tally(list)['NOT TESTED']} NT)`);
    console.log('| # | Rule | How tested | Status |');
    console.log('|---|------|------------|--------|');
    list.forEach((r, i) => {
      console.log(`| ${i + 1} | ${r.rule} | ${r.how} | ${r.status} |`);
    });
  }
}

export function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}
