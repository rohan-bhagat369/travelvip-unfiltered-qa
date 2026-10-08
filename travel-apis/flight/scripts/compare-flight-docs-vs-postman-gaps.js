/**
 * Deep payload field comparison: API docs Flights vs latest Postman (Downloads).
 */
import fs from 'fs';

const DOCS = 'C:/Users/Rohan Bhagat/.cursor/projects/d-Travel-VIP-API-Automation/uploads/api-docs.travelvip.ai-0.md';
const PM = 'c:/Users/Rohan Bhagat/Downloads/TravelVIP.postman.json';
const OUT = 'reports/flight-docs-vs-postman-gaps.json';

const docsFull = fs.readFileSync(DOCS, 'utf8');
const flightStart = docsFull.indexOf('\n## Flights\n');
const hotelStart = docsFull.indexOf('\n## Hotels\n');
const docs = docsFull.slice(flightStart, hotelStart);
const pm = JSON.parse(fs.readFileSync(PM, 'utf8'));

function deepKeys(obj, prefix = '') {
  const keys = new Set();
  if (obj == null || typeof obj !== 'object') return keys;
  if (Array.isArray(obj)) {
    if (obj.length && typeof obj[0] === 'object' && obj[0] !== null) {
      for (const k of deepKeys(obj[0], `${prefix}[]`)) keys.add(k);
    }
    return keys;
  }
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    keys.add(p);
    if (v && typeof v === 'object') for (const kk of deepKeys(v, p)) keys.add(kk);
  }
  return keys;
}

function parseBodiesFromItem(it) {
  const bodies = [];
  const raw = it.request?.body?.raw;
  if (raw) {
    try {
      bodies.push({
        source: 'active',
        body: JSON.parse(raw.replace(/\{\{[^}]+\}\}/g, '"__VAR__"')),
      });
    } catch { /* ignore */ }
  }
  for (const ex of it.response || []) {
    // saved example *requests* sometimes in originalRequest
    const oraw = ex.originalRequest?.body?.raw;
    if (oraw) {
      try {
        bodies.push({
          source: `example:${ex.name}`,
          body: JSON.parse(oraw.replace(/\{\{[^}]+\}\}/g, '"__VAR__"')),
        });
      } catch { /* ignore */ }
    }
  }
  return bodies;
}

function walk(items, folder = '', out = []) {
  for (const it of items || []) {
    if (it.item) walk(it.item, folder ? `${folder}/${it.name}` : it.name, out);
    if (!it.request) continue;
    const u = it.request.url;
    const full = typeof u === 'string' ? u : (u?.raw || (Array.isArray(u?.path) ? `/${u.path.join('/')}` : ''));
    if (!/flight/i.test(`${full} ${folder} ${it.name}`)) continue;
    out.push({
      name: it.name,
      folder,
      method: it.request.method,
      full,
      bodies: parseBodiesFromItem(it),
      exampleNames: (it.response || []).map((r) => r.name),
    });
  }
  return out;
}

const flights = walk(pm.item);

function findReq(namePart) {
  return flights.find((f) => f.name.toLowerCase().includes(namePart.toLowerCase()));
}

function keysUnion(bodies) {
  const u = new Set();
  for (const b of bodies) for (const k of deepKeys(b.body)) u.add(k);
  return [...u].sort();
}

