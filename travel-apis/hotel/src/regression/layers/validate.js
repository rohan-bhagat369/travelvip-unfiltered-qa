import path from 'path';
import { spawnNode, mergeRowsFromReport } from '../spawnProbe.js';
import { row } from '../report.js';

export async function runValidate(cwd) {
  const outName = process.env.HOTEL_VAL_OUT || 'hotel-regression-validations.json';
  const code = await spawnNode('travel-apis/hotel/scripts/probe-hotel-payload-validations.js', {
    HOTEL_VAL_OUT: outName,
  }, { cwd });

  const filePath = path.join(cwd, 'reports', outName);
  const merged = mergeRowsFromReport(filePath, 'VALIDATE').map((r, i) => ({
    ...r,
    id: r.id || i + 1,
  }));
  if (merged.length) return merged;

  return [row(
    'VALIDATE', 'payload', 1, 'Payload validations spawn',
    'travel-apis/hotel/scripts/probe-hotel-payload-validations.js',
    'JSON report with rows',
    `exit=${code} missing ${outName}`,
    'BUG',
  )];
}
