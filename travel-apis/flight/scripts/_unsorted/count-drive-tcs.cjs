const XLSX = require('xlsx');
const path = require('path');
const dir = 'd:/Travel VIP API Automation/reports/byufuel-drive';

const files = [
  ['Byufuel - Check list Doc.xlsx', 'Checklist'],
  ["Byufuel - Bulk Schedule web TC's.xlsx", 'Bulk Schedule'],
  ['Byufuel- TSM (Web).xlsx', 'TSM Web'],
  ['Byufuel-TSM (Mobile).xlsx', 'TSM Mobile'],
  ["Byufuel-TC's.xlsx", 'Byufuel-TCs'],
];

function looksLikeHeader(row) {
  const s = row.map((c) => String(c || '').toLowerCase()).join('|');
  return /test case|feature|step description|scenario|tc id|reference number|works\?/i.test(s);
}
function isBlank(row) {
  return !row || row.every((c) => !String(c || '').trim());
}

function countSheet(ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (!rows.length) return { cases: 0, note: 'empty' };

  let hi = -1;
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    if (looksLikeHeader(rows[i])) {
      hi = i;
      break;
    }
  }
  if (hi < 0) hi = 0;
  const hdr = rows[hi].map(String);
  const iCase = hdr.findIndex((h) =>
    /test case|feature \/ case|feature|scenario|test script name/i.test(h)
  );
  const iStep = hdr.findIndex((h) => /step description/i.test(h));
  const iStepNo = hdr.findIndex((h) => /^step #$/i.test(h) || /^step$/i.test(h));
  const iRef = hdr.findIndex((h) => /reference number|tc id/i.test(h));
  const iFeat2 = hdr.findIndex((h) => /^#$/i.test(h) || h === '#');

  let cases = 0;
  const samples = [];

  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    if (isBlank(r)) continue;
    if (/^pack$/i.test(String(r[0] || ''))) continue;

    const feat = iCase >= 0 ? String(r[iCase] || '').trim() : '';
    const step = iStep >= 0 ? String(r[iStep] || '').trim() : '';
    const stepNo = iStepNo >= 0 ? String(r[iStepNo] || '').trim() : '';
    const ref = iRef >= 0 ? String(r[iRef] || '').trim() : '';
    const num = iFeat2 >= 0 ? String(r[iFeat2] || '').trim() : String(r[0] || '').trim();
    const numbered = /^\d+$/.test(num);

    // Checklist / Bulk / TSM: numbered rows with a feature/scenario
    // TC pack: rows with Step Description (step-level cases) OR new Test Case name
    let count = false;
    if (step) count = true;
    else if (feat && (numbered || ref || iCase >= 0)) count = true;
    else if (numbered && r.filter((c) => String(c || '').trim()).length >= 2) count = true;

    if (count) {
      cases++;
      if (samples.length < 2) samples.push((feat || step || num).slice(0, 70));
    }
  }
  return {
    cases,
    headerRow: hi,
    cols: { iCase, iStep, iRef },
    hdr: hdr.filter(Boolean).slice(0, 10),
    samples,
  };
}

let grand = 0;
const report = [];
for (const [file, label] of files) {
  const wb = XLSX.readFile(path.join(dir, file));
  let fileTotal = 0;
  const sheets = [];
  for (const sn of wb.SheetNames) {
    const c = countSheet(wb.Sheets[sn]);
    sheets.push({ sheet: sn, cases: c.cases, hdr: c.hdr, samples: c.samples });
    fileTotal += c.cases;
  }
  grand += fileTotal;
  report.push({ file, label, fileTotal, sheets });
}

console.log(JSON.stringify({ grandTotal: grand, files: report }, null, 2));
