const XLSX = require('xlsx');
const path = require('path');
const dir = 'd:/Travel VIP API Automation/reports/byufuel-drive';

function countChecklist() {
  const wb = XLSX.readFile(path.join(dir, 'Byufuel - Check list Doc.xlsx'));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.Sheet1, { header: 1, defval: '' });
  let cases = 0;
  const samples = [];
  for (let i = 0; i < rows.length; i++) {
    const a = String(rows[i][0] || '').trim();
    const b = String(rows[i][1] || '').trim();
    const c = String(rows[i][2] || '').trim();
    // section headers like "Admin Features..." in col1 with empty col0 action
    if (/features for verification/i.test(b) || /features for verification/i.test(a)) continue;
    // case: has feature name in col1 (b) OR role+feature pattern
    const feature = b || (a && c ? a : '');
    const detail = c || b;
    if (!feature && !detail) continue;
    // skip pure blanks
    if (/^comments$/i.test(b) || /^status$/i.test(c)) continue;
    // count rows that look like checklist items (have a feature path or login etc.)
    if (b || (a && !/^(ADMIN|SUPPLIER|DRIVER|WAREHOUSE|TSM)$/i.test(a) && c)) {
      // if only role label in col0
      if (/^(ADMIN|SUPPLIER|DRIVER|WAREHOUSE|TSM)$/i.test(a) && !b && !c) continue;
      cases++;
      if (samples.length < 5) samples.push(`${a}|${b}|${c}`.slice(0, 80));
    }
  }
  return { cases, samples };
}

function countByTcId(file, sheet) {
  const wb = XLSX.readFile(path.join(dir, file));
  const sn = sheet || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' });
  const hi = rows.findIndex((r) => r.some((c) => /Test Case ID/i.test(String(c))));
  const hdr = rows[hi].map(String);
  const iId = hdr.findIndex((h) => /Test Case ID/i.test(h));
  const iStep = hdr.findIndex((h) => /Step Description/i.test(h));
  const ids = new Set();
  let steps = 0;
  for (let i = hi + 1; i < rows.length; i++) {
    const id = String(rows[i][iId] || '').trim();
    const st = String(rows[i][iStep] || '').trim();
    if (id) ids.add(id);
    if (st) steps++;
  }
  return { sheet: sn, distinctIds: ids.size, stepRows: steps, ids: [...ids] };
}

function countTcPack() {
  const wb = XLSX.readFile(path.join(dir, "Byufuel-TC's.xlsx"));
  let distinctTC = 0;
  let stepRows = 0;
  const per = [];
  for (const sn of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' });
    const hi = rows.findIndex((r) => r.some((c) => String(c) === 'Test Case' || /^Test Case$/i.test(String(c))));
    if (hi < 0) continue;
    const hdr = rows[hi].map(String);
    const iTC = hdr.findIndex((h) => /^Test Case$/i.test(h.trim()));
    const iStep = hdr.findIndex((h) => /Step Description/i.test(h));
    const set = new Set();
    let steps = 0;
    for (let i = hi + 1; i < rows.length; i++) {
      const tc = String(rows[i][iTC] || '').trim();
      const st = String(rows[i][iStep] || '').trim();
      if (tc) set.add(tc);
      if (st) steps++;
    }
    per.push({ sn, distinctTC: set.size, stepRows: steps });
    distinctTC += set.size;
    stepRows += steps;
  }
  return { distinctTC, stepRows, per };
}

const checklist = countChecklist();
const bulk = countByTcId("Byufuel - Bulk Schedule web TC's.xlsx");
const tsmW = countByTcId('Byufuel- TSM (Web).xlsx', 'TSM- Web');
const tsmM = countByTcId('Byufuel-TSM (Mobile).xlsx', 'TSM- Mobile');
const tc = countTcPack();

const totalDistinct =
  checklist.cases + bulk.distinctIds + tsmW.distinctIds + tsmM.distinctIds + tc.distinctTC;
const totalSteps =
  checklist.cases + bulk.stepRows + tsmW.stepRows + tsmM.stepRows + tc.stepRows;

console.log(
  JSON.stringify(
    {
      countingNote:
        'Distinct = unique Test Case / TC ID / checklist feature rows. Steps = step-description rows in TC packs.',
      checklist,
      bulk,
      tsmWeb: tsmW,
      tsmMobile: tsmM,
      byufuelTCs: tc,
      TOTAL_DISTINCT_TESTCASES: totalDistinct,
      TOTAL_STEP_ROWS: totalSteps,
    },
    null,
    2
  )
);
