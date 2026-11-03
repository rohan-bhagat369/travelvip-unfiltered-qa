/**
 * Rebuilds folder "5. Cancel & Reschedule — easy run" as full linear flows:
 *   search → book → cancel (plain + with ancillaries) → reschedule
 * Also appends a short Reschedule block onto existing OW 1ADT + SSR folders.
 *
 *   node postman/scripts/add-flight-reschedule-folder.js
 */
import fs from 'fs';

const PATH = 'postman/TravelVIP-Dynamic-Flights.postman_collection.json';
const col = JSON.parse(fs.readFileSync(PATH, 'utf8'));

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

function findFolder(items, matchFn) {
  for (const it of items || []) {
    if (matchFn(it)) return it;
    if (it.item) {
      const hit = findFolder(it.item, matchFn);
      if (hit) return hit;
    }
  }
  return null;
}

function rename(req, name) {
  const r = deepClone(req);
  r.name = name;
  return r;
}

function byName(folder, substr) {
  return (folder.item || []).find((x) => String(x.name || '').includes(substr));
}

const signPre = [
  'const timestamp = Math.floor(Date.now() / 1000).toString();',
  'let body = "";',
  'if (pm.request.body && pm.request.body.mode === "raw" && pm.request.body.raw) {',
  '  body = String(pm.request.body.raw);',
  '}',
  'body = pm.variables.replaceIn(body);',
  'if (pm.request.body && pm.request.body.mode === "raw") {',
  '  pm.request.body.raw = body;',
  '}',
  'const signingKey = pm.environment.get("signing_key") || pm.collectionVariables.get("signing_key") || pm.variables.get("signing_key") || "";',
  'const signature = CryptoJS.HmacSHA256(body + timestamp, signingKey).toString(CryptoJS.enc.Hex);',
  'pm.environment.set("timestamp", timestamp);',
  'pm.environment.set("signature", signature);',
  'pm.variables.set("request_id", "req-" + Date.now());',
];

const corrTest = [
  'try {',
  '  const response = pm.response.json();',
  '  if (response._meta && response._meta.correlation_id) {',
  '    pm.environment.set("correlation_id", response._meta.correlation_id);',
  '  }',
  '} catch (e) {}',
];

const hdrs = [
  { key: 'Authorization', value: 'Bearer {{auth_token}}' },
  { key: 'X-Request-Id', value: '{{request_id}}' },
  { key: 'X-Timestamp', value: '{{timestamp}}' },
  { key: 'X-Signature', value: '{{signature}}' },
  { key: 'X-Correlation-ID', value: '{{correlation_id}}' },
  { key: 'X-Partner-Key', value: '{{access_token}}' },
  { key: 'Content-Type', value: 'application/json' },
];

function makeReq(name, method, url, rawBody, description, tests = [], pre = []) {
  return {
    name,
    event: [
      { listen: 'prerequest', script: { type: 'text/javascript', exec: [...pre, ...signPre] } },
      { listen: 'test', script: { type: 'text/javascript', exec: [...corrTest, ...tests] } },
    ],
    request: {
      auth: { type: 'noauth' },
      method,
      header: hdrs,
      url,
      description,
      ...(rawBody
        ? { body: { mode: 'raw', raw: rawBody, options: { raw: { language: 'json' } } } }
        : {}),
    },
    response: [],
  };
}

const owSrc = findFolder(
  col.item,
  (it) =>
    it.name === 'OW / Direct / 1ADT' ||
    (String(it.name || '').includes('OW / Direct / 1ADT') &&
      !String(it.name).includes('CHD') &&
      !String(it.name).includes('INF') &&
      !String(it.name).includes('SSR') &&
      Array.isArray(it.item) &&
      it.item.length >= 8),
);

const ssrSrc = findFolder(
  col.item,
  (it) =>
    String(it.name || '').includes('OW / Direct / SSR (1ADT') && Array.isArray(it.item) && it.item.length >= 10,
);

if (!owSrc || !ssrSrc) {
  console.error('Could not find source folders', { ow: Boolean(owSrc), ssr: Boolean(ssrSrc) });
  process.exit(1);
}

