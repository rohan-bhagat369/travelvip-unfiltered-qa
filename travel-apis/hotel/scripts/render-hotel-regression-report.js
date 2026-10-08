/**
 * Re-render hotel regression JSON → md / html / xlsx (no API calls).
 *
 *   node scripts/render-hotel-regression-report.js reports/hotel-regression-staging-2026-08-16.json
 */
import fs from 'fs';
import path from 'path';
import { writeRegressionReports } from '../src/regression/writeReports.js';

const src = process.argv[2] || path.join('reports', 'hotel-regression', 'latest.json');
if (!fs.existsSync(src)) {
  console.error('No report JSON:', src);
  process.exit(1);
}
const report = JSON.parse(fs.readFileSync(src, 'utf8'));
const out = src.endsWith('.json') ? src : `${src}.json`;
const paths = writeRegressionReports(report, out);
console.log('JSON:  ', paths.jsonPath);
console.log('MD:    ', paths.mdPath);
console.log('HTML:  ', paths.htmlPath);
console.log('Excel: ', paths.xlsxPath);
console.log('Latest:', paths.latest.md);
