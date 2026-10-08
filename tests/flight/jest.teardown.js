import fs from 'fs';
import path from 'path';
import { flightReporter } from '../../travel-apis/flight/src/reporter.js';

const SESSION_FILE = path.resolve('reports/flight/.session.json');

function loadSessionIntoReporter() {
  if (!fs.existsSync(SESSION_FILE)) return false;
  const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  flightReporter.suite = 'Flight API — All Suites';
  flightReporter.startedAt = data.startedAt || flightReporter.startedAt;
  flightReporter.testCases = data.testCases || [];
  return flightReporter.testCases.length > 0;
}

export default async function globalTeardown() {
  loadSessionIntoReporter();
  const paths = flightReporter.writeReports();
  console.log(`\nFlight report JSON:  ${paths.latestJson}`);
  console.log(`Flight report HTML:  ${paths.latestHtml}`);
  console.log(`Flight report Excel: ${paths.latestExcel}`);
}
