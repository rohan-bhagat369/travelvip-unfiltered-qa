/**
 * One-hit: user's exact RT DOM payload. Inspect mixed fare cats. No book. No loop.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import { collectOptions } from '../src/searchPicker.js';

process.env.ALLOW_BOOK = 'false';
process.env.BASE_URL = process.env.BASE_URL || 'https://preprod-api.travelvip.ai';
process.env.PARTNER_ID = process.env.PARTNER_ID || 'vgm';
process.env.PARTNER_SECRET = process.env.PARTNER_SECRET || 'vgm_preprod_ojny1swtigd4as';
process.env.TIER_ID = process.env.TIER_ID || '19597201';
process.env.SIGNING_KEY = process.env.SIGNING_KEY || 'sk_live_yg81bca5xno1ypvhla';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const variantSlug = process.env.PAYLOAD_VARIANT || 'fix-sid';
const OUT = path.join(
  __dirname,
  `../reports/preprod-mixed-fare-pr1505/onehit-user-payload-${variantSlug}.json`,
);

function cat(f) {
  const c = String(f?.fareCategory || f?.fareType || '').toUpperCase();
  if (!c) return null;
  if (c.includes('CORPORATE') || c === 'CORP') return 'CORPORATE';
  if (c.includes('SME')) return 'SME';
  if (c.includes('NORMAL') || c.includes('FLEXI') || c.includes('UPFRONT') || c.includes('STRETCH') || c.includes('PUBLISH')) {
    return 'NORMAL';
  }
  return c;
}

function summarize(options, direction) {
  const cats = new Set();
  const multi = [];
  const samples = [];
  for (const opt of options || []) {
    const fares = (opt.fares || []).map((f) => ({
      fareType: f.fareType,
      fareCategory: f.fareCategory,
      cat: cat(f),
      searchId: f.searchId,
    }));
    fares.forEach((f) => { if (f.cat) cats.add(f.cat); });
    const uniqueCats = [...new Set(fares.map((f) => f.cat).filter(Boolean))];
    if (uniqueCats.length >= 2) {
      multi.push({
        label: (opt.segments || []).map((s) => `${s.airline?.code || ''} ${s.flightNumber || ''}`.trim()).join('/'),
        cats: uniqueCats,
        fareTypes: fares.map((f) => f.fareType),
      });
    }
    if (samples.length < 5) {
      samples.push({
        direction,
        label: (opt.segments || []).map((s) => `${s.airline?.code || ''} ${s.flightNumber || ''}`.trim()).join('/'),
        from: opt.segments?.[0]?.departure?.airportCode,
        to: opt.segments?.[opt.segments.length - 1]?.arrival?.airportCode,
        cats: uniqueCats,
        fares,
      });
    }
  }
  return {
    n: (options || []).length,
    cats: [...cats].sort(),
    multiCategoryCards: multi.length,
    multiSamples: multi.slice(0, 5),
    samples,
  };
}

async function main() {
  clearSession();
  if (!/preprod/i.test(String(config.baseUrl))) {
    throw new Error(`Refuse non-preprod: ${config.baseUrl}`);
  }

  // User payload (one HTTP search only). VARIANT:
  //   raw | fix-sid | fix-filters | fix-faretype | minimal
  const variant = process.env.PAYLOAD_VARIANT || 'fix-sid';
  const body = {
    itinerary: [
      { origin: 'DEL', destination: 'BOM', date: '2026-11-22' },
      { origin: 'BOM', destination: 'DEL', date: '2026-11-26' },
    ],
    travellers: { adults: 1, children: 0, infants: 0 },
    cabinClass: 'ECONOMY',
    fareType: variant === 'fix-faretype' ? 'Normal, Corporate, SME' : 'NORMAL,CORPORATE,SME',
    journeyType: 'ROUND_TRIP',
    currency: 'INR',
    language: 'en',
    preferences: {
      airlines: [],
      maxStops: variant === 'minimal' ? null : 0,
      refundableOnly: false,
    },
    selection: {
      selectedSearchIds: variant === 'raw' ? [''] : [],
    },
  };
  if (variant === 'raw' || variant === 'fix-sid') {
    body.appliedFilters = { ONWARD: {}, RETURN: {} };
  } else if (variant !== 'minimal' && variant !== 'fix-filters') {
    body.appliedFilters = { ONWARD: {}, RETURN: {} };
  }
  // fix-filters / minimal / fix-faretype: omit empty appliedFilters objects

  console.log('=== ONE HIT user payload — no book / no poll loop ===');
  console.log('BASE', config.baseUrl, 'variant', variant);
  console.log('fareType', body.fareType);
  console.log('dates', body.itinerary.map((x) => x.date).join(' / '));
  console.log('selectedSearchIds', JSON.stringify(body.selection.selectedSearchIds));
  console.log('appliedFilters', body.appliedFilters ? JSON.stringify(body.appliedFilters) : '(omitted)');

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const flight = new FlightService(session.client);

  const res = await flight.search(body);
  const onward = collectOptions(res.data, 'ONWARD');
  const ret = collectOptions(res.data, 'RETURN');
  const onwardSum = summarize(onward, 'ONWARD');
  const returnSum = summarize(ret, 'RETURN');

  const allCats = [...new Set([...onwardSum.cats, ...returnSum.cats])].sort();
  const hasNormal = allCats.includes('NORMAL');
  const hasCorp = allCats.includes('CORPORATE');
  const hasSme = allCats.includes('SME');
  const mixedInventory = [hasNormal, hasCorp, hasSme].filter(Boolean).length >= 2;

  console.log('http', res.status, 'progress', res.data?.progress?.state, 'code', res.data?.error?.code || 'ok');
  console.log('onward', onwardSum.n, 'cats', onwardSum.cats.join(',') || '(none)', 'multiCards', onwardSum.multiCategoryCards);
  console.log('return', returnSum.n, 'cats', returnSum.cats.join(',') || '(none)', 'multiCards', returnSum.multiCategoryCards);
  console.log('mixed inventory (≥2 of N/C/S)?', mixedInventory, allCats);

  const out = {
    when: new Date().toISOString(),
    baseUrl: config.baseUrl,
    correlationId: session.client.correlationId,
    hit: 'single search HTTP — no poll, no pricing, no book',
    request: body,
    response: {
      http: res.status,
      code: res.data?.error?.code || null,
      error: res.data?.error || null,
      progress: res.data?.progress || null,
      resultDirections: (res.data?.results || []).map((r) => ({
        direction: r.direction,
        optionCount: (r.options || []).length,
      })),
    },
    onward: onwardSum,
    return: returnSum,
    verdict: {
      fareTypeSent: body.fareType,
      categoriesSeen: allCats,
      hasNORMAL: hasNormal,
      hasCORPORATE: hasCorp,
      hasSME: hasSme,
      mixedResults: mixedInventory,
      status: !res.ok
        ? 'BUG'
        : (mixedInventory ? 'PASS' : (onwardSum.n || returnSum.n ? 'PARTIAL' : 'NOT TESTED')),
      note: mixedInventory
        ? 'Response includes ≥2 of NORMAL/CORPORATE/SME'
        : 'Search accepted but inventory did not return multiple allowed fare categories on this single hit (progress may still be running — no poll per instruction)',
    },
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log('verdict', out.verdict.status, out.verdict.note);
  console.log('saved', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