function bookThroughHistory(src, { withSsr }) {
  const steps = [];
  const map = withSsr
    ? [
        ['01 Search', '1. Flight Search'],
        ['02 Details', '2. Flight Details'],
        ['03 Fare Rules', '3. Flight Fare Rules'],
        ['04 Pricing', '4. Flight Pricing'],
        ['05 SSR catalog (meal/bag)', '5. Flight SSR'],
        ['06 SeatMap', '6. Flight SeatMap'],
        ['07 Issue Ticket (with ancillaries if vars set)', '7. Issue Ticket'],
        ['08 Booking Status (poll until Confirmed)', '8. Booking Status'],
        ['09 Booking Detail (saves PNR)', '9. Booking Detail'],
        ['10 Booking History', '10. Booking History'],
      ]
    : [
        ['01 Search', '1. Flight Search'],
        ['02 Details', '2. Flight Details'],
        ['03 Fare Rules', '3. Flight Fare Rules'],
        ['04 Pricing', '4. Flight Pricing'],
        ['05 Issue Ticket', '5. Issue Ticket'],
        ['06 Booking Status (poll until Confirmed)', '6. Booking Status'],
        ['07 Booking Detail (saves PNR)', '7. Booking Detail'],
        ['08 Booking History', '8. Booking History'],
      ];

  for (const [newName, oldSub] of map) {
    const old = byName(src, oldSub);
    if (!old) throw new Error(`Missing request containing "${oldSub}" in ${src.name}`);
    steps.push(rename(old, newName));
  }
  return steps;
}

function cancelBlock({ labelPrefix = '11' } = {}) {
  // Simple path: penalty → v2 cancel full → status. Avoid v1+v2 double cancel confusion.
  const penalty = byName(owSrc, 'C1. Penalty — full PNR');
  const cancelV2 = byName(owSrc, 'C3. Cancel v2 — full PNR');
  const status = byName(owSrc, 'C4. Status after cancel');
  if (!penalty || !cancelV2 || !status) throw new Error('Missing cancel templates on OW 1ADT');

  const n1 = Number(labelPrefix);
  return [
    rename(penalty, `${String(n1).padStart(2, '0')} Penalty quote (status stays Confirmed)`),
    rename(cancelV2, `${String(n1 + 1).padStart(2, '0')} Cancel v2 — full PNR`),
    rename(status, `${String(n1 + 2).padStart(2, '0')} Status after cancel`),
    makeReq(
      `${String(n1 + 3).padStart(2, '0')} Repeat cancel (expect already cancelled / in progress)`,
      'POST',
      '{{base_url}}/api/v2/flight/cancel?lang=en&currency=INR',
      `{
  "bookingId": "{{flight_booking_reference}}",
  "action": "CANCEL",
  "pnr": "{{flight_pnr}}",
  "cancellationReason": "repeat cancel check",
  "cancelledBy": "USER"
}
`,
      'Expect 4xx BOOKING_ALREADY_CANCELLED or CANCELLATION_ALREADY_IN_PROGRESS.',
      [
        'pm.test("4xx business error (not 500)", function () {',
        '  let j={}; try{j=pm.response.json();}catch(e){}',
        '  pm.expect(pm.response.code).to.be.at.least(400);',
        '  pm.expect(pm.response.code).to.be.below(500);',
        '});',
      ],
    ),
  ];
}

