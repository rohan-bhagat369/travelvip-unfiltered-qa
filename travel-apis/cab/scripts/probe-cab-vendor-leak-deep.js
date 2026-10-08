/**
 * Deeper cab leak scan: mojobox + bookairportcab outside image/logo URL fields.
 */
import fs from 'fs';
import { authenticate } from '../../../shared/lib/authService.js';
import { CabService } from '../src/service.js';
import {
  buildAirportSearchBody,
  buildOutstationSearchBody,
  buildRentalSearchBody,
  pickCab,
} from '../src/helpers.js';

const VENDOR_RES = [/mojoboxx?/i, /mojo[\s_-]?box/i, /bookairportcab/i];
const IMAGE_KEY = /image|logo|url|icon/i;

function walk(value, path, onHit) {
  if (value == null) return;
  if (typeof value === 'string') {
    for (const re of VENDOR_RES) {
      if (re.test(value)) onHit({ path, value: value.slice(0, 240), match: String(re) });
    }
    return;
  }
  if (typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${path}[${i}]`, onHit));
    return;
  }
  for (const [k, v] of Object.entries(value)) {
    walk(v, `${path}.${k}`, onHit);
  }
}

function classify(path) {
  const leaf = path.split('.').pop() || '';
  if (IMAGE_KEY.test(leaf) || /image|logo/i.test(path)) return 'logo_or_image_url';
  if (/exclusion|inclusion|message|email|contact|care@/i.test(path + (''))) return 'text_copy';
  return 'other_field';
}

const session = await authenticate(true);
const cab = new CabService(session.client);
const journeys = [
  { type: 'AIRPORT', body: buildAirportSearchBody() },
  { type: 'RENTAL', body: buildRentalSearchBody() },
  { type: 'OUTSTATION', body: buildOutstationSearchBody() },
];

const hits = [];
for (const j of journeys) {
  const search = await cab.search(j.body);
  walk(search.data, '$', (h) => hits.push({ journeyType: j.type, api: 'search', bucket: classify(h.path), ...h }));
  const picked = pickCab(search.data?.cabs);
  if (picked?.searchId) {
    const fare = await cab.fare(picked.searchId);
    walk(fare.data, '$', (h) => hits.push({ journeyType: j.type, api: 'fare', bucket: classify(h.path), ...h }));
  }
}

const byBucket = {};
for (const h of hits) {
  byBucket[h.bucket] = byBucket[h.bucket] || [];
  byBucket[h.bucket].push(h);
}

const summary = {
  ranAt: new Date().toISOString(),
  totals: Object.fromEntries(Object.entries(byBucket).map(([k, v]) => [k, v.length])),
  uniqueNonImage: [...new Map(
    (byBucket.other_field || []).concat(byBucket.text_copy || [])
      .map((h) => [`${h.path.replace(/\[\d+\]/g, '[]')}|${h.value}`, h]),
  ).values()],
  sampleImage: (byBucket.logo_or_image_url || []).slice(0, 3),
};

fs.writeFileSync('reports/cab-vendor-leak-deep.json', JSON.stringify({ summary, hits }, null, 2));
console.log(JSON.stringify(summary, null, 2));
