import path from 'path';
import { spawnNode, mergeRowsFromReport } from '../spawnProbe.js';
import { row } from '../report.js';

export async function runListing(cwd) {
  const outName = process.env.CATALOG_OUT || 'hotel-regression-listing.json';
  const code = await spawnNode('travel-apis/hotel/scripts/probe-hotel-search-test-pack-catalog-dev.js', {
    CATALOG_USE_PARTNER: '1',
    CATALOG_LISTING_PATH: '/v1/hotels/search',
    CATALOG_OUT: outName,
    CATALOG_PID: process.env.CATALOG_PID || 'vgm',
    CATALOG_TIER_ID: process.env.TIER_ID || '10546901',
  }, { cwd });

  const filePath = path.join(cwd, 'reports', outName);
  const merged = mergeRowsFromReport(filePath, 'LISTING');
  if (merged.length) return merged;

  return [row(
    'LISTING', 'pack', 1, 'Listing pack spawn',
    'travel-apis/hotel/scripts/probe-hotel-search-test-pack-catalog-dev.js CATALOG_USE_PARTNER=1',
    'JSON report with rows',
    `exit=${code} missing ${outName}`,
    'BUG',
  )];
}
