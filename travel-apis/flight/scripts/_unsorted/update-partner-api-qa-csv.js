/**
 * Update Partner API Testing CSV with QA Status + Curl for open issues.
 */
import fs from 'fs';

const inputPath = 'Partner API Testing - DM.csv';
const outputPath = 'Partner API Testing - DM.csv';

const ISSUE_BASE = `curl -X POST "{{BASE_URL}}/v1/flights/booking/issue-ticket?pid=smt&key=palsgcvgscvvs&clientCode=default-smt&platform=web&lang=en&currency=INR" -H "Content-Type: application/json" -H "Authorization: Bearer {{AUTH_TOKEN}}" -H "X-Partner-Key: {{ACCESS_TOKEN}}" -H "X-Request-Id: req-qa-{{ID}}" -H "X-Timestamp: {{TS}}" -H "X-Signature: {{SIG}}" -H "X-Correlation-ID: {{UUID}}" --data '{{BODY}}'`;

function issueCurl(id, bodyObj) {
  const body = JSON.stringify(bodyObj);
  return ISSUE_BASE.replace('{{ID}}', id).replace('{{BODY}}', body.replace(/'/g, "'\\''"));
}

const basePassenger = {
  paxId: 'PAX1',
  type: 'adult',
  isLead: true,
  profile: {
    title: 'Mr',
    firstName: 'Rohan',
    lastName: 'Bhagat',
    gender: 'Male',
    dob: '2001-05-29',
    nationality: 'IN',
  },
  city: { cityCode: 'Pune', cityName: 'Pune' },
  passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
  ssr: { baggage: [], meals: [], seats: [] },
};

function issueBody(overrides = {}) {
  const data = {
    priceId: overrides.priceId || '{{PRICE_ID}}',
    passportType: 'NONE',
    includeGst: false,
    gstDetails: null,
    contact: {
      email: overrides.email || 'rohan@travelvip.ai',
      mobile: overrides.mobile || '9876543210',
      countryCode: '+91',
    },
    passengers: [
      {
        ...basePassenger,
        profile: {
          ...basePassenger.profile,
          ...(overrides.profile || {}),
        },
      },
    ],
  };
  return {
    type: 'ticket',
    currency: 'INR',
    language: 'en',
    bookingReference: overrides.bookingReference || '{{PRICING_BOOKING_CONTEXT}}',
    searchIds: overrides.searchIds || ['{{SEARCH_ID}}'],
    journeyType: overrides.journeyType || 'ONE_WAY',
    timezone: 'Asia/Calcutta',
    data,
  };
}

const SEARCH_HDR = `curl -X POST "{{BASE_URL}}/v1/flights/search?lang=en&currency=INR&page=0&perpage=5" -H "Content-Type: text/plain" -H "Accept: application/xml" -H "Authorization: Bearer {{AUTH_TOKEN}}" -H "X-Request-Id: req-qa-hdr" -H "X-Timestamp: {{TS}}" -H "X-Signature: {{SIG}}" -H "X-Correlation-ID: {{UUID}}" --data '{"itinerary":[{"origin":"DEL","destination":"BOM","date":"2026-08-30"}],"travellers":{"adults":1,"children":0,"infants":0},"cabinClass":"ECONOMY","journeyType":"ONE_WAY","currency":"INR","language":"en","preferences":{"airlines":[],"maxStops":0,"refundableOnly":false},"appliedFilters":{},"selection":{"selectedSearchIds":[]},"fareType":"NORMAL"}'`;

const RT_CORP = `curl -X POST "{{BASE_URL}}/v1/flights/search?lang=en&currency=INR" -H "Content-Type: application/json" -H "Authorization: Bearer {{AUTH_TOKEN}}" -H "X-Request-Id: req-qa-rt-corp" -H "X-Timestamp: {{TS}}" -H "X-Signature: {{SIG}}" -H "X-Correlation-ID: {{UUID}}" --data '{"itinerary":[{"origin":"DEL","destination":"BOM","date":"2026-08-30"},{"origin":"BOM","destination":"DEL","date":"2026-09-06"}],"travellers":{"adults":1,"children":0,"infants":0},"cabinClass":"ECONOMY","journeyType":"ROUND_TRIP","currency":"INR","language":"en","preferences":{"airlines":[],"maxStops":null,"refundableOnly":false},"appliedFilters":{},"selection":{"selectedSearchIds":[]},"fareType":"CORPORATE"}'`;

const RT_EARLY = `Step1 search RT NORMAL then immediately: curl -X POST "{{BASE_URL}}/v1/flights/search?lang=en&currency=INR" -H "Content-Type: application/json" -H "Authorization: Bearer {{AUTH_TOKEN}}" -H "X-Request-Id: req-qa-rt-early" -H "X-Timestamp: {{TS}}" -H "X-Signature: {{SIG}}" -H "X-Correlation-ID: {{UUID}}" --data '{"itinerary":[{"origin":"DEL","destination":"BOM","date":"2026-08-30"},{"origin":"BOM","destination":"DEL","date":"2026-09-06"}],"travellers":{"adults":1,"children":0,"infants":0},"cabinClass":"ECONOMY","journeyType":"ROUND_TRIP","currency":"INR","language":"en","preferences":{"airlines":[],"maxStops":null,"refundableOnly":false},"appliedFilters":{},"selection":{"selectedSearchIds":["{{ONWARD_SEARCH_ID}}"]},"fareType":"NORMAL"}'`;

const SEATMAP = `curl -X POST "{{BASE_URL}}/v1/flights/seatmap?lang=en&currency=INR" -H "Content-Type: application/json" -H "Authorization: Bearer {{AUTH_TOKEN}}" -H "X-Request-Id: req-qa-seat" -H "X-Timestamp: {{TS}}" -H "X-Signature: {{SIG}}" -H "X-Correlation-ID: {{UUID}}" --data '{"currency":"INR","requestReference":"{{PRICING_BOOKING_CONTEXT}}","passengers":[{"type":"adult","title":"Mr","firstName":"Rohan","lastName":"Bhagat"}]}'`;

const STATUS = `curl -X GET "{{BASE_URL}}/v1/flights/booking/{{BOOKING_REF}}/status?lang=en&currency=INR" -H "Authorization: Bearer {{AUTH_TOKEN}}" -H "X-Request-Id: req-qa-status" -H "X-Timestamp: {{TS}}" -H "X-Signature: {{SIG}}" -H "X-Correlation-ID: {{UUID}}"`;

const CANCEL_PENALTY = `curl -X POST "{{BASE_URL}}/v1/flights/booking/{{BOOKING_REF}}/cancel?lang=en&currency=INR" -H "Content-Type: application/json" -H "Authorization: Bearer {{AUTH_TOKEN}}" -H "X-Partner-Key: {{ACCESS_TOKEN}}" -H "X-Request-Id: req-qa-cancel" -H "X-Timestamp: {{TS}}" -H "X-Signature: {{SIG}}" -H "X-Correlation-ID: {{UUID}}" --data '{}'`;

const OW_CORP = `curl -X POST "{{BASE_URL}}/v1/flights/search?lang=en&currency=INR" -H "Content-Type: application/json" -H "Authorization: Bearer {{AUTH_TOKEN}}" -H "X-Request-Id: req-qa-ow-corp" -H "X-Timestamp: {{TS}}" -H "X-Signature: {{SIG}}" -H "X-Correlation-ID: {{UUID}}" --data '{"itinerary":[{"origin":"DEL","destination":"BOM","date":"2026-08-30"}],"travellers":{"adults":1,"children":0,"infants":0},"cabinClass":"ECONOMY","journeyType":"ONE_WAY","currency":"INR","language":"en","preferences":{"airlines":[],"maxStops":0,"refundableOnly":false},"appliedFilters":{},"selection":{"selectedSearchIds":[]},"fareType":"CORPORATE"}'`;

// Sr No -> { qaStatus, curl, qaNotes }
const updates = {
  1: { qaStatus: 'Done', curl: '', qaNotes: 'Re-verified 2026-07-16: HTTP 401 Invalid signature' },
  2: { qaStatus: 'Done', curl: '', qaNotes: 'Re-verified 2026-07-16: HTTP 401 Request timestamp out of window' },
  3: { qaStatus: 'Done', curl: '', qaNotes: 'Re-verified 2026-07-16: HTTP 400 Invalid tierId' },
  4: { qaStatus: 'Done', curl: '', qaNotes: 'Re-verified 2026-07-16: HTTP 400 Invalid tierId' },
  5: {
    qaStatus: 'Not Fixed',
    curl: SEARCH_HDR,
    qaNotes: 'Re-verified 2026-07-16: still HTTP 200 with Content-Type text/plain + Accept application/xml',
  },
  6: {
    qaStatus: 'Done',
    curl: '',
    qaNotes: 'Re-verified 2026-07-16: missing X-Request-Id → HTTP 400; empty X-Request-Id → HTTP 400',
  },
  7: { qaStatus: 'Done', curl: '', qaNotes: 'Re-verified 2026-07-16: currency=USD returns USD in response' },
  8: {
    qaStatus: 'Not Fixed',
    curl: RT_CORP,
    qaNotes: 'Re-verified 2026-07-16: CORPORATE RT does not complete; NORMAL RT works',
  },
  9: {
    qaStatus: 'Not Fixed',
    curl: RT_EARLY,
    qaNotes: 'Early select still problematic; latest run returned HTTP 400 INVALID_SELECTION (ROUND_TRIP requires exactly 2 selectedSearchIds) instead of old SEARCH_CACHE_MISS 502 — needs product/docs clarity on 2-step RT flow',
  },
  10: { qaStatus: 'Done', curl: '', qaNotes: 'Re-verified 2026-07-16: HTTP 400 Invalid request payload' },
  11: {
    qaStatus: 'Not Fixed',
    curl: SEATMAP,
    qaNotes: 'Not conclusively closed — needs fare where seats are NOT allowed; use requestReference from pricing',
  },
  12: { qaStatus: 'Done', curl: '', qaNotes: 'Re-verified 2026-07-16: supportsSeats=true returned segments=1' },
  13: {
    qaStatus: 'Not Fixed',
    curl: SEATMAP,
    qaNotes: 'Intermittent vendor 502 — not reproduced every run; keep monitoring with seatmap curl',
  },
  14: {
    qaStatus: 'Not Fixed',
    curl: issueCurl(14, issueBody({ priceId: 'price_invalid_price_id_000' })),
    qaNotes: 'Re-verified 2026-07-16: HTTP 200 pending + new BR (e.g. BR1784199932175530)',
  },
  15: {
    qaStatus: 'Not Fixed',
    curl: issueCurl(15, issueBody({ bookingReference: 'invalid-booking-context-token' })),
    qaNotes: 'Re-verified 2026-07-16: HTTP 200 pending + new BR',
  },
  16: {
    qaStatus: 'Not Fixed',
    curl: issueCurl(16, issueBody({ bookingReference: 'BR0000000000001' })),
    qaNotes: 'Re-verified 2026-07-16: HTTP 200 pending + new BR',
  },
  17: {
    qaStatus: 'Not Fixed',
    curl: issueCurl(17, issueBody({ profile: { lastName: 'Test123' } })),
    qaNotes: 'Re-verified 2026-07-16: HTTP 200 pending + new BR',
  },
  18: {
    qaStatus: 'Not Fixed',
    curl: issueCurl(18, issueBody({ profile: { lastName: '' } })),
    qaNotes: 'Re-verified 2026-07-16: HTTP 200 pending + new BR',
  },
  19: {
    qaStatus: 'Not Fixed',
    curl: issueCurl(19, issueBody({ email: 'not-an-email' })),
    qaNotes: 'Re-verified 2026-07-16: HTTP 200 pending + new BR',
  },
  20: { qaStatus: 'Done', curl: '', qaNotes: 'Re-verified 2026-07-16: HTTP 400 Validation failed' },
  21: {
    qaStatus: 'Not Fixed',
    curl: issueCurl(21, issueBody({ profile: { dob: 'invalid' } })),
    qaNotes: 'Re-verified 2026-07-16: HTTP 200 pending + new BR',
  },
  22: {
    qaStatus: 'Not Fixed',
    curl: issueCurl(22, issueBody({ journeyType: 'ROUND_TRIP', searchIds: ['{{ONE_WAY_SEARCH_ID}}'] })),
    qaNotes: 'Re-verified 2026-07-16: still HTTP 500 PRICING_FETCH_FAILED (should be 400)',
  },
  23: {
    qaStatus: 'Not Fixed',
    curl: 'Pricing response field: bookingContext | Issue-ticket request field for same token: bookingReference — standardize naming. Example issue-ticket body uses "bookingReference":"<token from pricing.bookingContext>"',
    qaNotes: 'Contract inconsistency still present 2026-07-16',
  },
  24: { qaStatus: 'Done', curl: '', qaNotes: 'Re-verified 2026-07-16: HTTP 400 Validation failed for empty passport on intl' },
  25: {
    qaStatus: 'Not Fixed',
    curl: 'See rows 14-19 and 21 curls — each invalid field still creates a new pending BR',
    qaNotes: 'Umbrella issue still open 2026-07-16',
  },
  26: {
    qaStatus: 'Not Fixed',
    curl: issueCurl(26, issueBody({ priceId: 'price_invalid_price_id_000' })),
    qaNotes: 'Invalid requests still create pending BRs that linger — related to rows 14-19',
  },
  27: {
    qaStatus: 'Not Fixed',
    curl: `${issueCurl(27, issueBody({ priceId: 'price_invalid_price_id_000' }))} then poll: ${STATUS}`,
    qaNotes: 'Issue-ticket still returns 200 pending; provider error only after status poll',
  },
  28: {
    qaStatus: 'Not Fixed',
    curl: STATUS,
    qaNotes: 'Not re-closed in latest run — check status casing on a real BR',
  },
  29: {
    qaStatus: 'Not Fixed',
    curl: STATUS,
    qaNotes: 'Not re-closed in latest run — verify summary.totalPassengers on confirmed/pending BR',
  },
  30: {
    qaStatus: 'Not Fixed',
    curl: STATUS,
    qaNotes: 'Intermittent staging/vendor latency — monitor confirmation SLA',
  },
  31: {
    qaStatus: 'Not Fixed',
    curl: STATUS,
    qaNotes: 'Not re-closed — check failed booking for top-level vs nested error',
  },
  32: {
    qaStatus: 'Not Fixed',
    curl: CANCEL_PENALTY,
    qaNotes: 'Not re-closed — inspect response for penalityAmount vs penaltyAmount typo',
  },
  33: {
    qaStatus: 'Not Fixed',
    curl: `${OW_CORP} | RT CORPORATE: ${RT_CORP}`,
    qaNotes: 'RT CORPORATE still unreliable; OW CORPORATE intermittent incomplete on some runs; NORMAL RT OK',
  },
  34: {
    qaStatus: 'Not Fixed',
    curl: RT_EARLY,
    qaNotes: '2-step RT flow still required / undocumented — integrators must select onward then search return',
  },
};

function escapeCsv(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const raw = fs.readFileSync(inputPath, 'utf8');
const lines = raw.split(/\r?\n/).filter((l, idx, arr) => !(idx === arr.length - 1 && l.trim() === ''));

// Parse header - simple CSV with quoted fields
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQ = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

const header = parseCsvLine(lines[0]);
const srIdx = header.indexOf('Sr No');

const newHeader = [...header];
if (!newHeader.includes('QA Status')) newHeader.push('QA Status');
if (!newHeader.includes('Curl (Not Fixed)')) newHeader.push('Curl (Not Fixed)');
if (!newHeader.includes('QA Notes')) newHeader.push('QA Notes');

const outLines = [newHeader.map(escapeCsv).join(',')];

for (let i = 1; i < lines.length; i++) {
  if (!lines[i].trim()) continue;
  const cols = parseCsvLine(lines[i]);
  const sr = Number(cols[srIdx]);
  if (!sr || !updates[sr]) {
    // empty trailing row
    if (cols.every((c) => !c.trim())) continue;
    while (cols.length < newHeader.length) cols.push('');
    outLines.push(cols.map(escapeCsv).join(','));
    continue;
  }
  const u = updates[sr];
  // ensure base columns length matches original header
  while (cols.length < header.length) cols.push('');
  const row = cols.slice(0, header.length);
  row.push(u.qaStatus, u.curl || '', u.qaNotes || '');
  outLines.push(row.map(escapeCsv).join(','));
}

fs.writeFileSync(outputPath, outLines.join('\n') + '\n', 'utf8');

const done = Object.values(updates).filter((u) => u.qaStatus === 'Done').length;
const open = Object.values(updates).filter((u) => u.qaStatus === 'Not Fixed').length;
console.log(`Updated ${outputPath}`);
console.log(`Done: ${done} | Not Fixed: ${open}`);