function rescheduleBlock({ startAt = 15 } = {}) {
  const s = (i) => String(startAt + i).padStart(2, '0');
  return [
    makeReq(
      `${s(0)} Reschedule — Search new date (NORMAL)`,
      'POST',
      '{{base_url}}/v1/flights/search?lang=en&currency=INR&page=0&perpage=20',
      `{
  "itinerary": [{ "origin": "DEL", "destination": "BOM", "date": "2026-11-20" }],
  "travellers": { "adults": 1, "children": 0, "infants": 0 },
  "cabinClass": "ECONOMY",
  "journeyType": "ONE_WAY",
  "currency": "INR",
  "language": "en",
  "preferences": { "airlines": [], "maxStops": 0, "refundableOnly": false },
  "appliedFilters": {},
  "selection": { "selectedSearchIds": [] },
  "fareType": "NORMAL"
}
`,
      'Run AFTER cancel. Saves flight_reschedule_search_id. Re-send if options empty.',
      [
        'let j={}; try{j=pm.response.json();}catch(e){}',
        'const block=(j.results||[]).find(r=>String(r.direction||"").toUpperCase()==="ONWARD")||(j.results||[])[0]||{};',
        'const opt=(block.options||[])[0];',
        'if(opt&&opt.searchId){ pm.environment.set("flight_reschedule_search_id", opt.searchId); pm.collectionVariables.set("flight_reschedule_search_id", opt.searchId); }',
        'pm.test("search 200", function(){ pm.expect(pm.response.code).to.eql(200); });',
      ],
      [
        'pm.collectionVariables.set("pax_last_tag", String(Date.now()).slice(-6));',
        'pm.environment.set("pax_last_tag", String(Date.now()).slice(-6));',
      ],
    ),
    makeReq(
      `${s(1)} Reschedule — Pricing`,
      'POST',
      '{{base_url}}/v1/flights/pricing?lang=en&currency=INR',
      `{
  "journeyType": "ONE_WAY",
  "selection": { "selectedSearchIds": ["{{flight_reschedule_search_id}}"] }
}
`,
      'Saves flight_reschedule_price_id + flight_reschedule_booking_context',
      [
        'let j={}; try{j=pm.response.json();}catch(e){}',
        'if(j.priceId){ pm.environment.set("flight_reschedule_price_id", j.priceId); pm.collectionVariables.set("flight_reschedule_price_id", j.priceId); }',
        'if(j.bookingContext){ pm.environment.set("flight_reschedule_booking_context", j.bookingContext); pm.collectionVariables.set("flight_reschedule_booking_context", j.bookingContext); }',
        'pm.test("got priceId + bookingContext", function(){ pm.expect(Boolean(j.priceId && j.bookingContext)).to.be.true; });',
      ],
    ),
    makeReq(
      `${s(2)} Reschedule — Issue ticket (BOTH old BR + old PNR)`,
      'POST',
      '{{base_url}}/api/v2/flights/booking/issue-ticket?pid=vgm&clientCode=default-smt&platform=web&lang=en&currency=INR&count=10&page=0&perpage=20',
      `{
  "type": "ticket",
  "currency": "INR",
  "language": "en",
  "bookingReference": "{{flight_reschedule_booking_context}}",
  "searchIds": ["{{flight_reschedule_search_id}}"],
  "journeyType": "ONE_WAY",
  "timezone": "Asia/Calcutta",
  "reschedulingReferenceId": "{{flight_booking_reference}}",
  "reschedulingPnr": "{{flight_pnr}}",
  "data": {
    "priceId": "{{flight_reschedule_price_id}}",
    "passportType": "NONE",
    "includeGst": false,
    "gstDetails": null,
    "contact": { "email": "qa@travelvip.ai", "mobile": "9921862715", "countryCode": "+91" },
    "passengers": [{
      "paxId": "PAX1",
      "type": "ADT",
      "isLead": true,
      "title": "Mr",
      "firstName": "Rohan",
      "lastName": "BhagatRs{{pax_last_tag}}",
      "gender": "Male",
      "dob": "1990-01-15",
      "nationality": "IN",
      "ssr": { "meals": [], "baggage": [], "seats": [] }
    }]
  }
}
`,
      'MUST send BOTH reschedulingReferenceId (old BR) and reschedulingPnr (old PNR). LIVE book — saves flight_reschedule_booking_reference.',
      [
        'let j={}; try{j=pm.response.json();}catch(e){}',
        'const br=j.bookingReference||j.bookingReferenceId||(j.data&&j.data.bookingReference);',
        'if(br){ pm.environment.set("flight_reschedule_booking_reference", br); pm.collectionVariables.set("flight_reschedule_booking_reference", br); }',
        'pm.test("not 500", function(){ pm.expect(pm.response.code).to.be.below(500); });',
        'pm.test("got new BR on success", function(){ if(pm.response.code===200) pm.expect(Boolean(br)).to.be.true; });',
      ],
    ),
    makeReq(
      `${s(3)} Reschedule — Status (new BR)`,
      'GET',
      '{{base_url}}/v1/flights/booking/{{flight_reschedule_booking_reference}}/status?lang=en&currency=INR',
      null,
      'Poll until Confirmed / Inprogress / Failed / Cancelled',
      [
        'let j={}; try{j=pm.response.json();}catch(e){}',
        'pm.environment.set("flight_reschedule_booking_status", j.status||"");',
        'pm.test("status present", function(){ pm.expect(String(j.status||"").length).to.be.above(0); });',
      ],
    ),
    makeReq(
      `${s(4)} Reschedule — Detail (new BR)`,
      'GET',
      '{{base_url}}/v1/flights/booking/{{flight_reschedule_booking_reference}}?lang=en&currency=INR',
      null,
      'Check new PNR / itinerary',
      ['pm.test("detail 200", function(){ pm.expect(pm.response.code).to.eql(200); });'],
    ),
  ];
}

