/**
 * Build a dynamic, scenario-based Postman collection for:
 * - Flight: OW/RT, connecting selection, multipax, SSR seat+meal+baggage for one OW and one RT,
 *   and paxwise cancellation (PENALTY + CANCEL via v1 and v2).
 * - Hotel: basic booking flow with multipax guests (optional; used for "hotel + flight" handoff).
 * - Cab: AIRPORT DEPARTURE/ARRIVAL, OUTSTATION, RENTAL — search → fare → finalize → status → detail → history → cancel.
 *
 * Output:
 *  - postman/TravelVIP-Dynamic-Flights.postman_collection.json
 *  - postman/TravelVIP-Dynamic-Flights-Hotels.postman_collection.json (includes cabs)
 *  - postman/TravelVIP-Dynamic-Cabs.postman_collection.json (cab-only)
 *
 * No external dependencies (only node + fs).
 */
import fs from 'fs';

const ROOT = 'd:\\Travel VIP API Automation';
const OUT_FLIGHTS = `${ROOT}\\postman\\TravelVIP-Dynamic-Flights.postman_collection.json`;
const OUT_FLIGHTS_HOTELS = `${ROOT}\\postman\\TravelVIP-Dynamic-Flights-Hotels.postman_collection.json`;
const OUT_CABS = `${ROOT}\\postman\\TravelVIP-Dynamic-Cabs.postman_collection.json`;

const BASE_URL_DEFAULT = 'https://api-staging.travelvip.ai';

// Same GST block as src/hotel/regression/fixtures.js and src/flight/bookEngine.js
const VALID_GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

// Keep query shapes aligned with src/*/service.js so these requests are copy/paste runnable.
const FLIGHT_QUERY = [
  { key: 'lang', value: 'en' },
  { key: 'currency', value: 'INR' },
];

const FLIGHT_SEARCH_QUERY = [
  ...FLIGHT_QUERY,
  { key: 'page', value: '0' },
  { key: 'perpage', value: '20' },
  { key: 'sortby', value: 'fare,asc' },
];

const FLIGHT_BOOKING_HISTORY_QUERY = [
  { key: 'lang', value: 'en' },
  { key: 'currency', value: 'INR' },
  { key: 'page', value: '1' },
  { key: 'perpage', value: '10' },
  { key: 'status', value: 'Confirmed' },
];

const FLIGHT_ISSUE_TICKET_V2_QUERY = [
  { key: 'pid', value: 'vgm' },
  { key: 'clientCode', value: 'default-smt' },
  { key: 'platform', value: 'web' },
  ...FLIGHT_QUERY,
  { key: 'count', value: '10' },
  { key: 'page', value: '0' },
  { key: 'perpage', value: '20' },
];

const HOTEL_QUERY = [
  { key: 'lang', value: 'en' },
  { key: 'currency', value: 'INR' },
];

const HOTEL_SEARCH_QUERY = [
  ...HOTEL_QUERY,
  { key: 'pid', value: 'vgm' },
  { key: 'page', value: '0' },
  { key: 'perpage', value: '20' },
];

const HOTEL_FINALIZE_QUERY = HOTEL_SEARCH_QUERY;

const HOTEL_PREBOOK_QUERY = HOTEL_QUERY;

const HOTEL_BOOKING_HISTORY_QUERY = [
  ...HOTEL_QUERY,
  { key: 'page', value: '0' },
  { key: 'perpage', value: '10' },
];

const CAB_QUERY = [
  { key: 'lang', value: 'en' },
  { key: 'currency', value: 'INR' },
];

const CAB_HISTORY_QUERY = [
  ...CAB_QUERY,
  { key: 'page', value: '0' },
  { key: 'perpage', value: '10' },
];

function cabPickupDatetime(daysFromNow = 9) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  d.setUTCHours(18, 35, 58, 0);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function cabSearchBody({ journeyType, travelType = 'DEPARTURE' }) {
  const pickupDatetime = cabPickupDatetime(9);
  if (journeyType === 'AIRPORT' && travelType === 'ARRIVAL') {
    return {
      journeyType: 'AIRPORT',
      travelType: 'ARRIVAL',
      airportCode: 'DEL',
      pickup: { name: 'IGI Airport-T1', city: 'Delhi', latitude: 28.5588, longitude: 77.0814 },
      drop: { name: 'Vasant Kunj, Delhi', city: 'Delhi', latitude: 28.5201, longitude: 77.1591 },
      distanceKm: 15,
      durationMin: 15,
      pickupDatetime,
    };
  }
  if (journeyType === 'AIRPORT') {
    return {
      journeyType: 'AIRPORT',
      travelType: 'DEPARTURE',
      airportCode: 'DEL',
      pickup: { name: 'Vasant Kunj, Delhi', city: 'Delhi', latitude: 28.5201, longitude: 77.1591 },
      drop: { name: 'IGI Airport-T1', city: 'Delhi', latitude: 28.5588, longitude: 77.0814 },
      distanceKm: 15,
      durationMin: 15,
      pickupDatetime,
    };
  }
  if (journeyType === 'OUTSTATION') {
    return {
      journeyType: 'OUTSTATION',
      travelType: 'DEPARTURE',
      pickup: { name: 'Keshav Nagar, Pune', city: 'Pune', latitude: 18.5518, longitude: 73.9467 },
      drop: { name: 'Viman Nagar, Pune', city: 'Pune', latitude: 18.5679, longitude: 73.9143 },
      distanceKm: 8,
      durationMin: 25,
      pickupDatetime,
    };
  }
  return {
    journeyType: 'RENTAL',
    travelType: 'DEPARTURE',
    pickup: { name: 'Keshav Nagar, Pune', city: 'Pune', latitude: 18.5518, longitude: 73.9467 },
    drop: { name: 'Keshav Nagar, Pune', city: 'Pune', latitude: 18.5518, longitude: 73.9467 },
    distanceKm: 20,
    durationMin: 120,
    pickupDatetime,
  };
}

function cabFinalizeBody() {
  return {
    bookingReference: '{{cab_fare_booking_reference}}',
    priceId: '{{cab_price_id}}',
    passengers: [
      {
        paxId: 1,
        paxType: 'ADT',
        isLead: true,
        profile: {
          title: 'Mr',
          firstName: 'Pratik',
          lastName: 'Patil',
          gender: 'male',
          dob: '1990-01-02',
          nationality: 'IN',
        },
      },
    ],
    contact: {
      email: '{{cab_contact_email}}',
      countryCode: '+91',
      mobile: '9921862715',
    },
    otherDetails: 'Postman dynamic cab scenario — please cancel if live',
  };
}

// HMAC-SHA256(resolvedBody + timestamp). Must resolve {{vars}} and write the body back
// so Postman sends the same bytes that were signed (otherwise Details returns INVALID_SIGNATURE).
function signingEvent() {
  return [
    {
      listen: 'prerequest',
      script: {
        type: 'text/javascript',
        exec: [
          'const timestamp = Math.floor(Date.now() / 1000).toString();',
          'let body = "";',
          'if (pm.request.body && pm.request.body.mode === "raw" && pm.request.body.raw) {',
          '  body = String(pm.request.body.raw);',
          '}',
          'body = pm.variables.replaceIn(body);',
          'if (pm.request.url && String(pm.request.url.getPath ? pm.request.url.getPath() : pm.request.url).includes("issue-ticket")) {',
          '  try {',
          '    const parsed = JSON.parse(body);',
          '    const lead = parsed && parsed.data && Array.isArray(parsed.data.passengers) ? parsed.data.passengers.find(function (p) { return p.isLead; }) : null;',
          '    if (lead && lead.ssr) {',
          '      const empty = function (v) { return !v || String(v).indexOf("{{") !== -1; };',
          '      if (!lead.ssr.meals || !lead.ssr.meals.length || empty(lead.ssr.meals[0] && (lead.ssr.meals[0].ssrId || lead.ssr.meals[0].mealId))) lead.ssr.meals = [];',
          '      if (!lead.ssr.baggage || !lead.ssr.baggage.length || empty(lead.ssr.baggage[0] && (lead.ssr.baggage[0].ssrId || lead.ssr.baggage[0].baggageId))) lead.ssr.baggage = [];',
          '      if (!lead.ssr.seats || !lead.ssr.seats.length || empty(lead.ssr.seats[0] && lead.ssr.seats[0].seatId)) lead.ssr.seats = [];',
          '    }',
          '    body = JSON.stringify(parsed, null, 2) + "\\n";',
          '  } catch (e) {}',
          '}',
          'if (pm.request.body && pm.request.body.mode === "raw") {',
          '  pm.request.body.raw = body;',
          '}',
          'const signingKey = pm.environment.get("signing_key") || pm.collectionVariables.get("signing_key") || pm.variables.get("signing_key") || "";',
          'const signature = CryptoJS.HmacSHA256(body + timestamp, signingKey).toString(CryptoJS.enc.Hex);',
          'pm.environment.set("timestamp", timestamp);',
          'pm.environment.set("signature", signature);',
          'pm.variables.set("request_id", "req-" + Date.now());',
        ],
      },
    },
  ];
}

function correlationTestScript() {
  return [
    'const response = pm.response.json();',
    'if (response._meta && response._meta.correlation_id) {',
    '  pm.environment.set("correlation_id", response._meta.correlation_id);',
    '}',
  ];
}

function headers({ partnerKey = false, contentType = false } = {}) {
  const h = [
    { key: 'Authorization', value: 'Bearer {{auth_token}}' },
    { key: 'X-Request-Id', value: '{{request_id}}' },
    { key: 'X-Timestamp', value: '{{timestamp}}' },
    { key: 'X-Signature', value: '{{signature}}' },
    { key: 'X-Correlation-ID', value: '{{correlation_id}}' },
  ];
  if (partnerKey) h.push({ key: 'X-Partner-Key', value: '{{access_token}}' });
  if (contentType) h.push({ key: 'Content-Type', value: 'application/json' });
  return h;
}

function url(pathParts, query = []) {
  const qs = query
    .filter((q) => q && q.key)
    .map((q) => `${encodeURIComponent(q.key)}=${encodeURIComponent(q.value)}`)
    .join('&');
  return {
    raw: `{{base_url}}/${pathParts.join('/')}${qs ? `?${qs}` : ''}`,
    host: ['{{base_url}}'],
    path: pathParts,
    query,
  };
}

function assertHttpTest(okJsExpr, title = 'HTTP ok for this hop') {
  return [
    `pm.test(${JSON.stringify(title)}, function () {`,
    '  let j = {};',
    '  try { j = pm.response.json(); } catch (e) { j = {}; }',
    '  const errCode = j && j.error ? j.error.code : null;',
    `  pm.expect(Boolean(${okJsExpr}), "status=" + pm.response.code + " code=" + errCode).to.be.true;`,
    '});',
  ];
}

function req({
  name,
  method = 'POST',
  pathParts,
  query = [],
  headersExtra = [],
  body,
  rawBody,
  description = '',
  testScript = null,
  partnerKey = false,
  saveCorrelation = true,
  disabled = false,
}) {
  const item = {
    name,
    event: signingEvent(),
    request: {
      auth: { type: 'noauth' },
      method,
      header: [...headers({ partnerKey, contentType: Boolean(body != null || rawBody) }), ...headersExtra],
      url: url(pathParts, query),
      description,
    },
    response: [],
  };
  if (disabled) item.disabled = true;

  if (rawBody != null) {
    item.request.body = {
      mode: 'raw',
      raw: rawBody,
      options: { raw: { language: 'json' } },
    };
  } else if (body != null) {
    item.request.body = {
      mode: 'raw',
      raw: `${JSON.stringify(body, null, 2)}\n`,
      options: { raw: { language: 'json' } },
    };
  }

  const tests = [];
  if (saveCorrelation) tests.push(...correlationTestScript());
  if (testScript) tests.push(...testScript);

  if (tests.length) {
    item.event.push({
      listen: 'test',
      script: { type: 'text/javascript', exec: tests },
    });
  }

  return item;
}