// --- Doc-documented request fields (from schema + samples + prose) ---
const DOC_FIELDS = {
  search: {
    endpoint: 'POST /v1/flights/search',
    documented: [
      'itinerary', 'itinerary[].origin', 'itinerary[].destination', 'itinerary[].date',
      'travellers', 'travellers.adults', 'travellers.children', 'travellers.infants',
      'cabinClass', 'journeyType', 'fareType',
      'preferences', 'preferences.airlines', 'preferences.maxStops', 'preferences.refundableOnly',
      'appliedFilters', 'appliedFilters.ONWARD', 'selection', 'selection.selectedSearchIds',
      // query/context often also in body in Postman:
      'currency', 'language',
    ],
    notes: 'Docs sample includes itinerary/travellers/cabinClass/journeyType/fareType/preferences/appliedFilters/selection. currency/language appear in Postman body; docs mainly show them as query params on other endpoints.',
  },
  details: {
    endpoint: 'POST /v1/flights/details',
    documented: ['journeyType', 'selection', 'selection.selectedSearchIds'],
  },
  fareRules: {
    endpoint: 'POST /v1/flights/fareRules',
    documented: ['journeyType', 'selection'],
  },
  pricing: {
    endpoint: 'POST /v1/flights/pricing',
    documented: ['journeyType', 'selection'],
  },
  ssr: {
    endpoint: 'POST /v1/flights/ssr',
    documented: ['priceId'],
    notes: 'Docs request sample is typically priceId-only.',
  },
  seatMap: {
    endpoint: 'POST /v1/flights/seatmap',
    documented: ['currency', 'requestReference', 'passengers'],
  },
  issueTicket: {
    endpoint: 'POST /v1/flights/booking/issue-ticket',
    documented: [
      'type', 'currency', 'language', 'bookingReference', 'searchIds', 'journeyType', 'timezone',
      'reschedulingReferenceId', 'reschedulingPnr',
      'data', 'data.priceId', 'data.passportType', 'data.includeGst', 'data.gstDetails',
      'data.gstDetails.gstNumber', 'data.gstDetails.gstCompanyName', 'data.gstDetails.gstAddress',
      'data.gstDetails.gstEmailID', 'data.gstDetails.gstMobileNumber',
      'data.contact', 'data.contact.email', 'data.contact.mobile', 'data.contact.countryCode',
      'data.passengers', 'data.passengers[].paxId', 'data.passengers[].type', 'data.passengers[].isLead',
      'data.passengers[].profile', 'data.passengers[].city', 'data.passengers[].passport',
      'data.passengers[].ssr', 'data.passengers[].ssr.baggage', 'data.passengers[].ssr.meals', 'data.passengers[].ssr.seats',
    ],
  },
  cancel: {
    endpoint: 'POST /v1/flights/booking/{bookingId}/cancel',
    documented: [
      'action', 'pnr', 'cancellationPaxList', 'cancellationReason', 'remarks', 'cancelledBy',
    ],
    actionEnumDocs: ['PENALTY', 'CANCEL'],
    notes: 'Docs action enum is only PENALTY|CANCEL. Docs explicitly document cancellationPaxList, paxScope, Penalty Not Available.',
  },
};

const pmSearch = findReq('Flight Search');
const pmDetails = findReq('Flight Details');
const pmFare = findReq('Flight Fare Rules');
const pmPricing = findReq('Flight Pricing');
const pmSsr = findReq('Flight SSR');
const pmSeat = findReq('Flight SeatMap');
const pmIssue = findReq('Issue Flight Ticket');
const pmPenalty = findReq('Cancellation Penlty');
const pmCancel = findReq('Flight Cancellation');
const pmPac = findReq('Panalty Check');

function compare(op, docSpec, pmItem) {
  const pmKeys = new Set(keysUnion(pmItem?.bodies || []));
  const docKeys = new Set(docSpec.documented);
  const inPmNotDocs = [...pmKeys].filter((k) => {
    // top-level or exact
    const top = k.split('.')[0];
    if (docKeys.has(k) || docKeys.has(top)) return false;
    // if any doc key is prefix
    if ([...docKeys].some((d) => k === d || k.startsWith(`${d}.`) || k.startsWith(`${d}[]`))) return false;
    return true;
  }).filter((k) => !k.includes('__VAR__'));

  const inDocsNotPm = [...docKeys].filter((d) => {
    if ([...pmKeys].some((k) => k === d || k.startsWith(`${d}.`) || k.startsWith(`${d}[]`) || d.startsWith(`${k}.`))) return false;
    // check nested presence loosely
    const leaf = d.split('.').pop().replace('[]', '');
    if ([...pmKeys].some((k) => k === leaf || k.endsWith(`.${leaf}`) || k.endsWith(`[].${leaf}`))) return false;
    return true;
  });

  return {
    op,
    endpoint: docSpec.endpoint,
    postmanRequest: pmItem?.name || null,
    postmanActiveBody: pmItem?.bodies?.find((b) => b.source === 'active')?.body || null,
    postmanExampleBodies: (pmItem?.bodies || []).filter((b) => b.source !== 'active').map((b) => ({
      name: b.source,
      topKeys: Object.keys(b.body || {}),
      action: b.body?.action,
    })),
    savedExampleNames: pmItem?.exampleNames || [],
    postmanKeys: [...pmKeys].filter((k) => !k.includes('__')),
    inCollectionPayloadMissingFromDocs: inPmNotDocs.sort(),
    inDocsMissingFromCollectionPayload: inDocsNotPm.sort(),
    notes: docSpec.notes || null,
  };
}

