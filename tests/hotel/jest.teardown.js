import fs from 'fs';
import path from 'path';
import { hotelReporter } from '../../travel-apis/hotel/src/reporter.js';

const SESSION_FILE = path.resolve('reports/hotel/.session.json');

function loadSessionIntoReporter() {
  if (!fs.existsSync(SESSION_FILE)) return false;
  const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  hotelReporter.suite = 'Hotel API — All Suites';
  hotelReporter.startedAt = data.startedAt || hotelReporter.startedAt;
  hotelReporter.testCases = data.testCases || [];
  return hotelReporter.testCases.length > 0;
}

export default async function globalTeardown() {
  loadSessionIntoReporter();
  const paths = hotelReporter.writeReports();
  console.log(`\nHotel report JSON:  ${paths.latestJson}`);
  console.log(`Hotel report HTML:  ${paths.latestHtml}`);
  console.log(`Hotel report Excel: ${paths.latestExcel}`);
}
