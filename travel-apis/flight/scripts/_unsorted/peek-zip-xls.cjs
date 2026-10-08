const fs = require('fs');
const p = 'd:/Travel VIP API Automation/reports/byufuel-drive/tsm-zipcodes-download.xlsx';
const buf = fs.readFileSync(p);
console.log('size', buf.length, 'head', buf.slice(0, 180).toString('utf8').replace(/\s+/g, ' '));