const comparisons = [
  compare('search', DOC_FIELDS.search, pmSearch),
  compare('details', DOC_FIELDS.details, pmDetails),
  compare('fareRules', DOC_FIELDS.fareRules, pmFare),
  compare('pricing', DOC_FIELDS.pricing, pmPricing),
  compare('ssr', DOC_FIELDS.ssr, pmSsr),
  compare('seatMap', DOC_FIELDS.seatMap, pmSeat),
  compare('issueTicket', DOC_FIELDS.issueTicket, pmIssue),
  compare('cancel', DOC_FIELDS.cancel, {
    name: 'Cancel family',
    exampleNames: [
      ...(pmPenalty?.exampleNames || []),
      ...(pmCancel?.exampleNames || []),
      ...(pmPac?.exampleNames || []),
    ],
    bodies: [
      ...(pmPenalty?.bodies || []),
      ...(pmCancel?.bodies || []),
      ...(pmPac?.bodies || []),
    ],
  }),
];

// High-signal gaps (manual + automated)
const findings = [
  {
    direction: 'IN_COLLECTION_NOT_IN_DOCS',
    severity: 'HIGH',
    area: 'Cancel',
    item: 'action = PENALTY_AND_CANCEL',
    detail: 'Postman request "Panalty Check + Cancellation" sends action PENALTY_AND_CANCEL. API docs Cancel schema enum is only PENALTY | CANCEL — PENALTY_AND_CANCEL is not documented.',
    postman: pmPac?.bodies?.find((b) => b.source === 'active')?.body,
    docs: { actionEnum: ['PENALTY', 'CANCEL'] },
  },
  {
    direction: 'IN_DOCS_NOT_IN_COLLECTION',
    severity: 'MEDIUM',
    area: 'Cancel',
    item: 'cancellationReason, remarks, cancelledBy',
    detail: 'Docs Request Body schema lists cancellationReason, remarks, cancelledBy. Active Postman cancel/penalty bodies only send action + pnr (+ cancellationPaxList). None of the three optional fields appear in active collection payloads.',
    docsFields: ['cancellationReason', 'remarks', 'cancelledBy'],
    postmanActive: {
      penalty: pmPenalty?.bodies?.find((b) => b.source === 'active')?.body,
      cancel: pmCancel?.bodies?.find((b) => b.source === 'active')?.body,
      penaltyAndCancel: pmPac?.bodies?.find((b) => b.source === 'active')?.body,
    },
  },
  {
    direction: 'IN_DOCS_NOT_IN_COLLECTION',
    severity: 'MEDIUM',
    area: 'Issue Ticket',
    item: 'reschedulingReferenceId + reschedulingPnr',
    detail: 'Docs document rescheduling fields on issue-ticket. Active Postman Issue Flight Ticket body has no reschedulingReferenceId/reschedulingPnr example request.',
    postmanTopKeys: Object.keys(pmIssue?.bodies?.find((b) => b.source === 'active')?.body || {}),
  },
  {
    direction: 'IN_DOCS_NOT_IN_COLLECTION_ACTIVE',
    severity: 'LOW',
    area: 'Cancel request samples',
    item: 'Docs cancel samples vs Postman active',
    detail: 'Docs publish multiple cancel samples (PENALTY-only, CANCEL, PARTIAL_PAX, FULL_PAX, subset PENALTY declined). Postman has paxwise PENALTY/CANCEL bodies, but saved Postman *response* examples for RoundTrip/Oneway still show legacy envelope (requestStatus/items/totalPenalityAmount) which does not match current docs response shape (cancellationRequest + optional paxScope).',
  },
  {
    direction: 'IN_COLLECTION_EXAMPLES_STALE_VS_DOCS',
    severity: 'HIGH',
    area: 'Cancel responses',
    item: 'Legacy PENALTY/PENALTY_AND_CANCEL response examples',
    detail: 'Saved examples under Cancellation Penalty / Penalty+Cancel in Postman use old shape: requestStatus, data.action, data.items[], totalPenalityAmount. Current docs (and live staging) use status/statusMessage/data.cancellationRequest (+ paxScope). Collection examples are behind the API docs.',
  },
  {
    direction: 'PATH_ALIGNMENT',
    severity: 'INFO',
    area: 'Issue Ticket path',
    item: 'v1 vs api/v2',
    detail: 'Docs list POST /v1/flights/booking/issue-ticket. Postman active request also uses /v1/flights/booking/issue-ticket. Automation repo often prefers /api/v2/flights/booking/issue-ticket — v2 is not called out under Flights tag in this docs scrape.',
  },
  {
    direction: 'ALIGNED',
    severity: 'INFO',
    area: 'Cancel paxwise',
    item: 'cancellationPaxList',
    detail: 'Both docs and Postman include cancellationPaxList on PENALTY and CANCEL. Docs are more complete (validation rules, paxScope, Penalty Not Available).',
  },
  {
    direction: 'ALIGNED',
    severity: 'INFO',
    area: 'Search / details / pricing / fareRules / SSR / seatmap / GETs',
    item: 'Endpoint coverage',
    detail: 'All 14 Flights operations in docs have a matching Postman request under vgm/Flight (airports, airlines, search, details, fareRules, pricing, citySearch, ssr, seatmap, issue-ticket, status, details, cancel×3 variants, history).',
  },
];

