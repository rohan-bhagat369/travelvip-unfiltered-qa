/**
 * Compare Flights API docs payloads vs latest Postman collection.
 *   node scripts/compare-flight-docs-vs-postman.js
 */
import fs from 'fs';

const DOCS = process.env.DOCS
  || 'C:/Users/Rohan Bhagat/.cursor/projects/d-Travel-VIP-API-Automation/uploads/api-docs.travelvip.ai-0.md';
const PM = process.env.POSTMAN
  || 'c:/Users/Rohan Bhagat/Downloads/TravelVIP.postman.json';
const OUT = 'reports/flight-docs-vs-postman.json';

const docs = fs.readFileSync(DOCS, 'utf8');
const pm = JSON.parse(fs.readFileSync(PM, 'utf8'));

const flightStart = docs.indexOf('\n## Flights\n');
const hotelStart = docs.indexOf('\n## Hotels\n');
const flightDocs = docs.slice(flightStart, hotelStart > 0 ? hotelStart : undefined);

function extractJsonBlocks(text) {
  const blocks = [];
  const re = /```(?:json|JSON)?\s*\n([\s\S]*?)```/g;
  let x;
  while ((x = re.exec(text)) !== null) {
    const raw = x[1].trim();
    if (!raw.startsWith('{') && !raw.startsWith('[')) continue;
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      // ignore non-json fences
    }
  }
  return blocks;
}

function deepKeys(obj, prefix = '') {
  const keys = new Set();
  if (obj == null || typeof obj !== 'object') return keys;
  if (Array.isArray(obj)) {
    if (obj.length && typeof obj[0] === 'object' && obj[0] !== null) {
      for (const k of deepKeys(obj[0], `${prefix}[]`)) keys.add(k);
    } else if (prefix) keys.add(prefix);
    return keys;
  }
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    keys.add(p);
    if (v && typeof v === 'object') {
      for (const kk of deepKeys(v, p)) keys.add(kk);
    }
  }
  return keys;
}

function unionKeys(samples) {
  const u = new Set();
  for (const s of samples) {
    for (const k of deepKeys(s)) u.add(k);
  }
  return u;
}

function isLikelyRequestSample(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return false;
  if (b.statusMessage || b.requestStatus) return false;
  if (b.error && b.error.code) return false;
  if (b._meta && (b.status === 0 || b.data)) return false;
  // response-ish
  if (typeof b.status === 'number' && b.data && b.statusMessage == null && Object.keys(b).length <= 4) {
    // could be ambiguous; keep if looks like cancel action
  }
  return true;
}

function normalizePath(p) {
  return String(p || '')
    .replace(/\?.*$/, '')
    .replace(/BR\d+/g, '{bookingReference}')
    .replace(/\{\{[^}]+\}\}/g, '{var}')
    .replace(/\/[A-Z0-9]{5,8}(?=\/cancel)/, '/{bookingReference}')
    .replace(/\/status\/[^/]+$/, '/status/{bookingReference}')
    .replace(/\/details\/[^/]+$/, '/details/{bookingReference}')
    .replace(/\/history.*/, '/history')
    .replace(/\/cancel\/?$/, '/cancel');
}

function classifyPath(pathNorm) {
  const p = pathNorm.toLowerCase();
  if (p.includes('/airports')) return 'airports';
  if (p.includes('/airlines')) return 'airlines';
  if (p.includes('/citysearch')) return 'citySearch';
  if (p.includes('/search') && !p.includes('city')) return 'search';
  if (p.includes('/details') && !p.includes('booking')) return 'details';
  if (p.includes('/farerules')) return 'fareRules';
  if (p.includes('/pricing')) return 'pricing';
  if (p.includes('/ssr')) return 'ssr';
  if (p.includes('/seatmap') || p.includes('/seat-map')) return 'seatMap';
  if (p.includes('issue-ticket') || p.includes('issueticket')) return 'issueTicket';
  if (p.includes('/booking/') && p.includes('/status')) return 'bookingStatus';
  if (p.includes('/booking/') && p.includes('/details')) return 'bookingDetails';
  if (p.includes('/booking') && p.includes('history')) return 'bookingHistory';
  if (p.includes('/cancel')) return 'cancel';
  if (p.includes('/v2/flight/cancel')) return 'cancelV2';
  return 'other';
}

