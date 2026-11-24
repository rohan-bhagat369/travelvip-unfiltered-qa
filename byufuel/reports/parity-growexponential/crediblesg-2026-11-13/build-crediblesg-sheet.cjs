const path = require('path');
const XLSX = require(path.join('d:\\Travel VIP API Automation\\node_modules', 'xlsx'));

const src = 'd:\\Travel VIP API Automation\\byufuel\\reports\\byufuel-drive\\BYUFUEL-Validated-TCs-live.xlsx';
const out =
  'd:\\Travel VIP API Automation\\byufuel\\reports\\parity-growexponential\\crediblesg-2026-11-13\\BYUFUEL-Crediblesg-UAT-TCs.xlsx';

const NEW_STATUS = 'uat-byufuel.crediblesg status';
const NEW_ACTUAL = 'uat-byufuel.crediblesg actual';
const GROW_URL = 'https://uat-byufuel.crediblesg.com + APKs com.byufuel.mobile.uat*';

const wb = XLSX.readFile(src);
const outWb = XLSX.utils.book_new();

function trimTrailingEmpty(rows) {
  let last = rows.length - 1;
  while (last >= 0 && !rows[last].some((c) => String(c ?? '').trim())) last--;
  return rows.slice(0, last + 1);
}

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const joined = rows[i].map((c) => String(c)).join('|').toLowerCase();
    if (
      joined.includes('test case') ||
      joined.includes('feature / case') ||
      joined.includes('test script name') ||
      (joined.includes('sheet') && joined.includes('pass'))
    ) {
      return i;
    }
  }
  return -1;
}

for (const name of wb.SheetNames) {
  let rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
  rows = trimTrailingEmpty(rows);

  // Update URL meta row
  if (rows[0] && String(rows[0][0]).trim() === 'URL') {
    rows[0][2] = GROW_URL;
    // keep Tester name
  }

  const headerIdx = findHeaderRow(rows);
  if (headerIdx >= 0) {
    const header = rows[headerIdx].map((c) => String(c));
    if (!header.includes(NEW_STATUS)) {
      header.push(NEW_STATUS);
      header.push(NEW_ACTUAL);
      rows[headerIdx] = header;
    }
    const statusIdx = header.indexOf(NEW_STATUS);
    const actualIdx = header.indexOf(NEW_ACTUAL);
    for (let r = headerIdx + 1; r < rows.length; r++) {
      while (rows[r].length <= actualIdx) rows[r].push('');
      // leave status blank for execution; mark section/title rows later
      if (rows[r][statusIdx] === undefined) rows[r][statusIdx] = '';
      if (rows[r][actualIdx] === undefined) rows[r][actualIdx] = '';
    }
  } else if (name === '00-Summary') {
    // Add columns on summary header if present
    for (const r of rows) {
      // no-op; summary will be rebuilt during execution
    }
  }

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(outWb, sheet, name);
  console.log(name, 'rows', rows.length, 'headerIdx', headerIdx, headerIdx >= 0 ? rows[headerIdx].slice(-4) : null);
}

XLSX.writeFile(outWb, out);
console.log('wrote', out);
