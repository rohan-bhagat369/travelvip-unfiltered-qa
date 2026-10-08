/**
 * Re-render flight regression JSON → md / html / xlsx (no API calls).
 *
 *   node scripts/render-flight-regression-report.js reports/flight-regression/latest.json
 */
import fs from 'fs';
import path from 'path';
import { writeRegressionReports } from '../../hotel/src/regression/writeReports.js';

const src = process.argv[2] || path.join('reports', 'flight-regression', 'latest.json');
if (!fs.existsSync(src)) {
  console.error('No report JSON:', src);
  process.exit(1);
}
const report = JSON.parse(fs.readFileSync(src, 'utf8'));
report.suite = report.suite || 'Flight B2B regression';
const out = src.endsWith('.json') ? src : `${src}.json`;
const paths = writeRegressionReports(report, out, { latestFolder: 'flight-regression' });
console.log('JSON:  ', paths.jsonPath);
console.log('MD:    ', paths.mdPath);
console.log('HTML:  ', paths.htmlPath);
console.log('Excel: ', paths.xlsxPath);
console.log('Latest:', paths.latest.md);
