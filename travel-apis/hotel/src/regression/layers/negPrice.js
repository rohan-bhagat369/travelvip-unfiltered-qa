import path from 'path';
import { spawnNode, mergeRowsFromReport } from '../spawnProbe.js';
import { row } from '../report.js';

/** No negative baseFare / taxes / totalAmount / breakup on search + details. No book. */
export async function runNegPrice(cwd) {
  const outName = process.env.HOTEL_NEGPRICE_OUT || 'hotel-regression-negprice.json';
  const code = await spawnNode('travel-apis/hotel/scripts/probe-hotel-no-negative-prices.js', {
    REPORT_OUT: outName,
    HOTEL_NEGPRICE_OUT: outName,
    HOTEL_CHECKIN: process.env.HOTEL_CHECKIN || '',
    HOTEL_CHECKOUT: process.env.HOTEL_CHECKOUT || '',
  }, { cwd });

  const filePath = path.join(cwd, 'reports', outName);
  const merged = mergeRowsFromReport(filePath, 'NEGPRICE');
  if (merged.length) return merged;

  return [row(
    'NEGPRICE', 'pack', 1, 'No-negative-price search/details pack spawn',
    'travel-apis/hotel/scripts/probe-hotel-no-negative-prices.js',
    'JSON report with NEGPRICE rows (domestic + intl cities, Hilltop/Rotana anchors)',
    `exit=${code} missing ${outName}`,
    'BUG',
  )];
}