function negBlock() {
  return [
    makeReq(
      'N1 Cancel — missing bookingId → VALIDATION_ERROR',
      'POST',
      '{{base_url}}/api/v2/flight/cancel?lang=en&currency=INR',
      '{\n  "action": "CANCEL",\n  "pnr": "ABCDEF",\n  "cancelledBy": "USER",\n  "cancellationReason": "neg"\n}\n',
      'No live book needed.',
      [
        'pm.test("VALIDATION_ERROR", function(){ let j={}; try{j=pm.response.json();}catch(e){} pm.expect(pm.response.code).to.eql(400); pm.expect(j.error&&j.error.code).to.eql("VALIDATION_ERROR"); });',
      ],
    ),
    makeReq(
      'N2 Cancel — fake BR → 4xx',
      'POST',
      '{{base_url}}/api/v2/flight/cancel?lang=en&currency=INR',
      '{\n  "bookingId": "BR0000000000000001",\n  "action": "CANCEL",\n  "pnr": "ABCDEF",\n  "cancelledBy": "USER",\n  "cancellationReason": "neg"\n}\n',
      'Expect BOOKING_NOT_FOUND (or 4xx).',
      [
        'pm.test("4xx", function(){ pm.expect(pm.response.code).to.be.at.least(400); pm.expect(pm.response.code).to.be.below(500); });',
      ],
    ),
    makeReq(
      'N3 Reschedule — only reschedulingReferenceId → VALIDATION_ERROR',
      'POST',
      '{{base_url}}/api/v2/flights/booking/issue-ticket?pid=vgm&clientCode=default-smt&platform=web&lang=en&currency=INR&count=10&page=0&perpage=20',
      `{
  "type": "ticket",
  "currency": "INR",
  "language": "en",
  "bookingReference": "{{flight_reschedule_booking_context}}",
  "searchIds": ["{{flight_reschedule_search_id}}"],
  "journeyType": "ONE_WAY",
  "timezone": "Asia/Calcutta",
  "reschedulingReferenceId": "{{flight_booking_reference}}",
  "reschedulingPnr": null,
  "data": {
    "priceId": "{{flight_reschedule_price_id}}",
    "passportType": "NONE",
    "includeGst": false,
    "gstDetails": null,
    "contact": { "email": "qa@travelvip.ai", "mobile": "9921862715", "countryCode": "+91" },
    "passengers": [{
      "paxId": "PAX1", "type": "ADT", "isLead": true, "title": "Mr",
      "firstName": "Rohan", "lastName": "Neg{{pax_last_tag}}", "gender": "Male",
      "dob": "1990-01-15", "nationality": "IN",
      "ssr": { "meals": [], "baggage": [], "seats": [] }
    }]
  }
}
`,
      'Run after a Flow has filled flight_reschedule_* vars (or run Flow C steps 15–16 first). Both fields required.',
      [
        'pm.test("VALIDATION_ERROR", function(){ let j={}; try{j=pm.response.json();}catch(e){} pm.expect(pm.response.code).to.eql(400); pm.expect(j.error&&j.error.code).to.eql("VALIDATION_ERROR"); });',
      ],
    ),
    makeReq(
      'N4 Reschedule — only reschedulingPnr → VALIDATION_ERROR',
      'POST',
      '{{base_url}}/api/v2/flights/booking/issue-ticket?pid=vgm&clientCode=default-smt&platform=web&lang=en&currency=INR&count=10&page=0&perpage=20',
      `{
  "type": "ticket",
  "currency": "INR",
  "language": "en",
  "bookingReference": "{{flight_reschedule_booking_context}}",
  "searchIds": ["{{flight_reschedule_search_id}}"],
  "journeyType": "ONE_WAY",
  "timezone": "Asia/Calcutta",
  "reschedulingReferenceId": null,
  "reschedulingPnr": "{{flight_pnr}}",
  "data": {
    "priceId": "{{flight_reschedule_price_id}}",
    "passportType": "NONE",
    "includeGst": false,
    "gstDetails": null,
    "contact": { "email": "qa@travelvip.ai", "mobile": "9921862715", "countryCode": "+91" },
    "passengers": [{
      "paxId": "PAX1", "type": "ADT", "isLead": true, "title": "Mr",
      "firstName": "Rohan", "lastName": "Neg{{pax_last_tag}}", "gender": "Male",
      "dob": "1990-01-15", "nationality": "IN",
      "ssr": { "meals": [], "baggage": [], "seats": [] }
    }]
  }
}
`,
      'Must not create a normal book.',
      [
        'pm.test("VALIDATION_ERROR", function(){ let j={}; try{j=pm.response.json();}catch(e){} pm.expect(pm.response.code).to.eql(400); pm.expect(j.error&&j.error.code).to.eql("VALIDATION_ERROR"); });',
      ],
    ),
  ];
}

