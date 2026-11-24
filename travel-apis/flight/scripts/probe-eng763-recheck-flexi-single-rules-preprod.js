/**
 * Recheck carefully:
 * 1) IndiGo fareType exactly "Flexi" (not Alliance Flexible) + CORPORATE/SME/NORMAL
 * 2) Single-id fareRules — dump exact body + try ROUND_TRIP / ONE_WAY / kebab path
 * Same dates. No book.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import { collectOptions } from '../src/searchPicker.js';
import { sleep } from '../../../shared/lib/testUtils.js';

process.env.ALLOW_BOOK = 'false';
process.env.BASE_URL = process.env.BASE_URL || 'https://preprod-api.travelvip.ai';
process.env.PARTNER_ID = process.env.PARTNER_ID || 'vgm';
process.env.PARTNER_SECRET = process.env.PARTNER_SECRET || 'vgm_preprod_ojny1swtigd4as';
process.env.TIER_ID = process.env.TIER_ID || '19597201';
process.env.SIGNING_KEY = process.env.SIGNING_KEY || 'sk_live_yg81bca5xno1ypvhla';

const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../reports/preprod-mixed-fare-pr1505/recheck-flexi-single-farerules.json',
);

function fareCat(f) {
  return String(f?.fareCategory || '').toUpperCase();
}

function label(opt) {
  return (opt?.segments || [])
    .map((s) => `${s.airline?.code || ''} ${s.flightNumber || ''}`.trim())
    .join('/');
}

function stops(opt) {
  return opt?.totalStops ?? ((opt?.segments?.length || 1) - 1);
}

function pickExactFareType(opts, fareTypeName, { maxStops = null, airline = null } = {}) {
  const want = String(fareTypeName);
  for (const opt of opts || []) {
    if (maxStops != null && stops(opt) > maxStops) continue;
    if (airline && String(opt.segments?.[0]?.airline?.code || '').toUpperCase() !== airline) continue;
    for (const f of opt.fares || []) {
      if (String(f.fareType || '') === want && f.searchId) {
        return {
          searchId: f.searchId,
          fareType: f.fareType,
          fareCategory: f.fareCategory,
          label: label(opt),
          airline: opt.segments?.[0]?.airline?.code,
          stops: stops(opt),
        };
      }
    }
  }
  return null;
}

function pickCat(opts, cat, { maxStops = null, excludeFareType = null } = {}) {
  for (const opt of opts || []) {
    if (maxStops != null && stops(opt) > maxStops) continue;
    for (const f of opt.fares || []) {
      if (excludeFareType && String(f.fareType || '') === excludeFareType) continue;
      if (fareCat(f) === cat && f.searchId) {
        return {
          searchId: f.searchId,
          fareType: f.fareType,
          fareCategory: f.fareCategory,
          label: label(opt),
          airline: opt.segments?.[0]?.airline?.code,
          stops: stops(opt),
        };
      }
    }
  }
  return null;
}

clearSession();
const session = await authenticate(true);
session.client.setPartnerKey(session.accessToken);
const flight = new FlightService(session.client);
const client = session.client;

const body = {
  itinerary: [
    { origin: 'DEL', destination: 'BOM', date: '2026-11-22' },
    { origin: 'BOM', destination: 'DEL', date: '2026-11-24' },
  ],
  travellers: { adults: 1, children: 0, infants: 0 },
  cabinClass: 'ECONOMY',
  journeyType: 'ROUND_TRIP',
  currency: 'INR',
  language: 'en',
  preferences: { airlines: [], maxStops: 0, refundableOnly: false },
  appliedFilters: {},
  selection: { selectedSearchIds: [] },
  fareType: 'NORMAL, CORPORATE, SME',
};

console.log('=== RECHECK Flexi + single fareRules ===');
const search = await flight.search(body);
const onward = collectOptions(search.data, 'ONWARD');
const ret = collectOptions(search.data, 'RETURN');
console.log('search', search.status, search.data?.progress?.state, onward.length, ret.length);

// Prefer nonstop IndiGo Flexi on RETURN
const flexiRet = pickExactFareType(ret, 'Flexi', { maxStops: 0 })
  || pickExactFareType(ret, 'Flexi')
  || pickExactFareType(onward, 'Flexi', { maxStops: 0 });

const corpOn = pickCat(onward, 'CORPORATE', { maxStops: 0 });
const smeOn = pickCat(onward, 'SME', { maxStops: 0, excludeFareType: 'Flexi' });
const normalOn = pickCat(onward, 'NORMAL', { maxStops: 0, excludeFareType: 'Flexi' });

// Same-card style: NORMAL (not Flexi) onward 6E + Flexi return 6E
const normal6eOn = pickExactFareType(onward, 'Normal', { maxStops: 0, airline: '6E' })
  || pickCat(onward, 'NORMAL', { maxStops: 0, excludeFareType: 'Flexi' });

const out = {
  when: new Date().toISOString(),
  correlationId: client.correlationId,
  picks: { corpOn, smeOn, normalOn, normal6eOn, flexiRet },
  cases: [],
};

async function pricePair(tag, a, b) {
  if (!a || !b || a.searchId === b.searchId) {
    out.cases.push({ tag, status: 'NOT TESTED', reason: 'missing ids' });
    console.log(tag, 'NOT TESTED missing');
    return;
  }
  await sleep(2500);
  const reqBody = {
    journeyType: 'ROUND_TRIP',
    selection: { selectedSearchIds: [a.searchId, b.searchId] },
  };
  const details = await flight.getDetails([a.searchId, b.searchId], 'ROUND_TRIP');
  const pricing = await flight.getPricing([a.searchId, b.searchId], 'ROUND_TRIP');
  const caseRow = {
    tag,
    request: reqBody,
    onward: a,
    return: b,
    details: {
      http: details.status,
      code: details.data?.error?.code || null,
      error: details.data?.error || null,
      fareType: details.data?.fareType || null,
      mixedFareType: details.data?.mixedFareType ?? null,
    },
    pricing: {
      http: pricing.status,
      code: pricing.data?.error?.code || null,
      priceId: pricing.data?.priceId || null,
      fareType: pricing.data?.fareType || null,
      mixedFareType: pricing.data?.mixedFareType ?? null,
      error: pricing.data?.error || null,
    },
  };
  const blocked = caseRow.details.code === 'INVALID_COMBINATION' || caseRow.pricing.code === 'INVALID_COMBINATION';
  const accepted = caseRow.pricing.http === 200 && caseRow.pricing.priceId;
  caseRow.verdict = blocked ? 'PASS (blocked)' : (accepted ? 'BUG (accepted)' : `OTHER ${caseRow.pricing.code || caseRow.details.code}`);
  out.cases.push(caseRow);
  console.log(tag, caseRow.verdict, a.fareType, a.label, '+', b.fareType, b.label,
    `d=${details.status}/${caseRow.details.code || 'ok'} p=${pricing.status}/${caseRow.pricing.code || caseRow.pricing.priceId}`);
}

// Case A: CORPORATE + IndiGo Flexi (exact fareType)
await pricePair('A-CORP+IndigoFlexi', corpOn, flexiRet);
// Case B: NORMAL (non-Flexi) + IndiGo Flexi
await pricePair('B-NORMAL+IndigoFlexi', normal6eOn || normalOn, flexiRet);
// Case C: SME + IndiGo Flexi
await pricePair('C-SME+IndigoFlexi', smeOn, flexiRet);

// Single-id fareRules variants
const singleId = corpOn?.searchId || normalOn?.searchId;
out.fareRulesVariants = [];

async function rulesVariant(tag, pathName, bodyObj) {
  await sleep(1500);
  const res = await client.request({
    method: 'POST',
    path: pathName,
    query: { lang: 'en', currency: 'INR' },
    body: bodyObj,
    correlation: true,
  });
  const entries = res.data?.fareRules || res.data?.rules || [];
  const row = {
    tag,
    path: pathName,
    request: bodyObj,
    http: res.status,
    code: res.data?.error?.code || null,
    message: res.data?.error?.message || null,
    details: res.data?.error?.details || null,
    fareType: res.data?.fareType || null,
    entryCount: Array.isArray(entries) ? entries.length : null,
    titles: Array.isArray(entries) ? entries.map((e) => e.title) : [],
  };
  out.fareRulesVariants.push(row);
  console.log(tag, pathName, res.status, row.code || `entries=${row.entryCount}`, JSON.stringify(row.details || row.titles));
}

if (singleId) {
  const baseSel = { selectedSearchIds: [singleId] };
  await rulesVariant('R1-camel-RT-1id', '/v1/flights/fareRules', {
    journeyType: 'ROUND_TRIP',
    selection: baseSel,
  });
  await rulesVariant('R2-camel-OW-1id', '/v1/flights/fareRules', {
    journeyType: 'ONE_WAY',
    selection: baseSel,
  });
  await rulesVariant('R3-kebab-RT-1id', '/v1/flights/fare-rules', {
    journeyType: 'ROUND_TRIP',
    selection: baseSel,
  });
  await rulesVariant('R4-camel-RT-2id-control', '/v1/flights/fareRules', {
    journeyType: 'ROUND_TRIP',
    selection: {
      selectedSearchIds: [corpOn?.searchId || singleId, flexiRet?.searchId || normalOn?.searchId].filter(Boolean).slice(0, 2),
    },
  });
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log('saved', OUT);
