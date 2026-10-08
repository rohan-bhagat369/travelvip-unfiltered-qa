import path from 'path';
import { spawnNode, mergeRowsFromReport } from '../spawnProbe.js';
import { row } from '../report.js';

/** No-availability SRP reshape + available hotels through details. Search/details only — no book. */
export async function runUnavail(cwd) {
  const outName = process.env.HOTEL_UNAVAIL_OUT || 'hotel-regression-unavail.json';
  const code = await spawnNode('travel-apis/hotel/scripts/probe-hotel-no-availability-and-details.js', {
    REPORT_OUT: outName,
    HOTEL_CHECKIN: process.env.HOTEL_CHECKIN || '',
    HOTEL_CHECKOUT: process.env.HOTEL_CHECKOUT || '',
  }, { cwd });

  const filePath = path.join(cwd, 'reports', outName);
  const merged = mergeRowsFromReport(filePath, 'UNAVAIL');
  if (merged.length) return merged;

  return [row(
    'UNAVAIL', 'pack', 1, 'No-availability + details pack spawn',
    'travel-apis/hotel/scripts/probe-hotel-no-availability-and-details.js',
    'JSON report with UNAVAIL / CITY_SEARCH / CITY_DETAILS rows',
    `exit=${code} missing ${outName}`,
    'BUG',
  )];
}
