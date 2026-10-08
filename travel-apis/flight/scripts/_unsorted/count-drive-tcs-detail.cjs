const XLSX = require('xlsx');
const path = require('path');
const dir = 'd:/Travel VIP API Automation/reports/byufuel-drive';

const wb = XLSX.readFile(path.join(dir, "Byufuel-TC's.xlsx"));
console.log('--- Distinct Test Case names in Byufuel-TCs ---');
let distinctAll = 0;
let stepsAll = 0;
for (const sn of wb.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' });
  const hi = rows.findIndex((r) => r.some((c) => /Test Case/i.test(String(c))));
  if (hi < 0) continue;
  const hdr = rows[hi].map(String);
  const iTC = hdr.findIndex((h) => /^Test Case$/i.test(h.trim()));
  const iStep = hdr.findIndex((h) => /Step Description/i.test(h));
  const set = new Set();
  let steps = 0;
  for (let i = hi + 1; i < rows.length; i++) {
    const tc = String(rows[i][iTC] || '').trim();
    const st = String(rows[i][iStep] || '').trim();
    if (st) steps++;
    if (tc) set.add(tc);
  }
  console.log(sn, 'distinctTC=', set.size, 'stepRows=', steps);
  distinctAll += set.size;
  stepsAll += steps;
}
console.log('distinctTC_sum', distinctAll, 'stepRows_sum', stepsAll);

const cl = XLSX.readFile(path.join(dir, 'Byufuel - Check list Doc.xlsx'));
const rows = XLSX.utils.sheet_to_json(cl.Sheets[cl.SheetNames[0]], { header: 1, defval: '' });
const hi = rows.findIndex((r) => r.some((c) => /Feature/i.test(String(c))));
let n = 0;
for (let i = hi + 1; i < rows.length; i++) {
  if (/^\d+$/.test(String(rows[i][0] || '').trim()) && String(rows[i][2] || rows[i][1] || '').trim()) n++;
}
console.log('Checklist numbered features', n);
console.log('Checklist header', rows[hi]);

function countNumbered(file, sheetHint) {
  const w = XLSX.readFile(path.join(dir, file));
  const sn = sheetHint || w.SheetNames[0];
  const r = XLSX.utils.sheet_to_json(w.Sheets[sn], { header: 1, defval: '' });
  const h = r.findIndex((row) => row.some((c) => /Test Case|Feature|Scenario|TC/i.test(String(c))));
  let c = 0;
  for (let i = h + 1; i < r.length; i++) {
    if (/^\d+$/.test(String(r[i][0] || '').trim()) && r[i].some((x, idx) => idx > 0 && String(x || '').trim())) c++;
  }
  return { sn, c, header: r[h] };
}
console.log('Bulk', countNumbered("Byufuel - Bulk Schedule web TC's.xlsx"));
console.log('TSM Web', countNumbered('Byufuel- TSM (Web).xlsx'));
console.log('TSM Mobile', countNumbered('Byufuel-TSM (Mobile).xlsx'));
