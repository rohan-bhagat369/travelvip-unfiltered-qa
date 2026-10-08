const XLSX = require('xlsx');
const fs = require('fs');

const wb = XLSX.readFile('reports/byufuel-drive/BYUFUEL-Validated-TCs-live.xlsx');
const hits = [];

for (const sn of wb.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' });
  const hi = rows.findIndex((r) =>
    r.some((c) => /Credible ESG Status|Rohan TravelVIP Status|Feature \/ Case|Test Case|Step Description/i.test(String(c))),
  );
  if (hi < 0) continue;
  const hdr = rows[hi].map(String);
  const iStatus = hdr.findIndex((x) => /Credible ESG Status|Rohan TravelVIP Status|^Status$/i.test(x.trim()));
  const iActual = hdr.findIndex((x) => /Credible ESG Actual|Rohan TravelVIP Actual|Actual Result/i.test(x.trim()));
  const iCase = hdr.findIndex((x) => /Feature \/ Case|^Test Case$|Test Scenario|Test script name/i.test(x.trim()));
  const iStep = hdr.findIndex((x) => /Step Description/i.test(x));
  const iId = hdr.findIndex((x) => /^#$|^TC$|TC ID|Reference Number/i.test(x.trim()));
  const iTcId = hdr.findIndex((x) => /^TC ID$|^TC$/i.test(x.trim()) || x === 'TC');

  for (let i = hi + 1; i < rows.length; i++) {
    const cells = rows[i].map((x) => String(x ?? ''));
    const line = cells.join(' | ');
    if (!/recurring|reschedul|confirm|document|documentation|challan|generate doc/i.test(line)) continue;

    const caseText = (cells[iCase] || cells[iStep] || cells[2] || '').replace(/\s+/g, ' ').trim();
    const step = (iStep >= 0 ? cells[iStep] : '').replace(/\s+/g, ' ').trim();
    const status = (iStatus >= 0 ? cells[iStatus] : '').trim();
    const actual = (iActual >= 0 ? cells[iActual] : '').replace(/\s+/g, ' ').trim();
    const id = (cells[iTcId] || cells[iId] || '').trim();
    if (!caseText && !step && !status && !actual) continue;

    hits.push({
      sheet: sn,
      row: i + 1,
      id: id.slice(0, 40),
      case: caseText.slice(0, 140),
      step: step.slice(0, 120),
      status: status.slice(0, 20),
      actual: actual.slice(0, 220),
    });
  }
}

const bucket = {
  adminBulkRecurring: hits.filter((h) =>
    /02-Bulk|Bulk Recurring|existing schedues replaced|isRecurring|recurring existing|upon confirmation while recurring/i.test(
      `${h.sheet} ${h.case} ${h.step} ${h.actual}`,
    ),
  ),
  adminRescheduleSuggest: hits.filter((h) =>
    /Suggest a new time|reschedul|Request Management/i.test(`${h.case} ${h.step} ${h.actual}`)
    && /01-Checklist|Request|admin/i.test(`${h.sheet} ${h.case}`),
  ),
  supplierRecurring: hits.filter((h) =>
    /TC-Supplier|01-Checklist/i.test(h.sheet)
    && /recurring/i.test(`${h.case} ${h.step} ${h.actual}`)
    && !/02-Bulk/i.test(h.sheet),
  ),
  warehouseOrDocGen: hits.filter((h) =>
    /Generate Documentation|documentation|challan|Document Template|KYC Document/i.test(`${h.case} ${h.step} ${h.actual}`),
  ),
  checklistWhSection: hits.filter((h) =>
    h.sheet === '01-Checklist'
    && /Warehouse|Checkin|Collect Oil|Generate QR|Document|Incoming/i.test(`${h.case} ${h.step}`),
  ),
};

fs.writeFileSync('reports/byufuel-recurring-docs-scan.json', JSON.stringify({ totalHits: hits.length, ...bucket, allHits: hits }, null, 2));

function print(title, arr) {
  console.log(`\n=== ${title} (${arr.length}) ===`);
  for (const h of arr) {
    console.log(`- [${h.sheet}] ${h.id || '-'} | ${h.case || h.step}`);
    console.log(`  Status: ${h.status || '(blank)'} | ${h.actual || '(no actual)'}`);
  }
}

print('Admin / Bulk recurring + confirmation', bucket.adminBulkRecurring);
print('Admin reschedule / suggest new time', bucket.adminRescheduleSuggest);
print('Supplier recurring (related)', bucket.supplierRecurring.filter((h, i, a) => {
  // dedupe by case+status
  return a.findIndex((x) => x.case === h.case && x.status === h.status && x.sheet === h.sheet) === i;
}));
print('Documentation / challan / generate docs', bucket.warehouseOrDocGen.filter((h, i, a) =>
  a.findIndex((x) => x.sheet === h.sheet && x.case === h.case && x.status === h.status) === i,
));
print('Checklist warehouse-ish', bucket.checklistWhSection);