function reqAuth({
  name,
  method = 'POST',
  pathParts,
  query = [],
  body,
  rawBody,
  description = '',
  headersExtra = [],
  testScript = null,
  withRequestIdPreScript = true,
}) {
  const item = {
    name,
    event: withRequestIdPreScript ? [{
      listen: 'prerequest',
      script: {
        type: 'text/javascript',
        exec: ['pm.variables.set("request_id", "req-" + Date.now());'],
      },
    }] : [],
    request: {
      auth: { type: 'noauth' },
      method,
      header: [
        { key: 'Content-Type', value: 'application/json' },
        { key: 'X-Request-Id', value: '{{request_id}}' },
        ...headersExtra,
      ],
      url: url(pathParts, query),
      description: description || '',
    },
    response: [],
  };

  if (rawBody != null) {
    item.request.body = {
      mode: 'raw',
      raw: rawBody,
      options: { raw: { language: 'json' } },
    };
  } else if (body != null) {
    item.request.body = {
      mode: 'raw',
      raw: `${JSON.stringify(body, null, 2)}\n`,
      options: { raw: { language: 'json' } },
    };
  }

  if (testScript) {
    item.event.push({
      listen: 'test',
      script: { type: 'text/javascript', exec: testScript },
    });
  }

  return item;
}

