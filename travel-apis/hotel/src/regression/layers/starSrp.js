import path from 'path';
import { spawnNode, mergeRowsFromReport } from '../spawnProbe.js';
import { row } from '../report.js';

/** SRP star filter (3/4/5★) must match Hotel Details starRating. Search/details only — no book. */
export async function runStarSrp(cwd) {
  const outName = process.env.HOTEL_STARSRP_OUT || 'hotel-regression-star-srp.json';
  const code = await spawnNode('travel-apis/hotel/scripts/probe-hotel-star-srp-vs-details.js', {
    REPORT_OUT: outName,
    HOTEL_CHECKIN: process.env.HOTEL_CHECKIN || '',
    HOTEL_CHECKOUT: process.env.HOTEL_CHECKOUT || '',
    HOTEL_STARS: process.env.HOTEL_STARS || '4,5,3',
    HOTEL_DETAIL_LIMIT: process.env.HOTEL_DETAIL_LIMIT || '8',
  }, { cwd });

  const filePath = path.join(cwd, 'reports', outName);
  const merged = mergeRowsFromReport(filePath, 'STARSRP');
  if (merged.length) return merged;

  return [row(
    'STARSRP', 'pack', 1, 'Star SRP vs Details pack spawn',
    'travel-apis/hotel/scripts/probe-hotel-star-srp-vs-details.js',
    'JSON report with SRP + SRP_VS_DETAILS rows per city/star',
    `exit=${code} missing ${outName}`,
    'BUG',
  )];
}
