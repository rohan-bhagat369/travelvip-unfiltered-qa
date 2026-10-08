import path from 'path';
import { spawnNode, mergeRowsFromReport } from '../spawnProbe.js';
import { row } from '../report.js';

export async function runStarBook(cwd) {
  const outName = process.env.HOTEL_STAR_OUT || 'hotel-regression-starbook.json';
  const code = await spawnNode('travel-apis/hotel/scripts/probe-hotel-search-star-sort-canary.js', {
    HOTEL_STAR_OUT: outName,
  }, { cwd });

  const filePath = path.join(cwd, 'reports', outName);
  const merged = mergeRowsFromReport(filePath, 'STARBOOK');
  if (merged.length) return merged;

  return [row(
    'STARBOOK', 'star', 1, 'Star filter + price sort spawn',
    'travel-apis/hotel/scripts/probe-hotel-search-star-sort-canary.js',
    'JSON report with 4★ / ASC / DESC rows',
    `exit=${code} missing ${outName}`,
    'BUG',
  )];
}