// --- Build easy-run folder 5 ---
const flowA = {
  name: 'A. Cancel only — OW 1ADT (search → book → cancel)',
  description:
    'Run top → bottom after Auth (folder 0).\n' +
    'Creates a live ticket, then penalty + v2 cancel.\n' +
    'STOP after 08 if you only want a Confirmed book (no cancel).',
  item: [...bookThroughHistory(owSrc, { withSsr: false }), ...cancelBlock({ labelPrefix: '09' })],
};

const flowB = {
  name: 'B. Cancel with ancillaries — OW 1ADT + seat/meal/bag',
  description:
    'Same as A, but books with SSR/seat when catalog vars are filled.\n' +
    'Run top → bottom after Auth.\n' +
    'If SSR/seat vars empty, issue-ticket still books without ancillaries.',
  item: [...bookThroughHistory(ssrSrc, { withSsr: true }), ...cancelBlock({ labelPrefix: '11' })],
};

const flowC = {
  name: 'C. Reschedule — OW 1ADT (book → cancel → rebook with reschedule fields)',
  description:
    'Full chain:\n' +
    '01–08 book → 09–12 cancel → 13–17 search/price/issue with BOTH reschedulingReferenceId + reschedulingPnr → status/detail.\n' +
    'LIVE: two tickets (original + rescheduled).',
  item: [
    ...bookThroughHistory(owSrc, { withSsr: false }),
    ...cancelBlock({ labelPrefix: '09' }),
    ...rescheduleBlock({ startAt: 13 }),
  ],
};

const flowD = {
  name: 'D. Negatives (optional)',
  description:
    'No happy-path book required for N1–N2.\n' +
    'N3–N4 need flight_reschedule_* vars (run Flow C steps 13–14 first, or any pricing).',
  item: negBlock(),
};

const folder5 = {
  name: '5. Cancel & Reschedule — easy run',
  description:
    'Simple staging flows. Run Auth (folder 0) first.\n\n' +
    '• **A** — search → book → cancel (no SSR)\n' +
    '• **B** — search → SSR/seat → book → cancel (with ancillaries)\n' +
    '• **C** — search → book → cancel → reschedule (both old BR + PNR)\n' +
    '• **D** — negatives only\n\n' +
    'Reschedule rule: issue-ticket must include **both** `reschedulingReferenceId` and `reschedulingPnr`, or neither.\n' +
    'WARNING: A/B/C create live bookings and spend wallet.',
  item: [flowA, flowB, flowC, flowD],
};

const idx5 = (col.item || []).findIndex((x) => /^5\./.test(String(x.name || '')));
if (idx5 >= 0) col.item[idx5] = folder5;
else col.item.push(folder5);

// --- Append reschedule onto existing OW 1ADT + SSR (keep their cancels, add RS steps) ---
function appendRescheduleIfMissing(folder, startAt) {
  const has = (folder.item || []).some((x) => /Reschedule — Search/i.test(String(x.name || '')));
  if (has) return false;
  folder.item.push(...rescheduleBlock({ startAt }));
  folder.description = `${folder.description || ''}\n\nAfter cancel (C4), optional **Reschedule** steps: search → price → issue with BOTH reschedulingReferenceId + reschedulingPnr → status/detail.`.trim();
  return true;
}

appendRescheduleIfMissing(owSrc, 15);
appendRescheduleIfMissing(ssrSrc, 17);

// Ensure collection vars
const needVars = [
  'flight_reschedule_search_id',
  'flight_reschedule_price_id',
  'flight_reschedule_booking_context',
  'flight_reschedule_booking_reference',
  'flight_reschedule_booking_status',
];
col.variable = col.variable || [];
for (const key of needVars) {
  if (!col.variable.some((v) => v.key === key)) col.variable.push({ key, value: '' });
}

if (col.info) {
  col.info.description = String(col.info.description || '')
    .replace(/\n\nFolder \*\*5\.[\s\S]*$/, '')
    .concat(
      '\n\n**Folder 5 — Cancel & Reschedule (easy run):** A cancel-only · B cancel+ancillaries · C full reschedule · D negatives. Also appended Reschedule steps on OW Direct 1ADT and OW SSR folders after cancel.',
    );
}

fs.writeFileSync(PATH, JSON.stringify(col, null, 2));

console.log('Updated', PATH);
console.log('Folder 5:');
for (const f of folder5.item) {
  console.log(`  ${f.name} (${f.item.length} requests)`);
  console.log('   ', f.item.map((r) => r.name).join(' → '));
}
console.log('Appended reschedule to existing OW 1ADT + SSR:', {
  owHas: owSrc.item.some((x) => /Reschedule — Search/i.test(x.name)),
  ssrHas: ssrSrc.item.some((x) => /Reschedule — Search/i.test(x.name)),
});