function setEnvVarFromResponseTestScript({ mappings = {}, root = 'd' }) {
  const assigns = Object.entries(mappings).map(([k, expr]) => {
    const safe = expr.replace(/"/g, '\\"');
    return [
      `try {`,
      `  const v = (${safe});`,
      '  if (v !== undefined && v !== null && v !== "") {',
      `    pm.environment.set("${k}", String(v));`,
      `    pm.collectionVariables.set("${k}", String(v));`,
      '  }',
      '} catch(e) { /* ignore */ }',
    ].join('\n');
  });

  return [
    'let j = {};',
    'try { j = pm.response.json(); } catch(e) { j = {}; }',
    `const ${root} = j?.data || j || {};`,
    ...assigns,
  ];
}

function extractSearchIdsTestScript({ connectingOnly, journeyType, requireReturn = false }) {
  // journeyType: ONE_WAY or ROUND_TRIP
  return [
    'let j = {};',
    'try { j = pm.response.json(); } catch(e) { j = {}; }',
    'const results = j?.data?.results || j?.results || [];',
    'function pickFirstSearchIdInOptions(opts) {',
    '  for (const o of (opts || [])) {',
    '    if (o && o.searchId) return String(o.searchId);',
    '  }',
    '  return null;',
    '}',
    'function isConnectingOption(o) {',
    '  const stops = o?.totalStops ?? 0;',
    '  const segCount = o?.segments?.length ?? 0;',
    '  return Number(stops) > 0 || Number(segCount) > 1;',
    '}',
    'function pickSearchIdByDirection(dir) {',
    '  const block = (results || []).find((r) => String(r?.direction || "").toUpperCase() === String(dir).toUpperCase());',
    '  const options = block?.options || [];',
    '  if (!connectingOnly) return pickFirstSearchIdInOptions(options);',
    '  for (const o of options) {',
    '    if (isConnectingOption(o) && o?.searchId) return String(o.searchId);',
    '  }',
    '  // fallback to first even if not connecting',
    '  return pickFirstSearchIdInOptions(options);',
    '}',
    '',
    `const JOURNEY_TYPE = '${journeyType}';`,
    `const connectingOnly = ${connectingOnly ? 'true' : 'false'};`,
    '',
    'const onward = pickSearchIdByDirection("ONWARD");',
    'const ret = pickSearchIdByDirection("RETURN");',
    'const firstFound = onward || ret || null;',
    '',
    'console.log("Search progress:", (j && j.progress && j.progress.state) || "UNKNOWN", "onward:", onward, "return:", ret);',
    '',
    'if (JOURNEY_TYPE === "ONE_WAY") {',
    '  if (firstFound) { pm.environment.set("flight_search_id", firstFound); pm.collectionVariables.set("flight_search_id", firstFound); console.log("Saved flight_search_id:", firstFound); }',
    '}',
    '',
    'if (JOURNEY_TYPE === "ROUND_TRIP") {',
    '  if (onward) { pm.environment.set("flight_onward_search_id", onward); pm.collectionVariables.set("flight_onward_search_id", onward); }',
    '  if (ret) { pm.environment.set("flight_return_search_id", ret); pm.collectionVariables.set("flight_return_search_id", ret); }',
    '  if (onward || ret) { const sid = onward || ret; pm.environment.set("flight_search_id", sid); pm.collectionVariables.set("flight_search_id", sid); }',
    '}',
    '',
    `const requireReturn = ${requireReturn ? 'true' : 'false'};`,
    'const needIds = JOURNEY_TYPE === "ROUND_TRIP"',
    '  ? (requireReturn ? Boolean(onward && ret) : Boolean(onward))',
    '  : Boolean(firstFound);',
    'const pollN = Number(pm.variables.get("search_poll_n") || 0);',
    'if (!needIds && pollN < 10) {',
    '  pm.variables.set("search_poll_n", String(pollN + 1));',
    '  const waitMs = Math.min(Number((j && j.progress && j.progress.pollAfterMs) || 3500), 4500);',
    '  const until = Date.now() + waitMs;',
    '  while (Date.now() < until) {}',
    '  postman.setNextRequest(pm.info.requestName);',
    '} else {',
    '  pm.variables.set("search_poll_n", "0");',
    '}',
    '',
    'pm.test("Search returned HTTP 200", function () { pm.expect(pm.response.code).to.equal(200); });',
    'pm.test("Search saved a searchId (re-send if this fails)", function () {',
    '  if (JOURNEY_TYPE === "ROUND_TRIP" && requireReturn) {',
    '    pm.expect(pm.environment.get("flight_return_search_id") || pm.collectionVariables.get("flight_return_search_id"), "return searchId").to.be.ok;',
    '  } else if (JOURNEY_TYPE === "ROUND_TRIP") {',
    '    pm.expect(pm.environment.get("flight_onward_search_id") || pm.collectionVariables.get("flight_onward_search_id"), "onward searchId").to.be.ok;',
    '  } else {',
    '    pm.expect(pm.environment.get("flight_search_id") || pm.collectionVariables.get("flight_search_id"), "flight_search_id").to.be.ok;',
    '  }',
    '});',
  ];
}

function saveVar(name, expr) {
  return `try { const v = (${expr}); if (v !== undefined && v !== null && v !== "" && v !== false && v !== true) { pm.environment.set("${name}", String(v)); pm.collectionVariables.set("${name}", String(v)); } } catch(e) {}`;
}

// Real airline PNR lives on bookingResponse.itinerary[].pnr after Confirmed.
// RT domestic usually has two legs → save flight_pnr_onward + flight_pnr_return.
// flight_pnr stays as onward (or first) for OW / single-PNR cancel paths.
function extractPnrScriptLines() {
  return [
    'function pickPnrValue(v) {',
    '  if (v === undefined || v === null || v === false || v === true) return null;',
    '  const s = String(v).trim();',
    '  if (!s || s === "false" || s === "true" || s === "null" || s === "undefined") return null;',
    '  return s;',
    '}',
    'function itineraryLegs(root) {',
    '  const d = (root && root.data) || root || {};',
    '  const br = d.bookingResponse || d.booking || {};',
    '  if (Array.isArray(br.itinerary) && br.itinerary.length) return br.itinerary;',
    '  if (Array.isArray(d.itinerary) && d.itinerary.length) return d.itinerary;',
    '  if (root && Array.isArray(root.itinerary) && root.itinerary.length) return root.itinerary;',
    '  return [];',
    '}',
    'function savePnrVar(name, value) {',
    '  if (!value) return;',
    '  pm.environment.set(name, value);',
    '  pm.collectionVariables.set(name, value);',
    '}',
    'const legs = itineraryLegs(j);',
    'let onwardPnr = null;',
    'let returnPnr = null;',
    'for (let i = 0; i < legs.length; i += 1) {',
    '  const leg = legs[i] || {};',
    '  const dir = String(leg.direction || "").toUpperCase();',
    '  const p = pickPnrValue(leg.pnr || leg.airlinePnr || leg.airline_pnr);',
    '  if (!p) continue;',
    '  if (dir.indexOf("RETURN") !== -1 || dir.indexOf("INBOUND") !== -1) {',
    '    if (!returnPnr) returnPnr = p;',
    '  } else if (dir.indexOf("ONWARD") !== -1 || dir.indexOf("OUTBOUND") !== -1) {',
    '    if (!onwardPnr) onwardPnr = p;',
    '  } else if (!onwardPnr) {',
    '    onwardPnr = p;',
    '  } else if (!returnPnr && p !== onwardPnr) {',
    '    returnPnr = p;',
    '  }',
    '}',
    'if (!onwardPnr && legs[0]) onwardPnr = pickPnrValue(legs[0].pnr || legs[0].airlinePnr);',
    'if (!returnPnr && legs[1]) returnPnr = pickPnrValue(legs[1].pnr || legs[1].airlinePnr);',
    'const primaryPnr = onwardPnr || returnPnr || pickPnrValue(((j && j.data) || j || {}).pnr);',
    'savePnrVar("flight_pnr", primaryPnr);',
    'savePnrVar("flight_pnr_onward", onwardPnr || primaryPnr);',
    'savePnrVar("flight_pnr_return", returnPnr);',
  ];
}

// Real TravelVIP BRs look like BR1786... — never save pricing bookingContext into flight_booking_reference.
function extractBookingRefScriptLines(varName) {
  return [
    'function pickBookingRef(root) {',
    '  const d = (root && root.data) || root || {};',
    '  const brsp = d.bookingResponse || d.booking || {};',
    '  const candidates = [',
    '    d.bookingReferenceId, d.bookingRefId, brsp.bookingReferenceId, brsp.bookingRefId,',
    '    d.bookingReference, d.booking_reference, brsp.bookingReference, root && root.bookingReferenceId, root && root.bookingReference',
    '  ];',
    '  for (let i = 0; i < candidates.length; i += 1) {',
    '    const v = candidates[i];',
    '    if (v === undefined || v === null || v === false || v === true) continue;',
    '    const s = String(v).trim();',
    '    if (/^BR\\d+/i.test(s)) return s;',
    '  }',
    '  return null;',
    '}',
    `const foundBr = pickBookingRef(j);`,
    `if (foundBr) { pm.environment.set("${varName}", foundBr); pm.collectionVariables.set("${varName}", foundBr); }`,
  ];
}

function extractPricingAndPNRTestScript() {
  return [
    'let j = {};',
    'try { j = pm.response.json(); } catch(e) { j = {}; }',
    'const d = j?.data || j || {};',
    saveVar('flight_price_id', 'd?.priceId || d?.pricing?.priceId'),
    // Pricing bookingContext only — do NOT write flight_booking_reference here (that is the issued BR).
    saveVar('flight_pricing_booking_reference', 'd?.bookingContext || d?.booking_reference || d?.bookingReference'),
    ...assertHttpTest('pm.response.code === 200', 'Pricing HTTP 200'),
    'pm.test("priceId and bookingContext saved", function () {',
    '  pm.expect(pm.environment.get("flight_price_id") || pm.collectionVariables.get("flight_price_id")).to.be.ok;',
    '  pm.expect(pm.environment.get("flight_pricing_booking_reference") || pm.collectionVariables.get("flight_pricing_booking_reference"), "pricing bookingContext").to.be.ok;',
    '});',
  ];
}

function extractIssueTicketBookingRefTestScript() {
  return [
    'let j = {};',
    'try { j = pm.response.json(); } catch(e) { j = {}; }',
    'const d = j?.data || j || {};',
    ...extractBookingRefScriptLines('flight_booking_reference'),
    ...extractPnrScriptLines(),
    ...assertHttpTest('pm.response.code === 200 || pm.response.code === 201', 'Issue-ticket HTTP 200'),
    'pm.test("issued BR saved (starts with BR)", function () {',
    '  const br = pm.environment.get("flight_booking_reference") || pm.collectionVariables.get("flight_booking_reference") || "";',
    '  pm.expect(br, "flight_booking_reference").to.match(/^BR\\d+/i);',
    '});',
  ];
}

function extractFlightStatusTestScript() {
  return [
    'let j = {};',
    'try { j = pm.response.json(); } catch(e) { j = {}; }',
    'const d = j?.data || j || {};',
    saveVar('flight_booking_status', 'd?.status || d?.bookingStatus'),
    ...extractBookingRefScriptLines('flight_booking_reference'),
    ...extractPnrScriptLines(),
    ...assertHttpTest('pm.response.code === 200', 'Booking status HTTP 200'),
    'const st = String(d?.status || d?.bookingStatus || "").toLowerCase();',
    'const done = ["confirmed","inprogress","failed","cancelled"].some(function (s) { return st.indexOf(s) !== -1; });',
    'const pollN = Number(pm.variables.get("status_poll_n") || 0);',
    'if (!done && pm.response.code === 200 && pollN < 12) {',
    '  pm.variables.set("status_poll_n", String(pollN + 1));',
    '  const until = Date.now() + 4000;',
    '  while (Date.now() < until) {}',
    '  postman.setNextRequest(pm.info.requestName);',
    '} else { pm.variables.set("status_poll_n", "0"); }',
  ];
}

function extractFlightDetailTestScript() {
  return [
    'let j = {};',
    'try { j = pm.response.json(); } catch(e) { j = {}; }',
    'const d = j?.data || j || {};',
    ...extractPnrScriptLines(),
    ...extractBookingRefScriptLines('flight_booking_reference'),
    ...assertHttpTest('pm.response.code === 200', 'Booking detail HTTP 200'),
    'pm.test("airline PNR saved (after Confirmed)", function () {',
    '  const st = String(pm.environment.get("flight_booking_status") || d?.status || d?.bookingStatus || "").toLowerCase();',
    '  if (st.indexOf("confirmed") === -1) { return; }',
    '  pm.expect(pm.environment.get("flight_pnr") || pm.collectionVariables.get("flight_pnr"), "flight_pnr from itinerary").to.be.ok;',
    '  pm.expect(String(pm.environment.get("flight_pnr") || "")).to.not.equal("false");',
    '});',
    'pm.test("RT domestic: onward + return PNRs when two itinerary legs", function () {',
    '  const st = String(pm.environment.get("flight_booking_status") || d?.status || d?.bookingStatus || "").toLowerCase();',
    '  if (st.indexOf("confirmed") === -1) { return; }',
    '  const legs = ((d.bookingResponse || {}).itinerary) || d.itinerary || [];',
    '  if (!Array.isArray(legs) || legs.length < 2) { return; }',
    '  pm.expect(pm.environment.get("flight_pnr_onward") || pm.collectionVariables.get("flight_pnr_onward"), "flight_pnr_onward").to.be.ok;',
    '  pm.expect(pm.environment.get("flight_pnr_return") || pm.collectionVariables.get("flight_pnr_return"), "flight_pnr_return").to.be.ok;',
    '});',
  ];
}

function extractSsrCatalogTestScript() {
  return [
    'let j = {};',
    'try { j = pm.response.json(); } catch(e) { j = {}; }',
    'const d = j?.data || j || {};',
    'function firstMeal() {',
    '  for (const seg of (d.meal && d.meal.segments) || []) {',
    '    for (const m of (seg.Meals || seg.meals || [])) {',
    '      const pref = m.priceReference || (m.pricing && m.pricing.priceReference);',
    '      if (pref) return { id: String(m.ssrId || m.mealId || ""), code: m.code || "", pref, seg: m.segmentId || seg.segmentId || "SEG_1" };',
    '    }',
    '  }',
    '  return null;',
    '}',
    'function firstBag() {',
    '  for (const seg of (d.baggage && (d.baggage.segments || d.baggage.Segments)) || []) {',
    '    for (const b of (seg.Baggage || seg.baggage || [])) {',
    '      const pref = b.priceReference || (b.pricing && b.pricing.priceReference);',
    '      if (pref) return { id: String(b.ssrId || b.baggageId || ""), code: b.code || "", pref, seg: b.segmentId || seg.segmentId || "SEG_1", origin: seg.Origin || seg.origin || "DEL", dest: seg.Destination || seg.destination || "BOM", weight: Number(b.weight || 5) };',
    '    }',
    '  }',
    '  return null;',
    '}',
    'const meal = firstMeal();',
    'const bag = firstBag();',
    'if (meal) { pm.environment.set("ssr_meal_id", meal.id); pm.collectionVariables.set("ssr_meal_id", meal.id); pm.environment.set("ssr_meal_code", meal.code); pm.collectionVariables.set("ssr_meal_code", meal.code); pm.environment.set("ssr_meal_price_reference", meal.pref); pm.collectionVariables.set("ssr_meal_price_reference", meal.pref); pm.environment.set("ssr_segment_id", meal.seg); pm.collectionVariables.set("ssr_segment_id", meal.seg); }',
    'if (bag) { pm.environment.set("ssr_bag_id", bag.id); pm.collectionVariables.set("ssr_bag_id", bag.id); pm.environment.set("ssr_bag_code", bag.code); pm.collectionVariables.set("ssr_bag_code", bag.code); pm.environment.set("ssr_bag_price_reference", bag.pref); pm.collectionVariables.set("ssr_bag_price_reference", bag.pref); }',
    ...assertHttpTest('pm.response.code === 200 && !errCode', 'SSR HTTP 200'),
  ];
}

function extractSeatmapTestScript() {
  return [
    'let j = {};',
    'try { j = pm.response.json(); } catch(e) { j = {}; }',
    'const d = j?.data?.data || j?.data || j || {};',
    'const segs = d.segments || (d.FlightSeat && d.FlightSeat.segments) || [];',
    'let seat = null;',
    'for (const seg of segs) {',
    '  for (const s of (seg.seatMap || seg.seats || [])) {',
    '    if (!/open/i.test(String(s.seatAvailability || s.availability || ""))) continue;',
    '    const pref = s.priceReference || (s.priceDetail && s.priceDetail.priceReference);',
    '    const seatName = s.seatName || s.seatNumber;',
    '    const seatId = s.seatId || s.seatKey;',
    '    if (seatName && seatId && pref) { seat = { seatName, seatId: String(seatId), seatKey: String(s.seatKey || seatId), pref, seg: s.segmentId || seg.segmentId || "SEG_1" }; break; }',
    '  }',
    '  if (seat) break;',
    '}',
    'if (seat) {',
    '  pm.environment.set("seat_name", seat.seatName); pm.collectionVariables.set("seat_name", seat.seatName);',
    '  pm.environment.set("seat_id", seat.seatId); pm.collectionVariables.set("seat_id", seat.seatId);',
    '  pm.environment.set("seat_key", seat.seatKey); pm.collectionVariables.set("seat_key", seat.seatKey);',
    '  pm.environment.set("seat_price_reference", seat.pref); pm.collectionVariables.set("seat_price_reference", seat.pref);',
    '  pm.environment.set("ssr_segment_id", seat.seg); pm.collectionVariables.set("ssr_segment_id", seat.seg);',
    '}',
    ...assertHttpTest('pm.response.code === 200 || errCode === "VENDOR_UNAVAILABLE" || errCode === "INVALID_REQUEST"', 'Seatmap 200 or documented unavailable'),
  ];
}

function extractHotelBookingRefTestScript() {
  return [
    'let j = {};',
    'try { j = pm.response.json(); } catch(e) { j = {}; }',
    // Finalize often returns top-level { bookingRefId, status } with no data wrapper.
    'const d = j?.data || j || {};',
    ...extractBookingRefScriptLines('hotel_booking_reference'),
    // Also accept hotel field names that may not be covered if pickBookingRef only saw non-BR strings.
    'if (!(pm.environment.get("hotel_booking_reference") || pm.collectionVariables.get("hotel_booking_reference"))) {',
    '  const fallback = d.bookingRefId || d.bookingReferenceId || j.bookingRefId || j.bookingReferenceId;',
    '  if (fallback && /^BR\\d+/i.test(String(fallback))) {',
    '    pm.environment.set("hotel_booking_reference", String(fallback));',
    '    pm.collectionVariables.set("hotel_booking_reference", String(fallback));',
    '  }',
    '}',
    saveVar('hotel_confirmation_number', 'd?.confirmationNumber || j?.confirmationNumber'),
    ...assertHttpTest('pm.response.code === 200 || pm.response.code === 201', 'Hotel finalize HTTP 200'),
    'pm.test("hotel BR saved (starts with BR)", function () {',
    '  const br = pm.environment.get("hotel_booking_reference") || pm.collectionVariables.get("hotel_booking_reference") || "";',
    '  pm.expect(br, "hotel_booking_reference").to.match(/^BR\\d+/i);',
    '});',
  ];
}

function extractHotelDetailsRequestIdAndBookingCodeTestScript() {
  return [
    'let j = {};',
    'try { j = pm.response.json(); } catch(e) { j = {}; }',
    'const d = j?.data || j || {};',
    'const requestId = d?.requestId || d?.request_id || null;',
    'const rooms = d?.results?.[0]?.rooms || d?.rooms || [];',
    'let bookingCode = null;',
    'if (Array.isArray(rooms)) { for (const r of rooms) { if (r?.bookingCode) { bookingCode = String(r.bookingCode); break; } } }',
    saveVar('hotel_request_id', 'requestId'),
    saveVar('hotel_booking_code', 'bookingCode'),
    ...assertHttpTest('pm.response.code === 200', 'Hotel details HTTP 200'),
    'pm.test("hotel_request_id and bookingCode saved", function () {',
    '  pm.expect(pm.environment.get("hotel_request_id") || pm.collectionVariables.get("hotel_request_id")).to.be.ok;',
    '  pm.expect(pm.environment.get("hotel_booking_code") || pm.collectionVariables.get("hotel_booking_code")).to.be.ok;',
    '});',
  ];
}

function extractHotelPrebookContextTestScript() {
  return [
    'let j = {};',
    'try { j = pm.response.json(); } catch(e) { j = {}; }',
    'const d = j?.data || j || {};',
    saveVar('hotel_booking_context', 'd?.bookingContext'),
    ...assertHttpTest('pm.response.code === 200', 'Hotel prebook HTTP 200'),
    'pm.test("hotel_booking_context saved", function () {',
    '  pm.expect(pm.environment.get("hotel_booking_context") || pm.collectionVariables.get("hotel_booking_context")).to.be.ok;',
    '});',
  ];
}

function ssrMealItem(direction) {
  return {
    ssrId: '{{ssr_meal_id}}',
    mealId: '{{ssr_meal_id}}',
    direction,
    segmentId: '{{ssr_segment_id}}',
    paxType: 'ADT',
    code: '{{ssr_meal_code}}',
    title: 'Meal',
    description: 'Meal',
    priceReference: '{{ssr_meal_price_reference}}',
  };
}

function ssrBagItem(direction, origin, destination) {
  return {
    ssrId: '{{ssr_bag_id}}',
    baggageId: '{{ssr_bag_id}}',
    direction,
    segmentId: '{{ssr_segment_id}}',
    paxType: 'ADT',
    code: '{{ssr_bag_code}}',
    title: 'Baggage',
    description: 'Baggage',
    priceReference: '{{ssr_bag_price_reference}}',
    weight: 5,
    origin,
    destination,
  };
}

function ssrSeatItem(direction, origin, destination) {
  return {
    origin,
    destination,
    segmentId: '{{ssr_segment_id}}',
    seatAvailability: 'Open',
    seatName: '{{seat_name}}',
    seatPosition: '',
    seatKey: '{{seat_key}}',
    seatId: '{{seat_id}}',
    direction,
    priceReference: '{{seat_price_reference}}',
  };
}

function leadSsrBlock({ withSSR, journeyType, origin, destination }) {
  if (!withSSR) return { baggage: [], meals: [], seats: [] };
  const dirs = journeyType === 'ROUND_TRIP'
    ? [
      { direction: 'ONWARD', origin, destination },
      { direction: 'RETURN', origin: destination, destination: origin },
    ]
    : [{ direction: 'ONWARD', origin, destination }];
  return {
    meals: dirs.map((d) => ssrMealItem(d.direction)),
    baggage: dirs.map((d) => ssrBagItem(d.direction, d.origin, d.destination)),
    seats: dirs.map((d) => ssrSeatItem(d.direction, d.origin, d.destination)),
  };
}

function issueTicketBody({ journeyType, paxCounts, withSSR = false, origin = 'DEL', destination = 'BOM' }) {
  const { adults, children, infants } = paxCounts;
  const totalPax = adults + children + infants;
  const passengers = [];
  let paxNum = 0;

  function adultPassenger(i, isLead) {
    paxNum += 1;
    return {
      paxId: `PAX${paxNum}`,
      type: 'adult',
      isLead,
      profile: {
        title: i % 2 === 0 ? 'Mr' : 'Mrs',
        firstName: isLead ? 'Rohan' : `Adult${paxNum}`,
        lastName: isLead ? 'Bhagat{{pax_last_tag}}' : `Last${paxNum}{{pax_last_tag}}`,
        gender: i % 2 === 0 ? 'Male' : 'Female',
        dob: i % 2 === 0 ? '2001-05-29' : '1995-08-15',
        nationality: 'IN',
      },
      city: { cityCode: 'Pune', cityName: 'Pune' },
      passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
      ssr: isLead ? leadSsrBlock({ withSSR, journeyType, origin, destination }) : { baggage: [], meals: [], seats: [] },
    };
  }

  function childPassenger(childIndex) {
    paxNum += 1;
    const male = childIndex % 2 === 0; // alternate genders/titles across children
    return {
      paxId: `PAX${paxNum}`,
      type: 'child',
      isLead: false,
      profile: {
        title: male ? 'Mstr' : 'Miss',
        firstName: `Child${paxNum}`,
        lastName: `Last${paxNum}{{pax_last_tag}}`,
        gender: male ? 'Male' : 'Female',
        dob: '2017-09-08',
        nationality: 'IN',
      },
      city: { cityCode: 'Pune', cityName: 'Pune' },
      passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
      ssr: { baggage: [], meals: [], seats: [] },
    };
  }

  function infantPassenger(infantIndex) {
    paxNum += 1;
    const male = infantIndex % 2 === 0; // alternate genders/titles across infants
    return {
      paxId: `PAX${paxNum}`,
      type: 'infant',
      isLead: false,
      profile: {
        title: male ? 'Mstr' : 'Miss',
        firstName: `Infant${paxNum}`,
        lastName: `Last${paxNum}{{pax_last_tag}}`,
        gender: male ? 'Male' : 'Female',
        dob: '{{infant_dob}}',
        nationality: 'IN',
      },
      city: { cityCode: 'Pune', cityName: 'Pune' },
      passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
      ssr: { baggage: [], meals: [], seats: [] },
    };
  }

  for (let a = 0; a < adults; a += 1) passengers.push(adultPassenger(a, a === 0));
  for (let c = 0; c < children; c += 1) passengers.push(childPassenger(c));
  for (let i = 0; i < infants; i += 1) passengers.push(infantPassenger(i));

  // Issue-ticket payload
  const body = {
    type: 'ticket',
    currency: 'INR',
    language: 'en',
    bookingReference: '{{flight_pricing_booking_reference}}',
    searchIds: journeyType === 'ROUND_TRIP'
      ? ['{{flight_onward_search_id}}', '{{flight_return_search_id}}']
      : ['{{flight_search_id}}'],
    journeyType,
    timezone: 'Asia/Calcutta',
    reschedulingReferenceId: null,
    reschedulingPnr: null,
    data: {
      priceId: '{{flight_price_id}}',
      passportType: 'NONE',
      includeGst: true,
      addGstInfo: true,
      gstDetails: { ...VALID_GST },
      contact: {
        email: 'qa@travelvip.ai',
        mobile: '9921862715',
        countryCode: '+91',
      },
      passengers,
    },
  };

  if (totalPax === 0) {
    throw new Error('Invalid paxCounts');
  }

  return body;
}

function flightSearchBody({ journeyType, paxCounts, connecting }) {
  const { adults, children, infants } = paxCounts;
  const maxStops = connecting ? 1 : 0;
  const origin = 'DEL';
  const destination = connecting ? 'GOI' : 'BOM';
  const oneWayDate = '2026-11-12';
  const rtOnwardDate = '2026-11-12';
  const rtReturnDate = '2026-11-19';

  return {
    itinerary: journeyType === 'ROUND_TRIP'
      ? [
        { origin, destination, date: rtOnwardDate },
        { origin: destination, destination: origin, date: rtReturnDate },
      ]
      : [
        { origin, destination, date: oneWayDate },
      ],
    travellers: { adults, children, infants },
    cabinClass: 'ECONOMY',
    journeyType,
    currency: 'INR',
    language: 'en',
    preferences: { airlines: [], maxStops, refundableOnly: false },
    appliedFilters: {},
    selection: { selectedSearchIds: [] },
    fareType: 'NORMAL',
  };
}

function passengersLabel({ adults, children, infants }) {
  let s = `${adults}ADT`;
  if (children) s += `+${children}CHD`;
  if (infants) s += `+${infants}INF`;
  return s;
}

function hotelFinalizePrepEvent() {
  return {
    listen: 'prerequest',
    script: {
      type: 'text/javascript',
      exec: [
        'let n = Date.now() % 456976; let tag = "";',
        'for (let i = 0; i < 4; i += 1) { tag = String.fromCharCode(97 + (n % 26)) + tag; n = Math.floor(n / 26); }',
        'pm.environment.set("pax_last_tag", tag);',
        'pm.collectionVariables.set("pax_last_tag", tag);',
        'const email = "qa." + Date.now() + "@travelvip.ai";',
        'pm.environment.set("hotel_contact_email", email);',
        'pm.collectionVariables.set("hotel_contact_email", email);',
      ],
    },
  };
}

function issueTicketPrepEvent() {
  return {
    listen: 'prerequest',
    script: {
      type: 'text/javascript',
      exec: [
        'const d = new Date();',
        'd.setMonth(d.getMonth() - 6);',
        'pm.environment.set("infant_dob", d.toISOString().slice(0, 10));',
        'pm.collectionVariables.set("infant_dob", d.toISOString().slice(0, 10));',
        'let n = Date.now() % 456976; let tag = "";',
        'for (let i = 0; i < 4; i += 1) { tag = String.fromCharCode(97 + (n % 26)) + tag; n = Math.floor(n / 26); }',
        'pm.environment.set("pax_last_tag", tag);',
        'pm.collectionVariables.set("pax_last_tag", tag);',
      ],
    },
  };
}

function generateFlightScenarioFolder({ scenarioName, journeyType, connecting, paxCounts, withSSR }) {
  const adults = paxCounts.adults;
  const children = paxCounts.children;
  const infants = paxCounts.infants;

  const searchBody = flightSearchBody({ journeyType, paxCounts, connecting });
  const detailsJourneyType = journeyType === 'ROUND_TRIP' ? 'ROUND_TRIP' : 'ONE_WAY';

  const selectionSearchIds = journeyType === 'ROUND_TRIP'
    ? ['{{flight_onward_search_id}}', '{{flight_return_search_id}}']
    : ['{{flight_search_id}}'];

  const detailsBody = { journeyType: detailsJourneyType, selection: { selectedSearchIds: selectionSearchIds } };
  const fareRulesBody = detailsBody;
  const pricingBody = detailsBody;

  const ssrBody = { priceId: '{{flight_price_id}}' };
  const seatPassengers = [];
  for (let idx = 0; idx < adults; idx += 1) {
    seatPassengers.push({
      paxRefNumber: String(idx + 1),
      passengerType: 1,
      gender: 'Male',
      title: 'Mr',
      firstName: idx === 0 ? 'Rohan' : `Adult${idx + 1}`,
      lastName: 'Bhagat',
    });
  }
  for (let idx = 0; idx < children; idx += 1) {
    const n = adults + idx + 1;
    const male = idx % 2 === 0;
    seatPassengers.push({
      paxRefNumber: String(n),
      passengerType: 2,
      gender: male ? 'Male' : 'Female',
      title: male ? 'Mstr' : 'Miss',
      firstName: `Child${n}`,
      lastName: 'Bhagat',
    });
  }

  const seatmapBody = {
    currency: 'INR',
    requestReference: '{{flight_pricing_booking_reference}}',
    passengers: seatPassengers,
  };

  const issueBody = issueTicketBody({
    journeyType,
    paxCounts,
    withSSR,
    origin: 'DEL',
    destination: connecting ? 'GOI' : 'BOM',
  });

  const searchItems = [
    req({
      name: `1. Flight Search (${journeyType}${connecting ? ' / connecting' : ''}) ${passengersLabel(paxCounts)}`,
      pathParts: ['v1', 'flights', 'search'],
      query: FLIGHT_SEARCH_QUERY,
      body: searchBody,
      testScript: extractSearchIdsTestScript({ connectingOnly: connecting, journeyType, requireReturn: false }),
    }),
  ];
  if (journeyType === 'ROUND_TRIP') {
    searchItems.push(req({
      name: '1b. Flight Search (lock onward / fetch return)',
      pathParts: ['v1', 'flights', 'search'],
      query: FLIGHT_SEARCH_QUERY,
      body: { ...searchBody, selection: { selectedSearchIds: ['{{flight_onward_search_id}}'] } },
      description: 'Round-trip return inventory is scoped to the onward searchId from step 1.',
      testScript: extractSearchIdsTestScript({ connectingOnly: connecting, journeyType, requireReturn: true }),
    }));
  }

  // For connecting selection, we still keep the same pipeline; we extract connecting searchIds from search response.
  const folder = {
    name: scenarioName,
    item: [
      ...searchItems,
      req({
        name: '2. Flight Details',
        pathParts: ['v1', 'flights', 'details'],
        query: FLIGHT_QUERY,
        body: detailsBody,
        testScript: assertHttpTest('pm.response.code === 200 && !errCode', 'Details HTTP 200 (not INVALID_SIGNATURE)'),
      }),
      req({
        name: '3. Flight Fare Rules',
        pathParts: ['v1', 'flights', 'fareRules'],
        query: FLIGHT_QUERY,
        body: fareRulesBody,
        description: 'Optional hop. Staging may return VENDOR_ERROR — that is not a signature failure.',
        testScript: assertHttpTest('pm.response.code === 200 || errCode === "VENDOR_ERROR"', 'Fare rules 200 or documented VENDOR_ERROR'),
      }),
      req({
        name: '4. Flight Pricing',
        pathParts: ['v1', 'flights', 'pricing'],
        query: FLIGHT_QUERY,
        body: pricingBody,
        testScript: extractPricingAndPNRTestScript(),
      }),
      // SSR + SeatMap (only for SSR scenarios)
      ...(withSSR
        ? [
          req({
            name: '5. Flight SSR (meals/baggage catalog)',
            pathParts: ['v1', 'flights', 'ssr'],
            query: FLIGHT_QUERY,
            body: ssrBody,
            description: 'Saves first paid meal/baggage into ssr_* vars. If catalog is empty, issue-ticket sends empty ssr arrays.',
            testScript: extractSsrCatalogTestScript(),
          }),
          req({
            name: '6. Flight SeatMap',
            pathParts: ['v1', 'flights', 'seatmap'],
            query: FLIGHT_QUERY,
            body: seatmapBody,
            description: 'requestReference = pricing bookingContext. DEL-BOM often VENDOR_UNAVAILABLE; issue-ticket then books without a seat.',
            testScript: extractSeatmapTestScript(),
          }),
        ]
        : []),
      req({
        name: withSSR ? '7. Issue Ticket (lead ssr meal/bag/seat when vars are set)' : '5. Issue Ticket',
        pathParts: ['api', 'v2', 'flights', 'booking', 'issue-ticket'],
        query: FLIGHT_ISSUE_TICKET_V2_QUERY,
        body: issueBody,
        partnerKey: true,
        description: 'v2 issue-ticket. bookingReference = pricing bookingContext, priceId from pricing, searchIds from search. includeGst=true + gstDetails (27AABCT1429B1Z1 / TravelVIP Technologies). Unique last-name tag + infant DOB set in pre-request. Empty SSR fields are stripped so a book still works without a seatmap.',
        testScript: extractIssueTicketBookingRefTestScript(),
      }),
      req({
        name: withSSR ? '8. Booking Status (poll until Confirmed/Inprogress/Failed/Cancelled)' : '6. Booking Status (poll until Confirmed/Inprogress/Failed/Cancelled)',
        method: 'GET',
        pathParts: ['v1', 'flights', 'booking', '{{flight_booking_reference}}', 'status'],
        query: FLIGHT_QUERY,
        description: 'Do not stop on Pending. Collection Runner re-sends until a terminal/Inprogress status.',
        testScript: extractFlightStatusTestScript(),
      }),
      req({
        name: withSSR ? '9. Booking Detail' : '7. Booking Detail',
        method: 'GET',
        pathParts: ['v1', 'flights', 'booking', '{{flight_booking_reference}}'],
        query: FLIGHT_QUERY,
        testScript: extractFlightDetailTestScript(),
      }),
      req({
        name: withSSR ? '10. Booking History' : '8. Booking History',
        method: 'GET',
        pathParts: ['v1', 'flights', 'bookings', 'history'],
        query: FLIGHT_BOOKING_HISTORY_QUERY,
        testScript: assertHttpTest('pm.response.code === 200', 'History HTTP 200'),
      }),
      ...generateScenarioCancelItems(paxCounts, journeyType),
    ],
  };

  // If SSR scenario, add infant dob pre-request to issue ticket (and we also need SSR vars extraction which we leave manual).
  // Add prerequest hook by modifying the issue request item after creation.
  // (We keep it simple: just compute infant_dob for all scenarios where issue ticket exists.)
  for (const it of folder.item) {
    if (it.request && it.request.method === 'POST' && String(it.request.url.raw || '').includes('/api/v2/flights/booking/issue-ticket')) {
      // Infant DOB must be set BEFORE signing so {{infant_dob}} is in the hashed body.
      it.event = [issueTicketPrepEvent(), ...it.event];
    }
  }

  return folder;
}

function paxIdsFor(paxCounts) {
  const n = (paxCounts.adults || 0) + (paxCounts.children || 0) + (paxCounts.infants || 0);
  return Array.from({ length: n }, (_, i) => `PAX${i + 1}`);
}

function generateScenarioCancelItems(paxCounts, journeyType = 'ONE_WAY') {
  const ids = paxIdsFor(paxCounts);
  const brPath = ['v1', 'flights', 'booking', '{{flight_booking_reference}}', 'cancel'];
  const v2Path = ['api', 'v2', 'flight', 'cancel'];
  const biz = 'pm.response.code === 200 || (pm.response.code >= 400 && pm.response.code < 500 && errCode !== "INVALID_SIGNATURE")';
  const isRt = journeyType === 'ROUND_TRIP';

  // Domestic RT: status/detail expose two airline PNRs (onward + return). Cancel each leg separately.
  if (isRt) {
    const items = [
      req({
        name: 'C1. Penalty — onward PNR',
        pathParts: brPath,
        query: FLIGHT_QUERY,
        body: { action: 'PENALTY', pnr: '{{flight_pnr_onward}}' },
        partnerKey: true,
        description: 'RT domestic: quote penalty for ONWARD itinerary PNR from status/detail ({{flight_pnr_onward}}).',
        testScript: assertHttpTest(biz, 'Penalty onward 200 or business 4xx'),
      }),
      req({
        name: 'C2. Penalty — return PNR',
        pathParts: brPath,
        query: FLIGHT_QUERY,
        body: { action: 'PENALTY', pnr: '{{flight_pnr_return}}' },
        partnerKey: true,
        description: 'RT domestic: quote penalty for RETURN itinerary PNR from status/detail ({{flight_pnr_return}}).',
        testScript: assertHttpTest(biz, 'Penalty return 200 or business 4xx'),
      }),
    ];

    ids.forEach((paxId) => {
      items.push(req({
        name: `C2b. Penalty onward — paxwise ${paxId}`,
        pathParts: brPath,
        query: FLIGHT_QUERY,
        body: { action: 'PENALTY', pnr: '{{flight_pnr_onward}}', cancellationPaxList: [paxId] },
        partnerKey: true,
        description: `PARTIAL_PAX penalty on onward PNR for ${paxId}.`,
        testScript: assertHttpTest(biz, `Penalty onward ${paxId} 200 or business 4xx`),
      }));
    });

    items.push(req({
      name: 'C3. Cancel v1 — onward PNR',
      pathParts: brPath,
      query: FLIGHT_QUERY,
      body: {
        action: 'CANCEL',
        pnr: '{{flight_pnr_onward}}',
        cancellationReason: 'Customer requested cancellation — onward',
        cancelledBy: 'USER',
      },
      partnerKey: true,
      description: 'POST /v1/flights/booking/{BR}/cancel action=CANCEL for onward PNR only.',
      testScript: assertHttpTest(biz, 'v1 cancel onward 200 or business 4xx'),
    }));

    items.push(req({
      name: 'C4. Cancel v1 — return PNR',
      pathParts: brPath,
      query: FLIGHT_QUERY,
      body: {
        action: 'CANCEL',
        pnr: '{{flight_pnr_return}}',
        cancellationReason: 'Customer requested cancellation — return',
        cancelledBy: 'USER',
      },
      partnerKey: true,
      description: 'POST /v1/flights/booking/{BR}/cancel action=CANCEL for return PNR only.',
      testScript: assertHttpTest(biz, 'v1 cancel return 200 or business 4xx'),
    }));

    items.push(req({
      name: 'C5. Cancel v2 — onward PNR',
      pathParts: v2Path,
      query: FLIGHT_QUERY,
      body: {
        bookingId: '{{flight_booking_reference}}',
        action: 'CANCEL',
        pnr: '{{flight_pnr_onward}}',
        cancellationReason: 'Customer requested cancellation — onward',
        cancelledBy: 'USER',
      },
      partnerKey: true,
      description: 'POST /api/v2/flight/cancel for onward PNR.',
      testScript: assertHttpTest(biz, 'v2 cancel onward 200 or business 4xx'),
    }));

    items.push(req({
      name: 'C6. Cancel v2 — return PNR',
      pathParts: v2Path,
      query: FLIGHT_QUERY,
      body: {
        bookingId: '{{flight_booking_reference}}',
        action: 'CANCEL',
        pnr: '{{flight_pnr_return}}',
        cancellationReason: 'Customer requested cancellation — return',
        cancelledBy: 'USER',
      },
      partnerKey: true,
      description: 'POST /api/v2/flight/cancel for return PNR.',
      testScript: assertHttpTest(biz, 'v2 cancel return 200 or business 4xx'),
    }));

    ids.forEach((paxId) => {
      items.push(req({
        name: `C6b. Cancel v2 onward — paxwise ${paxId}`,
        pathParts: v2Path,
        query: FLIGHT_QUERY,
        body: {
          bookingId: '{{flight_booking_reference}}',
          action: 'CANCEL',
          pnr: '{{flight_pnr_onward}}',
          cancellationReason: 'Partial pax cancel — onward',
          cancelledBy: 'USER',
          cancellationPaxList: [paxId],
        },
        partnerKey: true,
        description: `Pax-wise cancel ${paxId} on onward PNR.`,
        testScript: assertHttpTest(biz, `v2 onward pax ${paxId} 200 or business 4xx`),
      }));
    });

    items.push(req({
      name: 'C7. Status after cancel',
      method: 'GET',
      pathParts: ['v1', 'flights', 'booking', '{{flight_booking_reference}}', 'status'],
      query: FLIGHT_QUERY,
      description: 'After RT leg cancels, status may stay Confirmed with Cancellation Requested, or become Cancelled / Partially cancelled.',
      testScript: extractFlightStatusTestScript(),
    }));

    return items;
  }

  const cancelBase = {
    action: 'CANCEL',
    pnr: '{{flight_pnr}}',
    cancellationReason: 'Customer requested cancellation',
    cancelledBy: 'USER',
  };

  const items = [
    req({
      name: `C1. Penalty — full PNR (${passengersLabel(paxCounts)})`,
      pathParts: brPath,
      query: FLIGHT_QUERY,
      body: { action: 'PENALTY', pnr: '{{flight_pnr}}' },
      partnerKey: true,
      description: `Quote only for this ${passengersLabel(paxCounts)} booking. Status should stay Confirmed.`,
      testScript: assertHttpTest(biz, 'Penalty 200 or business 4xx'),
    }),
  ];

  ids.forEach((paxId) => {
    items.push(req({
      name: `C1b. Penalty — paxwise ${paxId}`,
      pathParts: brPath,
      query: FLIGHT_QUERY,
      body: { action: 'PENALTY', pnr: '{{flight_pnr}}', cancellationPaxList: [paxId] },
      partnerKey: true,
      description: `PARTIAL_PAX penalty for ${paxId} on this folder's occupancy.`,
      testScript: assertHttpTest(biz, `Penalty ${paxId} 200 or business 4xx`),
    }));
  });

  items.push(req({
    name: 'C2. Cancel v1 — full PNR',
    pathParts: brPath,
    query: FLIGHT_QUERY,
    body: { ...cancelBase },
    partnerKey: true,
    description: 'POST /v1/flights/booking/{BR}/cancel action=CANCEL.',
    testScript: assertHttpTest(biz, 'v1 cancel 200 or business 4xx'),
  }));

  items.push(req({
    name: 'C3. Cancel v2 — full PNR',
    pathParts: v2Path,
    query: FLIGHT_QUERY,
    body: { bookingId: '{{flight_booking_reference}}', ...cancelBase },
    partnerKey: true,
    description: 'POST /api/v2/flight/cancel. bookingId + pnr + cancelledBy USER.',
    testScript: assertHttpTest(biz, 'v2 cancel 200 or business 4xx'),
  }));

  ids.forEach((paxId) => {
    items.push(req({
      name: `C3b. Cancel v2 — paxwise ${paxId}`,
      pathParts: v2Path,
      query: FLIGHT_QUERY,
      body: { bookingId: '{{flight_booking_reference}}', ...cancelBase, cancellationPaxList: [paxId] },
      partnerKey: true,
      description: `Pax-wise cancel ${paxId}. ${ids.length === 1 ? '1ADT: same as lead-only.' : `This folder has ${ids.join(', ')}.`}`,
      testScript: assertHttpTest(biz, `v2 pax ${paxId} 200 or business 4xx`),
    }));
  });

  items.push(req({
    name: 'C4. Status after cancel',
    method: 'GET',
    pathParts: ['v1', 'flights', 'booking', '{{flight_booking_reference}}', 'status'],
    query: FLIGHT_QUERY,
    testScript: extractFlightStatusTestScript(),
  }));

  return items;
}

function generatePaxwiseCancellationItems() {
  return [
    {
      name: 'OW 1ADT keys PAX1',
      item: generateScenarioCancelItems({ adults: 1, children: 0, infants: 0 }, 'ONE_WAY'),
    },
    {
      name: 'OW 1ADT+1CHD keys PAX1,PAX2',
      item: generateScenarioCancelItems({ adults: 1, children: 1, infants: 0 }, 'ONE_WAY'),
    },
    {
      name: 'OW 2ADT keys PAX1,PAX2',
      item: generateScenarioCancelItems({ adults: 2, children: 0, infants: 0 }, 'ONE_WAY'),
    },
    {
      name: 'OW 1ADT+1CHD+1INF keys PAX1,PAX2,PAX3',
      item: generateScenarioCancelItems({ adults: 1, children: 1, infants: 1 }, 'ONE_WAY'),
    },
    {
      name: 'RT domestic — onward + return PNR (1ADT)',
      item: generateScenarioCancelItems({ adults: 1, children: 0, infants: 0 }, 'ROUND_TRIP'),
    },
    {
      name: 'RT domestic — onward + return PNR (2ADT)',
      item: generateScenarioCancelItems({ adults: 2, children: 0, infants: 0 }, 'ROUND_TRIP'),
    },
  ];
}

function generateHotelScenarioFolder({ name, paxCounts }) {
  const { adults, children, infants = 0 } = paxCounts;
  const guests = [];
  let paxIndex = 0;
  const roomChildren = children + infants;
  const childrenAges = [
    ...Array.from({ length: children }, () => 9),
    ...Array.from({ length: infants }, () => 1),
  ];

  function addAdult(isLead, i) {
    paxIndex += 1;
    const female = !isLead && i % 2 === 1;
    guests.push({
      title: female ? 'Mrs' : 'Mr',
      firstName: isLead ? 'Rohan' : `Adult${paxIndex}`,
      lastName: isLead ? 'Bhagat{{pax_last_tag}}' : `Last${paxIndex}{{pax_last_tag}}`,
      type: 'Adult',
      isLead,
    });
  }
  function addChild(childIndex, age) {
    paxIndex += 1;
    const male = childIndex % 2 === 0;
    guests.push({
      title: male ? 'Mstr' : 'Miss',
      firstName: age < 2 ? `Infant${paxIndex}` : `Child${paxIndex}`,
      lastName: `Last${paxIndex}{{pax_last_tag}}`,
      type: 'Child',
      age,
      isLead: false,
    });
  }

  if (adults >= 1) addAdult(true, 0);
  for (let a = 1; a < adults; a += 1) addAdult(false, a);
  for (let c = 0; c < children; c += 1) addChild(c, 9);
  for (let i = 0; i < infants; i += 1) addChild(children + i, 1);

  const occupancy = {
    adults,
    children: roomChildren,
    childrenAges,
  };

  const searchBody = {
    entityId: '39627872',
    nationality: 'IN',
    type: 'HOTEL',
    checkin: '2026-09-15',
    checkout: '2026-09-16',
    rooms: [occupancy],
  };

  const detailsBody = {
    entityId: '39627872',
    nationality: 'IN',
    type: 'HOTEL',
    checkin: '2026-09-15',
    checkout: '2026-09-16',
    rooms: [occupancy],
  };
  const prebookBody = { bookingCode: '{{hotel_booking_code}}', requestId: '{{hotel_request_id}}' };

  // Note: finalize in regression uses bookingContext, bookingCode, requestId and rooms.guests.
  const finalizeBody = {
    bookingContext: '{{hotel_booking_context}}',
    bookingCode: '{{hotel_booking_code}}',
    requestId: '{{hotel_request_id}}',
    checkin: '2026-09-15',
    checkout: '2026-09-16',
    gstDetails: { ...VALID_GST },
    rooms: [{ guests }],
    contact: {
      email: '{{hotel_contact_email}}',
      countryCode: '+91',
      mobile: '9921862715',
      panCardNumber: 'EUIPB1672M',
      panCardName: 'Rohan Bhagat',
    },
  };

  const folder = {
    name,
    item: [
      req({
        name: '0. Hotel Autocomplete (Hilltop / set hotel_entity_id)',
        method: 'GET',
        pathParts: ['v1', 'hotels', 'autocomplete'],
        query: [
          ...HOTEL_QUERY,
          { key: 'q', value: 'hiltop' },
          { key: 'page', value: '1' },
          { key: 'perpage', value: '20' },
        ],
        description: 'Optional. Search/details below use hardcoded Hilltop entityId 39627872.',
        testScript: assertHttpTest('pm.response.code === 200', 'Autocomplete HTTP 200'),
      }),
      req({
        name: '1. Search',
        pathParts: ['v1', 'hotels', 'search'],
        query: HOTEL_SEARCH_QUERY,
        body: searchBody,
        description: 'Hilltop Mumbai HOTEL search with pid=vgm.',
        testScript: assertHttpTest('pm.response.code === 200 && !errCode', 'Hotel search HTTP 200'),
      }),
      req({
        name: '2. Details',
        pathParts: ['v1', 'hotels', 'details'],
        query: HOTEL_SEARCH_QUERY,
        body: detailsBody,
        testScript: extractHotelDetailsRequestIdAndBookingCodeTestScript(),
      }),
      req({
        name: '3. Prebook',
        pathParts: ['v1', 'hotels', 'prebook'],
        query: HOTEL_PREBOOK_QUERY,
        body: prebookBody,
        testScript: extractHotelPrebookContextTestScript(),
      }),
      req({
        name: '4. Finalize',
        pathParts: ['v1', 'hotels', 'finalize-booking'],
        query: HOTEL_FINALIZE_QUERY,
        body: finalizeBody,
        partnerKey: true,
        description: 'Hilltop isPANMandatory: contact.panCardNumber + panCardName (lead). Dates match search 2026-09-15/16. Unique email + last-name tag in pre-request. X-Partner-Key = access_token.',
        testScript: extractHotelBookingRefTestScript(),
      }),
      req({
        name: '5. Booking Status',
        method: 'GET',
        pathParts: ['v1', 'hotels', 'bookings', '{{hotel_booking_reference}}', 'status'],
        query: HOTEL_QUERY,
        testScript: assertHttpTest('pm.response.code === 200', 'Hotel status HTTP 200'),
      }),
      req({
        name: '6. Booking Detail',
        method: 'GET',
        pathParts: ['v1', 'hotels', 'bookings', '{{hotel_booking_reference}}'],
        query: HOTEL_QUERY,
        testScript: assertHttpTest('pm.response.code === 200', 'Hotel detail HTTP 200'),
      }),
      req({
        name: '7. Booking History',
        method: 'GET',
        pathParts: ['v1', 'hotels', 'bookings', 'history'],
        query: HOTEL_BOOKING_HISTORY_QUERY,
        testScript: assertHttpTest('pm.response.code === 200', 'Hotel history HTTP 200'),
      }),
      req({
        name: '8. Penalty check (GET)',
        method: 'GET',
        pathParts: ['v1', 'hotels', 'bookings', '{{hotel_booking_reference}}', 'penalty-check'],
        query: HOTEL_QUERY,
        partnerKey: true,
        description: 'Quote only — does not cancel.',
        testScript: assertHttpTest('pm.response.code === 200 || (pm.response.code >= 400 && errCode !== "INVALID_SIGNATURE")', 'Penalty check 200 or business 4xx'),
      }),
      req({
        name: '9. Cancel (GET)',
        method: 'GET',
        pathParts: ['v1', 'hotels', 'bookings', '{{hotel_booking_reference}}', 'cancel'],
        query: HOTEL_QUERY,
        partnerKey: true,
        description: 'Hotel cancel is GET. Poll status after this for Cancelled.',
        testScript: assertHttpTest('pm.response.code === 200 || (pm.response.code >= 400 && errCode !== "INVALID_SIGNATURE")', 'Hotel cancel 200 or business 4xx'),
      }),
    ],
  };

  for (const it of folder.item) {
    if (it.request && String(it.request.url.raw || '').includes('finalize-booking')) {
      it.event = [hotelFinalizePrepEvent(), ...it.event];
    }
  }
  return folder;
}

function cabFinalizePrepEvent() {
  return {
    listen: 'prerequest',
    script: {
      type: 'text/javascript',
      exec: [
        'const tag = String(Date.now()).slice(-6);',
        'const email = "cab.postman." + tag + "@travelvip.ai";',
        'pm.environment.set("cab_contact_email", email);',
        'pm.collectionVariables.set("cab_contact_email", email);',
      ],
    },
  };
}

function extractCabSearchIdTestScript() {
  return [
    'let j = {};',
    'try { j = pm.response.json(); } catch(e) { j = {}; }',
    'const cabs = j?.cabs || j?.data?.cabs || [];',
    'function pickCab(list) {',
    '  if (!Array.isArray(list) || !list.length) return null;',
    '  const withId = list.filter((c) => c && c.searchId);',
    '  const rec = withId.find((c) => Array.isArray(c.tags) && c.tags.includes("RECOMMENDED") && c.fareId && c.fareId !== "Unknown");',
    '  if (rec) return rec.searchId;',
    '  const known = withId.find((c) => c.fareId && c.fareId !== "Unknown");',
    '  if (known) return known.searchId;',
    '  return withId[0]?.searchId || null;',
    '}',
    'const sid = pickCab(cabs);',
    'if (sid) { pm.environment.set("cab_search_id", sid); pm.collectionVariables.set("cab_search_id", sid); }',
    ...assertHttpTest('pm.response.code === 200 && sid', 'Cab search HTTP 200 with cab_search_id'),
  ];
}

function extractCabFareTestScript() {
  return [
    'let j = {};',
    'try { j = pm.response.json(); } catch(e) { j = {}; }',
    'const d = j?.data || j || {};',
    saveVar('cab_fare_booking_reference', 'd?.bookingReference'),
    saveVar('cab_price_id', 'd?.priceId'),
    saveVar('cab_extra_km_rate', 'd?.extraKmRate ?? d?.trip?.extraKmRate'),
    ...assertHttpTest('pm.response.code === 200', 'Cab fare HTTP 200'),
    'pm.test("cab fare tokens saved", function () {',
    '  pm.expect(pm.environment.get("cab_fare_booking_reference") || pm.collectionVariables.get("cab_fare_booking_reference")).to.be.ok;',
    '  pm.expect(pm.environment.get("cab_price_id") || pm.collectionVariables.get("cab_price_id")).to.be.ok;',
    '});',
    'pm.test("extraKmFareLabel removed from fare (schema)", function () {',
    '  pm.expect(d.extraKmFareLabel, "extraKmFareLabel should be absent").to.be.oneOf([undefined, null]);',
    '  pm.expect(d.trip && d.trip.extraKmFareLabel, "trip.extraKmFareLabel should be absent").to.be.oneOf([undefined, null]);',
    '});',
  ];
}

function extractCabBookingRefTestScript() {
  return [
    'let j = {};',
    'try { j = pm.response.json(); } catch(e) { j = {}; }',
    'const d = j?.data || j || {};',
    ...extractBookingRefScriptLines('cab_booking_reference'),
    'if (!(pm.environment.get("cab_booking_reference") || pm.collectionVariables.get("cab_booking_reference"))) {',
    '  const fallback = d.bookingRefId || d.bookingReferenceId || j.bookingRefId || j.bookingReferenceId;',
    '  if (fallback && /^BR\\d+/i.test(String(fallback))) {',
    '    pm.environment.set("cab_booking_reference", String(fallback));',
    '    pm.collectionVariables.set("cab_booking_reference", String(fallback));',
    '  }',
    '}',
    saveVar('cab_booking_status', 'd?.status || j?.status'),
    ...assertHttpTest('pm.response.code === 200 || pm.response.code === 201', 'Cab finalize HTTP 200'),
    'pm.test("cab BR saved", function () {',
    '  const br = pm.environment.get("cab_booking_reference") || pm.collectionVariables.get("cab_booking_reference") || "";',
    '  pm.expect(br).to.match(/^BR\\d+/i);',
    '});',
  ];
}

function extractCabStatusDetailTestScript() {
  return [
    'let j = {};',
    'try { j = pm.response.json(); } catch(e) { j = {}; }',
    'const d = j?.details || j?.data?.details || j?.data || j || {};',
    saveVar('cab_booking_status', 'j?.status || d?.status'),
    ...assertHttpTest('pm.response.code === 200', 'Cab status/detail HTTP 200'),
    'pm.test("extraKmRate present; extraKmFareLabel gone", function () {',
    '  pm.expect(d.extraKmFareLabel, "extraKmFareLabel").to.be.oneOf([undefined, null]);',
    '  if (d.extraKmRate != null) pm.expect(Number(d.extraKmRate)).to.be.a("number");',
    '});',
    'pm.test("assignment.tripOtp must be absent", function () {',
    '  const a = d.assignment || {};',
    '  pm.expect(a.tripOtp, "assignment.tripOtp").to.be.oneOf([undefined, null]);',
    '});',
    'pm.test("progress block present", function () {',
    '  pm.expect(d.progress).to.be.an("object");',
    '});',
  ];
}

function generateCabScenarioFolder({ scenarioName, journeyType, travelType = 'DEPARTURE' }) {
  const searchBody = cabSearchBody({ journeyType, travelType });
  const folder = {
    name: scenarioName,
    item: [
      req({
        name: '1. Cab Search',
        pathParts: ['v1', 'airportServices', 'cabs', 'search'],
        query: CAB_QUERY,
        body: searchBody,
        testScript: extractCabSearchIdTestScript(),
        description: `POST /v1/airportServices/cabs/search — ${journeyType}${travelType !== 'DEPARTURE' ? ` / ${travelType}` : ''}`,
      }),
      req({
        name: '2. Cab Fare',
        pathParts: ['v1', 'airportServices', 'cabs', 'fare'],
        query: CAB_QUERY,
        body: { searchId: '{{cab_search_id}}' },
        testScript: extractCabFareTestScript(),
        description: 'POST /v1/airportServices/cabs/fare — saves cab_fare_booking_reference + cab_price_id',
      }),
      req({
        name: '3. Cab Finalize Booking',
        pathParts: ['v1', 'airportServices', 'cabs', 'finalize-booking'],
        query: CAB_QUERY,
        body: cabFinalizeBody(),
        partnerKey: true,
        testScript: extractCabBookingRefTestScript(),
        description: 'POST /v1/airportServices/cabs/finalize-booking — requires X-Partner-Key. LIVE BOOK if run.',
      }),
      req({
        name: '4. Cab Booking Status',
        method: 'GET',
        pathParts: ['v1', 'airportServices', 'cabs', '{{cab_booking_reference}}', 'status'],
        query: CAB_QUERY,
        testScript: extractCabStatusDetailTestScript(),
        description: 'GET /v1/airportServices/cabs/{BR}/status',
      }),
      req({
        name: '5. Cab Booking Details',
        method: 'GET',
        pathParts: ['v1', 'airportServices', 'cabs', 'booking', '{{cab_booking_reference}}'],
        query: CAB_QUERY,
        testScript: extractCabStatusDetailTestScript(),
        description: 'GET /v1/airportServices/cabs/booking/{BR} — check extraKmRate, pickup/drop.address, airportCode',
      }),
      req({
        name: '6. Cab Booking History',
        method: 'GET',
        pathParts: ['v1', 'airportServices', 'cabs', 'booking', 'history'],
        query: CAB_HISTORY_QUERY,
        testScript: assertHttpTest('pm.response.code === 200', 'Cab history HTTP 200'),
        description: 'GET /v1/airportServices/cabs/booking/history',
      }),
      req({
        name: '7. Cab Tracking Location',
        method: 'GET',
        pathParts: ['v1', 'airportServices', 'cabs', 'tracking', '{{cab_booking_reference}}', 'location'],
        query: CAB_QUERY,
        testScript: assertHttpTest('pm.response.code === 200 || pm.response.code === 404', 'Cab tracking HTTP 200 or 404'),
        description: 'GET /v1/airportServices/cabs/tracking/{BR}/location',
      }),
      req({
        name: '8. Cab Cancel',
        method: 'GET',
        pathParts: ['v1', 'airportServices', 'cabs', 'bookings', '{{cab_booking_reference}}', 'cancel'],
        query: CAB_QUERY,
        partnerKey: true,
        testScript: [
          ...assertHttpTest('pm.response.code === 200', 'Cab cancel HTTP 200'),
          'let j = {}; try { j = pm.response.json(); } catch(e) {}',
          'const st = j?.status ?? j?.data?.cancellationRequest?.status ?? j?.message;',
          'console.log("Cancel response status/message:", st);',
        ],
        description: 'GET /v1/airportServices/cabs/bookings/{BR}/cancel — requires X-Partner-Key',
      }),
    ],
  };

  for (const it of folder.item) {
    if (it.request && String(it.request.url.raw || '').includes('finalize-booking')) {
      it.event = [cabFinalizePrepEvent(), ...it.event];
    }
  }
  return folder;
}

function buildCabReferenceFolder() {
  return {
    name: '6.A Cab reference data',
    item: [
      req({
        name: '6.A.1 Cab Locations',
        method: 'GET',
        pathParts: ['v1', 'airportServices', 'cabs', 'locations'],
        query: [...CAB_QUERY, { key: 'latitude', value: '18.5679' }, { key: 'longitude', value: '73.9143' }],
        testScript: assertHttpTest('pm.response.code === 200', 'Cab locations HTTP 200'),
      }),
      req({
        name: '6.A.2 Places Autocomplete',
        method: 'GET',
        pathParts: ['v1', 'airportServices', 'cabs', 'places', 'autocomplete'],
        query: [...CAB_QUERY, { key: 'searchText', value: 'viman nagar' }],
        testScript: assertHttpTest('pm.response.code === 200', 'Cab autocomplete HTTP 200'),
      }),
    ],
  };
}

function buildCabScenariosFolder() {
  return {
    name: '6. Cabs (search → fare → book → status → detail → cancel)',
    item: [
      buildCabReferenceFolder(),
      {
        name: '6.B Cab booking scenarios',
        item: [
          generateCabScenarioFolder({ scenarioName: 'Cab AIRPORT / DEPARTURE (DEL)', journeyType: 'AIRPORT', travelType: 'DEPARTURE' }),
          generateCabScenarioFolder({ scenarioName: 'Cab AIRPORT / ARRIVAL (DEL)', journeyType: 'AIRPORT', travelType: 'ARRIVAL' }),
          generateCabScenarioFolder({ scenarioName: 'Cab OUTSTATION (Pune)', journeyType: 'OUTSTATION' }),
          generateCabScenarioFolder({ scenarioName: 'Cab RENTAL (Pune)', journeyType: 'RENTAL' }),
        ],
      },
    ],
  };
}

function buildCabsOnlyCollection() {
  const collection = buildCollectionBase({ name: 'TravelVIP — Dynamic Cabs (AIRPORT/OUTSTATION/RENTAL)' });
  collection.info.description += '\n\nCab finalize + cancel require X-Partner-Key (partner access_token). Run Auth 01→03 first. Finalize books live on staging if executed.';
  collection.item = [
    {
      name: '0. Auth (run first)',
      item: [
        reqAuth({
          name: '01 Access Token',
          method: 'POST',
          pathParts: ['auth', 'partner', 'token'],
          body: { partner_id: '{{partner_id}}', partner_secret: '{{partner_secret}}' },
          testScript: [
            'const res = pm.response.json();',
            'pm.environment.set("access_token", res.access_token);',
            'pm.environment.set("refresh_token", res.refresh_token);',
            'pm.collectionVariables.set("access_token", res.access_token);',
            'pm.collectionVariables.set("refresh_token", res.refresh_token);',
          ],
        }),
        reqAuth({
          name: '03 User Auth',
          method: 'POST',
          pathParts: ['v1', 'auth', 'session'],
          headersExtra: [{ key: 'X-Partner-Key', value: '{{access_token}}' }],
          rawBody: '{\n  "tierId": {{tier_id}}\n}\n',
          testScript: [
            'const res = pm.response.json();',
            'pm.environment.set("auth_token", res.auth_token);',
            'pm.collectionVariables.set("auth_token", res.auth_token);',
          ],
        }),
      ],
    },
    buildCabScenariosFolder(),
  ];
  return collection;
}

function buildCollectionBase({ name }) {
  return {
    info: {
      name,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      description: 'Dynamic scenario template: OW/RT, multipax, connecting, SSR, then issue-ticket / status / detail / history / penalty / cancel.\n\nSigning: resolve {{vars}} then HMAC-SHA256(body + timestamp).\n\nIssue-ticket uses pricing bookingContext + priceId + searchIds, includeGst=true, and full gstDetails. Unique last-name tag and infant DOB are set in pre-request. Empty SSR vars are stripped so book still works without a seatmap.\n\nRT domestic: Booking Status/Detail save flight_pnr_onward + flight_pnr_return from itinerary; cancel folders run Penalty/Cancel per leg PNR.\n\nHotel finalize uses Hilltop PAN (EUIPB1672M / Rohan Bhagat), the same gstDetails, and dates 2026-09-15/16.\n\nA full Collection Runner WILL book live tickets if you run Issue Ticket / Finalize. Stop after Pricing/Prebook if you do not want that.\n\nAuth: Partner Api 01 then 03 first.',
    },
    variable: [
      { key: 'base_url', value: BASE_URL_DEFAULT },
      { key: 'access_token', value: '' },
      { key: 'auth_token', value: '' },
      { key: 'signing_key', value: '' },
      { key: 'correlation_id', value: '' },
      { key: 'request_id', value: '' },
      { key: 'timestamp', value: '' },
      { key: 'signature', value: '' },

      // Partner auth — names match B2B Dev.postman_environment.json
      { key: 'partner_id', value: '' },
      { key: 'partner_secret', value: '' },
      { key: 'tier_id', value: '10546901' },
      { key: 'refresh_token', value: '' },

      { key: 'flight_search_id', value: '' },
      { key: 'flight_onward_search_id', value: '' },
      { key: 'flight_return_search_id', value: '' },
      { key: 'flight_price_id', value: '' },
      { key: 'flight_pricing_booking_reference', value: '' },
      { key: 'flight_booking_reference', value: '' },
      { key: 'flight_pnr', value: '' },
      { key: 'flight_pnr_onward', value: '' },
      { key: 'flight_pnr_return', value: '' },
      { key: 'flight_booking_status', value: '' },
      { key: 'infant_dob', value: '' },
      { key: 'pax_last_tag', value: '' },

      // SSR placeholders (filled from SSR/seatmap responses or manually)
      { key: 'ssr_meal_id', value: '' },
      { key: 'ssr_meal_code', value: '' },
      { key: 'ssr_meal_price_reference', value: '' },
      { key: 'ssr_bag_id', value: '' },
      { key: 'ssr_bag_code', value: '' },
      { key: 'ssr_bag_price_reference', value: '' },
      { key: 'ssr_segment_id', value: 'SEG_1' },
      { key: 'seat_name', value: '' },
      { key: 'seat_key', value: '' },
      { key: 'seat_id', value: '' },
      { key: 'seat_price_reference', value: '' },
      // Hotel vars
      { key: 'hotel_entity_id', value: '39627872' },
      { key: 'hotel_checkin', value: '2026-09-15' },
      { key: 'hotel_checkout', value: '2026-09-16' },
      { key: 'hotel_booking_code', value: '' },
      { key: 'hotel_request_id', value: '' },
      { key: 'hotel_booking_context', value: '' },
      { key: 'hotel_booking_reference', value: '' },
      { key: 'hotel_confirmation_number', value: '' },
      { key: 'hotel_contact_email', value: '' },
      // Cab vars
      { key: 'cab_search_id', value: '' },
      { key: 'cab_fare_booking_reference', value: '' },
      { key: 'cab_price_id', value: '' },
      { key: 'cab_booking_reference', value: '' },
      { key: 'cab_booking_status', value: '' },
      { key: 'cab_extra_km_rate', value: '' },
      { key: 'cab_contact_email', value: '' },
    ],
  };
}

function buildFlightsOnlyCollection() {
  const collection = buildCollectionBase({ name: 'TravelVIP — Dynamic Flights (OW/RT + connecting + multipax + paxwise cancel)' });

  const paxVariants = [
    { key: '1ADT', pax: { adults: 1, children: 0, infants: 0 } },
    { key: '1ADT+1CHD', pax: { adults: 1, children: 1, infants: 0 } },
    { key: '2ADT', pax: { adults: 2, children: 0, infants: 0 } },
    { key: '1ADT+1CHD+1INF', pax: { adults: 1, children: 1, infants: 1 } },
  ];

  const oneWayDirect = paxVariants.map((v) => generateFlightScenarioFolder({
    scenarioName: `OW / Direct / ${v.key}`,
    journeyType: 'ONE_WAY',
    connecting: false,
    paxCounts: v.pax,
    withSSR: false,
  }));

  const oneWayConnecting = paxVariants.map((v) => generateFlightScenarioFolder({
    scenarioName: `OW / Connecting (select connecting) / ${v.key}`,
    journeyType: 'ONE_WAY',
    connecting: true,
    paxCounts: v.pax,
    withSSR: false,
  }));

  const roundTripDirect = paxVariants.map((v) => generateFlightScenarioFolder({
    scenarioName: `RT / Direct / ${v.key}`,
    journeyType: 'ROUND_TRIP',
    connecting: false,
    paxCounts: v.pax,
    withSSR: false,
  }));

  const roundTripConnecting = paxVariants.map((v) => generateFlightScenarioFolder({
    scenarioName: `RT / Connecting (select connecting) / ${v.key}`,
    journeyType: 'ROUND_TRIP',
    connecting: true,
    paxCounts: v.pax,
    withSSR: false,
  }));

  const owSSR = generateFlightScenarioFolder({
    scenarioName: 'OW / Direct / SSR (1ADT seat+meal+baggage)',
    journeyType: 'ONE_WAY',
    connecting: false,
    paxCounts: { adults: 1, children: 0, infants: 0 },
    withSSR: true,
  });
  const rtSSR = generateFlightScenarioFolder({
    scenarioName: 'RT / Direct / SSR (1ADT seat+meal+baggage)',
    journeyType: 'ROUND_TRIP',
    connecting: false,
    paxCounts: { adults: 1, children: 0, infants: 0 },
    withSSR: true,
  });

  collection.item = [
    {
      name: '0. Partner Auth (required once)',
      description: 'Run with B2B Dev environment. Access Token → (optional Refresh) → User Auth. Product APIs use Bearer {{auth_token}}; wallet/debit APIs also need X-Partner-Key {{access_token}}.',
      item: [
        reqAuth({
          name: '01 Access Token',
          method: 'POST',
          pathParts: ['auth', 'partner', 'token'],
          body: { partner_id: '{{partner_id}}', partner_secret: '{{partner_secret}}' },
          testScript: [
            'const res = pm.response.json();',
            'pm.environment.set("access_token", res.access_token);',
            'pm.environment.set("refresh_token", res.refresh_token);',
            'pm.collectionVariables.set("access_token", res.access_token);',
            'pm.collectionVariables.set("refresh_token", res.refresh_token);',
          ],
          description: 'POST /auth/partner/token',
        }),
        reqAuth({
          name: '02 Refresh Token (optional)',
          method: 'POST',
          pathParts: ['auth', 'partner', 'refresh'],
          body: { refresh_token: '{{refresh_token}}' },
          testScript: [
            'const res = pm.response.json();',
            'pm.environment.set("access_token", res.access_token);',
            'if (res.refresh_token) pm.environment.set("refresh_token", res.refresh_token);',
            'pm.collectionVariables.set("access_token", res.access_token);',
          ],
          description: 'POST /auth/partner/refresh',
        }),
        reqAuth({
          name: '03 User Auth',
          method: 'POST',
          pathParts: ['v1', 'auth', 'session'],
          headersExtra: [{ key: 'X-Partner-Key', value: '{{access_token}}' }],
          rawBody: '{\n  "tierId": {{tier_id}}\n}\n',
          testScript: [
            'const res = pm.response.json();',
            'pm.environment.set("auth_token", res.auth_token);',
            'pm.collectionVariables.set("auth_token", res.auth_token);',
          ],
          description: 'POST /v1/auth/session — sets {{auth_token}}',
        }),
      ],
    },
    {
      name: '1. Reference data',
      item: [
        req({ name: '1.1 Airport Search', method: 'GET', pathParts: ['v1', 'flights', 'airports'], query: [...FLIGHT_QUERY, { key: 'airport', value: 'BOM' }, { key: 'page', value: '0' }, { key: 'perpage', value: '10' }] }),
        req({ name: '1.2 Airline Search', method: 'GET', pathParts: ['v1', 'flights', 'airlines'], query: [...FLIGHT_QUERY, { key: 'airline', value: 'AI' }, { key: 'page', value: '0' }, { key: 'perpage', value: '10' }] }),
        req({ name: '1.3 City Search', method: 'GET', pathParts: ['v1', 'flights', 'citySearch'], query: [...FLIGHT_QUERY, { key: 'q', value: 'Pune' }, { key: 'page', value: '0' }, { key: 'perpage', value: '10' }] }),
      ],
    },
    {
      name: '2. One-way scenarios',
      item: [
        { name: '2.A Direct', item: oneWayDirect },
        { name: '2.B Connecting (select connecting)', item: oneWayConnecting },
        { name: '2.C SSR seat+meal+baggage', item: [owSSR] },
      ],
    },
    {
      name: '3. Round-trip scenarios',
      item: [
        { name: '3.A Direct', item: roundTripDirect },
        { name: '3.B Connecting (select connecting)', item: roundTripConnecting },
        { name: '3.C SSR seat+meal+baggage', item: [rtSSR] },
      ],
    },
    {
      name: '4. Paxwise cancellation (after an issued booking)',
      item: generatePaxwiseCancellationItems(),
    },
  ];

  return collection;
}

function buildFlightsHotelsCollection() {
  const collection = buildFlightsOnlyCollection();
  collection.info.name = 'TravelVIP — Dynamic Flights + Hotels (OW/RT + connecting + multipax + paxwise cancel)';

  // Add hotel folder (basic booking + cancel).
  const hotelPax = [
    { key: '1ADT', pax: { adults: 1, children: 0, infants: 0 } },
    { key: '1ADT+1CHD', pax: { adults: 1, children: 1, infants: 0 } },
    { key: '2ADT', pax: { adults: 2, children: 0, infants: 0 } },
    { key: '1ADT+1CHD+1INF', pax: { adults: 1, children: 1, infants: 1 } },
  ];

  const hotelFolder = {
    name: '5. Hotels (basic booking + cancel)',
    item: [
      {
        name: '5.A Hotel booking scenarios',
        item: hotelPax.map((v) => generateHotelScenarioFolder({ name: `Hotel ${v.key}`, paxCounts: v.pax })),
      },
    ],
  };

  collection.item.push(hotelFolder);
  collection.item.push(buildCabScenariosFolder());
  collection.info.name = 'TravelVIP — Dynamic Flights + Hotels + Cabs';
  collection.info.description += '\n\nCab folder (6): AIRPORT DEPARTURE/ARRIVAL, OUTSTATION, RENTAL. Finalize + cancel need X-Partner-Key. Check extraKmRate (not extraKmFareLabel) on fare/status/detail.';
  return collection;
}

function main() {
  const flights = buildFlightsOnlyCollection();
  const flightsHotels = buildFlightsHotelsCollection();
  const cabs = buildCabsOnlyCollection();

  fs.mkdirSync(`${ROOT}\\postman`, { recursive: true });
  fs.writeFileSync(OUT_FLIGHTS, JSON.stringify(flights, null, 2), 'utf8');
  fs.writeFileSync(OUT_FLIGHTS_HOTELS, JSON.stringify(flightsHotels, null, 2), 'utf8');
  fs.writeFileSync(OUT_CABS, JSON.stringify(cabs, null, 2), 'utf8');

  // eslint-disable-next-line no-console
  console.log('Wrote:');
  // eslint-disable-next-line no-console
  console.log('-', OUT_FLIGHTS);
  // eslint-disable-next-line no-console
  console.log('-', OUT_FLIGHTS_HOTELS);
  // eslint-disable-next-line no-console
  console.log('-', OUT_CABS);
}

main();

