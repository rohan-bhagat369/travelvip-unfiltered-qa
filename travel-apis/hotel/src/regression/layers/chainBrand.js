import path from 'path';
import { spawnNode, mergeRowsFromReport } from '../spawnProbe.js';
import { row } from '../report.js';

/** Chain + Brand filters + star/GST/free-cancel regression. Search only — no book. */
export async function runChainBrand(cwd) {
  const outName = process.env.HOTEL_CHAINBRAND_OUT || 'hotel-regression-chain-brand.json';
  const code = await spawnNode('travel-apis/hotel/scripts/probe-hotel-chain-brand-filters-cities.js', {
    REPORT_OUT: outName,
    HOTEL_CHECKIN: process.env.HOTEL_CHECKIN || '',
    HOTEL_CHECKOUT: process.env.HOTEL_CHECKOUT || '',
    HOTEL_LIMIT: process.env.HOTEL_LIMIT || '20',
  }, { cwd });

  const filePath = path.join(cwd, 'reports', outName);
  const merged = mergeRowsFromReport(filePath, 'CHAINBRAND');
  if (merged.length) return merged;

  return [row(
    'CHAINBRAND', 'pack', 1, 'Chain/Brand filter pack spawn',
    'travel-apis/hotel/scripts/probe-hotel-chain-brand-filters-cities.js',
    'JSON report with Baseline / Chain / Brand / Existing / neg rows',
    `exit=${code} missing ${outName}`,
    'BUG',
  )];
}

/** Optional spot-check: filtered result names vs chain/brand facet (alias-aware). Search only. */
export async function runChainBrandValue(cwd) {
  const outName = process.env.HOTEL_CHAINBRANDVAL_OUT || 'hotel-regression-chain-brand-value.json';
  const code = await spawnNode('travel-apis/hotel/scripts/probe-hotel-chain-brand-value-verify.js', {
    REPORT_OUT: outName,
    HOTEL_CHECKIN: process.env.HOTEL_CHECKIN || '',
    HOTEL_CHECKOUT: process.env.HOTEL_CHECKOUT || '',
    FILTER_SAMPLE_N: process.env.FILTER_SAMPLE_N || '5',
    FILTER_SEED: process.env.FILTER_SEED || '',
    HOTEL_PAGES: process.env.HOTEL_PAGES || '2',
  }, { cwd });

  const filePath = path.join(cwd, 'reports', outName);
  const merged = mergeRowsFromReport(filePath, 'CHAINBRANDVAL');
  if (merged.length) return merged;

  return [row(
    'CHAINBRANDVAL', 'pack', 1, 'Chain/Brand value verify spawn',
    'travel-apis/hotel/scripts/probe-hotel-chain-brand-value-verify.js',
    'JSON report with random facet name-token checks',
    `exit=${code} missing ${outName}`,
    'BUG',
  )];
}
