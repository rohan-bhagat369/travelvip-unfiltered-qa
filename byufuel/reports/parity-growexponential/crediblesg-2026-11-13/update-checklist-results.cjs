const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'checklist-crediblesg-results.json');
const data = JSON.parse(fs.readFileSync(OUT, 'utf8'));

// Correct retests
const fixes = {
  10: {
    status: 'PASS',
    actual: 'Workers | BYUFUEL · List of Workers · Add Worker present (path /uam/wh-users)',
  },
  20: {
    status: 'PASS',
    actual: 'Supplier Cancellation Amount | BYUFUEL · List of Supplier Cancellation Amount',
  },
  21: {
    status: 'PASS',
    actual: 'Customer Support | BYUFUEL · Customer Support page loaded',
  },
};

for (const r of data.results) {
  if (fixes[r.id]) Object.assign(r, fixes[r.id]);
}

data.counts = data.results.reduce((a, r) => {
  a[r.status] = (a[r.status] || 0) + 1;
  return a;
}, {});
data.when = new Date().toISOString();
data.note = 'Admin checklist #1-22 on uat-byufuel.crediblesg.com; #14 FAIL Manual-only scan menus';

fs.writeFileSync(OUT, JSON.stringify(data, null, 2));

// Build paste block for sheet starting at I4 (header + rows for ids 1..22)
const byId = Object.fromEntries(data.results.map((r) => [r.id, r]));
const lines = ['uat-byufuel.crediblesg status\tuat-byufuel.crediblesg actual'];
for (let id = 1; id <= 22; id++) {
  const r = byId[id] || { status: 'NOT TESTED', actual: '' };
  lines.push(`${r.status}\t${(r.actual || '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ')}`);
}
const tsv = lines.join('\n');
fs.writeFileSync(path.join(__dirname, 'sheet-tsv/_checklist_status_I4.tsv'), tsv);
fs.writeFileSync(path.join(__dirname, 'sheet-tsv/_checklist_status_I4.b64'), Buffer.from(tsv).toString('base64'));
console.log('counts', data.counts);
console.log(tsv);