// Parse doc operations under ## Flights
const ops = [];
const opRe = /\n## ([^\n]+)\n([\s\S]*?)(?=\n## [^\n]+\n|$)/g;
let om;
while ((om = opRe.exec(flightDocs)) !== null) {
  const title = om[1].trim();
  const body = om[2];
  if (/Booking State|Rescheduling Flow|^Flights$/i.test(title)) continue;

  const urls = [...body.matchAll(/https:\/\/[^\s`"']+(\/(?:v1|api\/v2)\/flights[^\s`"']+)/g)]
    .map((r) => normalizePath(r[1]));
  const methodMatch = body.match(/\b(POST|GET|PUT|DELETE)\b/);
  const meth = methodMatch ? methodMatch[1] : (/^get/i.test(title) ? 'GET' : 'POST');

  const allBlocks = extractJsonBlocks(body);
  const reqSamples = allBlocks.filter(isLikelyRequestSample).filter((b) => {
    // Prefer bodies that look like inputs
    const keys = Object.keys(b);
    if (keys.includes('action') || keys.includes('tripType') || keys.includes('searchId')
      || keys.includes('searchIds') || keys.includes('priceId') || keys.includes('bookingContext')
      || keys.includes('data') || keys.includes('origin') || keys.includes('segments')
      || keys.includes('resultIndex') || keys.includes('traceId')) return true;
    if (keys.length <= 6 && !keys.includes('itinerary') && !keys.includes('flights')) return true;
    return false;
  });

  // Also capture schema field names from "propertyname required" style lines in markdown
  const schemaFields = new Set();
  const fieldRe = /^\|?\s*`?([a-zA-Z][a-zA-Z0-9_.]*)`?\s*(?:required|optional)?/gm;
  // Better: look for **field** or `field` in request body schema sections
  const schemaSection = body.match(/Request Body schema[\s\S]*?(?=### Responses|### Request samples|$)/i)?.[0] || '';
  const propRe = /(?:^|\n)\s*([a-zA-Z][a-zA-Z0-9]*)\s*\n\s*(?:required|optional)?/g;
  let pm2;
  while ((pm2 = propRe.exec(schemaSection)) !== null) {
    if (!/required|optional|string|number|boolean|object|array|integer/i.test(pm2[1])) {
      schemaFields.add(pm2[1]);
    }
  }
  // Redocly often formats as: fieldName\nrequired\n...
  const redocProps = [...schemaSection.matchAll(/\n([a-zA-Z][a-zA-Z0-9]*)\n(?:required|optional)/g)].map((x) => x[1]);
  for (const f of redocProps) schemaFields.add(f);

  const opKey = classifyPath(urls[0] || title);
  ops.push({
    title,
    opKey,
    method: meth,
    urls: [...new Set(urls)],
    reqSamples,
    sampleKeys: [...unionKeys(reqSamples)],
    schemaFields: [...schemaFields],
  });
}

function walk(items, folder = '', out = []) {
  for (const it of items || []) {
    if (it.item) walk(it.item, folder ? `${folder} / ${it.name}` : it.name, out);
    if (!it.request) continue;
    const req = it.request;
    const url = req.url;
    const raw = typeof url === 'string' ? url : (url?.raw || '');
    const pathJoined = Array.isArray(url?.path) ? `/${url.path.join('/')}` : '';
    const full = raw || pathJoined;
    const folderOrName = `${folder} ${it.name}`;
    if (!/flight/i.test(full) && !/flight/i.test(folderOrName)) continue;

    let body = null;
    const bodyRaw = req.body?.raw || '';
    if (bodyRaw) {
      try {
        const cleaned = bodyRaw
          .replace(/\{\{[^}]+\}\}/g, '"__VAR__"')
          .replace(/,\s*([}\]])/g, '$1');
        body = JSON.parse(cleaned);
      } catch {
        body = { __parseError: true, preview: bodyRaw.slice(0, 160) };
      }
    }

    const pathNorm = normalizePath(
      (full.match(/\/(?:v1|api\/v2)\/flights[^?\s]*/)?.[0]
        || full.match(/\/(?:v1|api\/v2)\/flight[^?\s]*/)?.[0]
        || pathJoined),
    );

    out.push({
      name: it.name,
      folder,
      method: (req.method || '').toUpperCase(),
      url: full,
      pathNorm,
      opKey: classifyPath(pathNorm || full),
      body,
      bodyKeys: body && !body.__parseError ? [...deepKeys(body)] : [],
      topKeys: body && !body.__parseError ? Object.keys(body) : [],
    });
  }
  return out;
}

const pmFlights = walk(pm.item);

// Aggregate Postman by opKey
const pmByOp = {};
for (const r of pmFlights) {
  if (!pmByOp[r.opKey]) pmByOp[r.opKey] = { requests: [], keys: new Set(), topKeys: new Set(), actions: new Set() };
  pmByOp[r.opKey].requests.push({
    name: r.name,
    folder: r.folder,
    method: r.method,
    pathNorm: r.pathNorm,
    topKeys: r.topKeys,
    body: r.body,
  });
  for (const k of r.bodyKeys) pmByOp[r.opKey].keys.add(k);
  for (const k of r.topKeys) pmByOp[r.opKey].topKeys.add(k);
  if (r.body?.action) pmByOp[r.opKey].actions.add(r.body.action);
}

const docByOp = {};
for (const o of ops) {
  if (!docByOp[o.opKey]) docByOp[o.opKey] = { titles: [], keys: new Set(), samples: [], urls: new Set() };
  docByOp[o.opKey].titles.push(o.title);
  for (const k of o.sampleKeys) docByOp[o.opKey].keys.add(k);
  for (const s of o.reqSamples) docByOp[o.opKey].samples.push(s);
  for (const u of o.urls) docByOp[o.opKey].urls.add(u);
}

const allOps = [...new Set([...Object.keys(docByOp), ...Object.keys(pmByOp)])].sort();

function topLevelOnly(keys) {
  return [...keys].filter((k) => !k.includes('.') && !k.includes('[]')).sort();
}

function notableNested(keys) {
  // focus on meaningful nested fields often missed
  const interesting = [
    'cancellationPaxList', 'cancellationReason', 'retryCount', 'pnr', 'action',
    'reschedulingReferenceId', 'reschedulingPnr', 'includeGst', 'gstDetails',
    'passengers', 'ssr', 'seat', 'bookingContext', 'priceId', 'searchIds',
    'data', 'tripType', 'fareType', 'maxStops', 'preferredAirlines',
  ];
  return interesting.filter((i) => [...keys].some((k) => k === i || k.endsWith(`.${i}`) || k.includes(`${i}.`) || k.includes(`[].${i}`) || k === `data.${i}` || k.endsWith(i)));
}

const comparisons = [];
for (const op of allOps) {
  const d = docByOp[op];
  const p = pmByOp[op];
  const docKeys = d ? d.keys : new Set();
  const pmKeys = p ? p.keys : new Set();
  const docTop = new Set(topLevelOnly(docKeys));
  const pmTop = new Set(topLevelOnly(pmKeys));

  const inPostmanNotDocs = [...pmTop].filter((k) => !docTop.has(k) && k !== '__VAR__').sort();
  const inDocsNotPostman = [...docTop].filter((k) => !pmTop.has(k)).sort();

  // Also deep notable fields
  const pmNotable = new Set(notableNested(pmKeys));
  const docNotable = new Set(notableNested(docKeys));
  // Check presence in sample JSON stringified for docs narrative fields
  const docBlob = JSON.stringify(d?.samples || []) + (d?.titles || []).join(' ');
  const pmBlob = JSON.stringify(p?.requests?.map((r) => r.body) || []);

  const notableInPmNotDocs = [...pmNotable].filter((f) => {
    if (docNotable.has(f)) return false;
    // also search docs keys deeply
    if ([...docKeys].some((k) => k === f || k.endsWith(`.${f}`) || k.includes(`.${f}.`))) return false;
    return !docBlob.includes(`"${f}"`);
  }).sort();

  const notableInDocsNotPm = [...docNotable].filter((f) => {
    if (pmNotable.has(f)) return false;
    if ([...pmKeys].some((k) => k === f || k.endsWith(`.${f}`) || k.includes(`.${f}.`))) return false;
    return !pmBlob.includes(`"${f}"`);
  }).sort();

  comparisons.push({
    op,
    inDocs: Boolean(d),
    inPostman: Boolean(p),
    docTitles: d?.titles || [],
    docUrls: d ? [...d.urls] : [],
    postmanCount: p?.requests?.length || 0,
    postmanExamples: (p?.requests || []).slice(0, 8).map((r) => ({
      name: r.name,
      path: r.pathNorm,
      topKeys: r.topKeys,
      action: r.body?.action,
    })),
    postmanActions: p ? [...p.actions].sort() : [],
    docTopKeys: [...docTop].sort(),
    postmanTopKeys: [...pmTop].sort(),
    topKeysInPostmanMissingFromDocs: inPostmanNotDocs,
    topKeysInDocsMissingFromPostman: inDocsNotPostman,
    notableInPostmanMissingFromDocs: notableInPmNotDocs,
    notableInDocsMissingFromPostman: notableInDocsNotPm,
    docSampleCount: d?.samples?.length || 0,
    docSamplesPreview: (d?.samples || []).slice(0, 2),
  });
}

// Special: cancel action coverage in docs text
const cancelDocText = flightDocs.match(/Cancel Flight Booking[\s\S]*?(?=\n## Hotels|\n## [A-Z]|$)/)?.[0] || '';
const cancelDocMentions = {
  PENALTY: /PENALTY/.test(cancelDocText),
  CANCEL: /\bCANCEL\b/.test(cancelDocText),
  PENALTY_AND_CANCEL: /PENALTY_AND_CANCEL/.test(cancelDocText),
  cancellationPaxList: /cancellationPaxList/.test(cancelDocText),
  cancellationReason: /cancellationReason/.test(cancelDocText),
  retryCount: /retryCount/.test(cancelDocText),
  pnr: /\bpnr\b/.test(cancelDocText),
  paxScope: /paxScope/.test(cancelDocText),
  PenaltyNotAvailable: /Penalty Not Available|PENALTY_NOT_AVAILABLE/.test(cancelDocText),
};

const issueDocText = flightDocs.match(/Issue Flight Ticket[\s\S]*?(?=\n## Fetch|\n## Get Flight Booking|\n## [A-Z]|$)/)?.[0] || '';
const issueDocMentions = {
  reschedulingReferenceId: /reschedulingReferenceId/.test(issueDocText) || /reschedulingReferenceId/.test(flightDocs),
  reschedulingPnr: /reschedulingPnr/.test(issueDocText) || /reschedulingPnr/.test(flightDocs),
  includeGst: /includeGst/.test(issueDocText),
  gstDetails: /gstDetails/.test(issueDocText),
  gstCompanyName: /gstCompanyName/.test(issueDocText),
  bookingContext: /bookingContext/.test(issueDocText),
  passengers: /passengers/.test(issueDocText),
  apiV2: /api\/v2\/flights\/booking\/issue-ticket/.test(flightDocs),
  v1Issue: /v1\/flights\/booking\/issue-ticket/.test(flightDocs),
};

// Endpoints only in one side
const docOpsSet = new Set(Object.keys(docByOp));
const pmOpsSet = new Set(Object.keys(pmByOp).filter((k) => k !== 'other'));
const endpointsOnlyInPostman = [...pmOpsSet].filter((k) => !docOpsSet.has(k));
const endpointsOnlyInDocs = [...docOpsSet].filter((k) => !pmOpsSet.has(k));

// Collect unique Postman cancel bodies
const cancelBodies = (pmByOp.cancel?.requests || [])
  .filter((r) => r.body && !r.body.__parseError)
  .map((r) => ({ name: r.name, body: r.body }));

const issueBodies = (pmByOp.issueTicket?.requests || [])
  .filter((r) => r.body && !r.body.__parseError)
  .map((r) => ({
    name: r.name,
    topKeys: Object.keys(r.body),
    dataKeys: r.body.data ? Object.keys(r.body.data) : [],
    hasReschedule: Boolean(r.body.reschedulingReferenceId || r.body.reschedulingPnr
      || r.body.data?.reschedulingReferenceId),
    hasGst: Boolean(r.body.data?.includeGst || r.body.data?.gstDetails || r.body.includeGst),
  }));

const summary = {
  comparedAt: new Date().toISOString(),
  sources: {
    apiDocs: DOCS,
    apiDocsUrl: 'https://api-docs.travelvip.ai/#tag/Flights',
    postman: PM,
    postmanModifiedHint: 'TravelVIP.postman.json from Downloads (latest)',
  },
  counts: {
    docOperations: ops.length,
    postmanFlightRequests: pmFlights.length,
    comparedOpGroups: comparisons.length,
  },
  endpointsOnlyInPostman,
  endpointsOnlyInDocs,
  cancelDocMentions,
  issueDocMentions,
  cancelBodiesUniqueActions: [...new Set(cancelBodies.map((c) => c.body.action).filter(Boolean))],
  cancelBodiesFieldUnion: [...unionKeys(cancelBodies.map((c) => c.body))].filter((k) => !k.includes('[]')).sort(),
  issueBodiesSummary: issueBodies.slice(0, 15),
  comparisons,
};

fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({
  counts: summary.counts,
  endpointsOnlyInPostman,
  endpointsOnlyInDocs,
  cancelDocMentions,
  issueDocMentions,
  cancelBodiesUniqueActions: summary.cancelBodiesUniqueActions,
  cancelBodiesFieldUnion: summary.cancelBodiesFieldUnion,
  gaps: comparisons.map((c) => ({
    op: c.op,
    inDocs: c.inDocs,
    inPostman: c.inPostman,
    missingInDocs: [...c.topKeysInPostmanMissingFromDocs, ...c.notableInPostmanMissingFromDocs],
    missingInPostman: [...c.topKeysInDocsMissingFromPostman, ...c.notableInDocsMissingFromPostman],
    postmanActions: c.postmanActions,
  })),
}, null, 2));
console.log('Wrote', OUT);
