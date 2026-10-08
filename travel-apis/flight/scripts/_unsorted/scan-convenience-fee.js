/**
 * Scan repo JSON/captured responses and live flight APIs for non-zero convenienceFee.
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../../shared/lib/authService.js';
import { FlightService } from '../../src/service.js';
import { buildOneWaySearchBody, buildRoundTripSearchBody } from '../../src/helpers.js';

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (['node_modules', '.git'].includes(ent.name)) continue;
      walk(p, out);
    } else if (/\.(json|csv|txt|jsonl)$/i.test(ent.name)) out.push(p);
  }
  return out;
}

function collectFees(obj, hits, file) {
  if (!obj || typeof obj !== 'object') return;
  if (Object.prototype.hasOwnProperty.call(obj, 'convenienceFee')) {
    const v = obj.convenienceFee;
    if (typeof v === 'number' && v !== 0) hits.push({ file, value: v });
  }
  for (const v of Object.values(obj)) collectFees(v, hits, file);
}

function scanRepo(root) {
  const files = walk(root);
  const nonZero = [];
  const allValues = new Map();
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (!text.includes('convenienceFee')) continue;
    if (file.endsWith('.json')) {
      try {
        collectFees(JSON.parse(text), nonZero, file);
      } catch {
        /* ignore */
      }
    }
    const re = /"convenienceFee"\s*:\s*([0-9]+(?:\.[0-9]+)?)/g;
    let m;
    while ((m = re.exec(text))) {
      const v = Number(m[1]);
      allValues.set(v, (allValues.get(v) || 0) + 1);
      if (v !== 0) nonZero.push({ file, value: v });
    }
  }
  return { allValues, nonZero };
}

function scanPricing(obj, hits, trail = '') {
  if (!obj || typeof obj !== 'object') return;
  if (Object.prototype.hasOwnProperty.call(obj, 'convenienceFee')) {
    hits.push({ path: trail || 'convenienceFee', value: obj.convenienceFee });
  }
  for (const [k, v] of Object.entries(obj)) {
    scanPricing(v, hits, trail ? `${trail}.${k}` : k);
  }
}

async function probeLive() {
  const session = await authenticate(true);
  const flight = new FlightService(session.client);
  const probes = [
    { label: 'OW DEL-BOM NORMAL', body: buildOneWaySearchBody(45, { origin: 'DEL', destination: 'BOM', fareType: 'NORMAL' }) },
    { label: 'OW DEL-BOM STUDENT', body: buildOneWaySearchBody(45, { origin: 'DEL', destination: 'BOM', fareType: 'STUDENT' }) },
    { label: 'OW DEL-BOM SENIOR', body: buildOneWaySearchBody(45, { origin: 'DEL', destination: 'BOM', fareType: 'SENIOR' }) },
    { label: 'OW DEL-BLR NORMAL', body: buildOneWaySearchBody(45, { origin: 'DEL', destination: 'BLR', fareType: 'NORMAL' }) },
    { label: 'RT DEL-BOM NORMAL', body: buildRoundTripSearchBody(45, 52, { origin: 'DEL', destination: 'BOM', fareType: 'NORMAL' }) },
  ];

  const liveHits = [];
  for (const probe of probes) {
    try {
      const search = await flight.searchUntilComplete(probe.body);
      const searchHits = [];
      scanPricing(search.response.data, searchHits);
      const nonZeroSearch = searchHits.filter((h) => h.value !== 0);
      if (nonZeroSearch.length) {
        liveHits.push({ probe: probe.label, stage: 'search', hits: nonZeroSearch.slice(0, 5) });
      }

      const sids = [];
      for (const result of search.response.data?.results || []) {
        for (const opt of result?.options || []) {
          if (opt.searchId) sids.push(opt.searchId);
          if (sids.length >= 3) break;
        }
        if (sids.length >= 3) break;
      }
      if (!sids.length) continue;

      const journeyType = probe.label.startsWith('RT') ? 'ROUND_TRIP' : 'ONE_WAY';
      const pricing = await flight.getPricing(sids.slice(0, journeyType === 'ROUND_TRIP' ? 2 : 1), journeyType);
      const pricingHits = [];
      scanPricing(pricing.data, pricingHits);
      const nonZeroPricing = pricingHits.filter((h) => h.value !== 0);
      if (nonZeroPricing.length) {
        liveHits.push({ probe: probe.label, stage: 'pricing', hits: nonZeroPricing.slice(0, 5) });
      }
    } catch (err) {
      liveHits.push({ probe: probe.label, error: err.message });
    }
  }
  return liveHits;
}

const root = process.cwd();
const { allValues, nonZero } = scanRepo(root);
console.log('=== Repo scan ===');
console.log('Distinct values:', [...allValues.entries()].sort((a, b) => a[0] - b[0]).map(([v, c]) => `${v} (${c}x)`).join(', ') || 'none');
console.log('Non-zero occurrences:', nonZero.length);
for (const h of nonZero.slice(0, 10)) console.log(' ', h.value, path.relative(root, h.file));

console.log('\n=== Live canary probe ===');
const liveHits = await probeLive();
const liveNonZero = liveHits.filter((h) => h.hits?.length);
if (!liveNonZero.length) {
  console.log('No non-zero convenienceFee in live search/pricing probes.');
} else {
  console.log(JSON.stringify(liveNonZero, null, 2));
}
if (liveHits.some((h) => h.error)) {
  console.log('Probe errors:', liveHits.filter((h) => h.error));
}