// Issue ticket nested gap check
const issueBody = pmIssue?.bodies?.find((b) => b.source === 'active')?.body;
const issueKeys = [...deepKeys(issueBody || {})];
const issueMissingFromPm = DOC_FIELDS.issueTicket.documented.filter((d) => {
  const leaf = d.split('.').pop().replace('[]', '');
  return !issueKeys.some((k) => k === d || k.endsWith(`.${leaf}`) || k.includes(`[].${leaf}`) || k === leaf);
});

findings.push({
  direction: 'IN_DOCS_NOT_IN_COLLECTION',
  severity: issueMissingFromPm.length ? 'MEDIUM' : 'INFO',
  area: 'Issue Ticket nested fields',
  item: 'Fields documented but absent from active Postman issue body',
  missing: issueMissingFromPm,
  presentTop: issueBody ? Object.keys(issueBody) : [],
  presentData: issueBody?.data ? Object.keys(issueBody.data) : [],
});

// Search currency/language
const searchBody = pmSearch?.bodies?.find((b) => b.source === 'active')?.body;
findings.push({
  direction: 'IN_COLLECTION_AMBIGUOUS_IN_DOCS',
  severity: 'LOW',
  area: 'Search',
  item: 'currency + language in body',
  detail: 'Postman Flight Search sends currency and language in the JSON body. Docs request sample shows itinerary/travellers/cabinClass/journeyType/fareType/preferences/appliedFilters/selection — currency/language are not in that sample (often query params elsewhere). Clarify whether body fields are accepted.',
  postman: { currency: searchBody?.currency, language: searchBody?.language },
});

const report = {
  comparedAt: new Date().toISOString(),
  sources: {
    apiDocs: 'https://api-docs.travelvip.ai/#tag/Flights',
    docsFile: DOCS,
    postman: PM,
    postmanCollection: pm.info?.name,
  },
  inventory: flights.map((f) => ({
    name: f.name,
    method: f.method,
    path: f.full.match(/\/v\d\/flights[^?\s]*/)?.[0] || f.full,
    activeTopKeys: Object.keys(f.bodies.find((b) => b.source === 'active')?.body || {}),
    action: f.bodies.find((b) => b.source === 'active')?.body?.action,
    savedExamples: f.exampleNames,
  })),
  findings,
  comparisons,
  scorecard: {
    endpointsInBoth: 14,
    highGaps: findings.filter((f) => f.severity === 'HIGH').length,
    mediumGaps: findings.filter((f) => f.severity === 'MEDIUM').length,
    lowGaps: findings.filter((f) => f.severity === 'LOW').length,
  },
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ scorecard: report.scorecard, findings: findings.map((f) => ({ severity: f.severity, direction: f.direction, area: f.area, item: f.item, detail: f.detail, missing: f.missing })) }, null, 2));
console.log('Wrote', OUT);
