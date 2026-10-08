const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const OUT = 'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25';
const TRACKER = path.join(OUT, 'BYUFUEL-TravelVIP-Execution-Tracker.xlsx');
const BASE = 'https://u-byufuel.azurewebsites.net';
const TODAY = '2026-09-28';

const updates = {
  TC01: [
    'PASS',
    'TSM & Leads menu is under User Management and the page loads.',
    BASE + '/uam/tsm-leads',
  ],
  TC02: [
    'PASS',
    'TSM ZipCodes menu loads. On this build it sits under User Management.',
    BASE + '/uam/tsm-zipcodes',
  ],
  TC03: [
    'PASS',
    'City Lead Rohan CityLead created ACTIVE. Reports to Hyd Admin. rohan.city.byufuel@yopmail.com',
    BASE + '/uam/tsm-leads/87_11HgBrOwpFMjxclH8zw/view',
  ],
  TC04: [
    'PASS',
    'Area Lead Rohan AreaLead created ACTIVE. Reports to Rohan CityLead. rohan.area.byufuel@yopmail.com',
    BASE + '/uam/tsm-leads/kqufwvYb19UAljXppJEomQ/view',
  ],
  TC05: [
    'PASS',
    'TSM Rohan Bhagat created ACTIVE. Reports to Test AreaLead. rohan.tsm.byufuel@yopmail.com',
    BASE + '/uam/tsm-leads/ITlOiz2llDWqKZCSEEPjow/view',
  ],
  TC06: [
    'PASS',
    'Rohan Bhagat Deactivate changed status to Deactivated.',
    BASE + '/uam/tsm-leads/ITlOiz2llDWqKZCSEEPjow/view',
  ],
  TC07: [
    'PASS',
    'Same TSM Activate set status back to Active.',
    BASE + '/uam/tsm-leads/ITlOiz2llDWqKZCSEEPjow/view',
  ],
  TC08: [
    'PASS',
    'Added zip 500084 on Rohan Bhagat. Row shows on his Zip Codes list and the TSM ZipCodes list.',
    BASE + '/uam/tsm-zipcodes',
  ],
  TC09: [
    'PASS',
    'Blank pin in the downloaded sheet replaced with 500001. Upload HTTP 200. List shows Test TSM 500001. Raw download with an empty PinCode still returns HTTP 500.',
    BASE + '/uam/tsm-zipcodes',
  ],
};

const wb = XLSX.readFile(TRACKER);
const sn = '03-TSM-Web';
const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' });
rows[0][3] = BASE;
const hi = 1;
const hdr = rows[hi].map(String);
const iId = hdr.indexOf('TC ID');
const iStatus = hdr.indexOf('Rohan TravelVIP Status');
const iActual = hdr.indexOf('Rohan TravelVIP Actual');
const iEv = hdr.indexOf('Evidence / Notes');
const iDate = hdr.indexOf('Executed Date (TravelVIP)');

let n = 0;
for (let r = hi + 1; r < rows.length; r++) {
  const id = String(rows[r][iId] || '');
  if (!updates[id]) continue;
  const [status, actual, ev] = updates[id];
  rows[r][iStatus] = status;
  rows[r][iActual] = actual;
  rows[r][iEv] = ev;
  rows[r][iDate] = TODAY;
  n++;
}
wb.Sheets[sn] = XLSX.utils.aoa_to_sheet(rows);

const sum = XLSX.utils.sheet_to_json(wb.Sheets['00-Summary'], { header: 1, defval: '' });
const web = sum.find((r) => r[0] === '03-TSM-Web');
if (!web) throw new Error('summary row missing');
const old = { PASS: Number(web[1]), PARTIAL: Number(web[3]), BLOCKED: Number(web[4]) };
web[1] = 9;
web[2] = 0;
web[3] = 0;
web[4] = 0;
web[5] = 0;
const tot = sum[6];
tot[0] = Number(tot[0]) + (9 - old.PASS);
tot[2] = Number(tot[2]) + (0 - old.PARTIAL);
tot[3] = Number(tot[3]) + (0 - old.BLOCKED);
const noteAt = sum.findIndex((r) => String(r[0]).startsWith('TSM Web Azure'));
const note = [
  'TSM Web Azure',
  TODAY,
  'TC01–TC09 PASS on u-byufuel. TC09 upload PASS after pin 500001. Raw download with blank pin still HTTP 500.',
  BASE + '/uam/tsm-leads',
  '',
  '',
];
if (noteAt >= 0) sum[noteAt] = note;
else sum.push(note);
wb.Sheets['00-Summary'] = XLSX.utils.aoa_to_sheet(sum);
const tmp = TRACKER.replace(/\.xlsx$/, '.tmp.xlsx');
XLSX.writeFile(wb, tmp);
try {
  fs.copyFileSync(tmp, TRACKER);
  fs.unlinkSync(tmp);
} catch (err) {
  console.error('TRACKER_LOCKED', err.code, tmp);
  process.exitCode = 2;
}

const csvRows = rows.map((r) =>
  r
    .map((c) => {
      const s = String(c ?? '');
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : '"' + s + '"';
    })
    .join(',')
);
fs.writeFileSync(path.join(OUT, '03-TSM-Web-tracker.csv'), csvRows.join('\n') + '\n');
console.log(JSON.stringify({ updated: n, totals: tot, web: web.slice(0, 6) }));
