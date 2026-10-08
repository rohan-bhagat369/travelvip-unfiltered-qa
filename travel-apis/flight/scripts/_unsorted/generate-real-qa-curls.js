/**
 * Generate Postman-style real signed curls for Not Fixed CSV rows and update the CSV.
 * Token/signature expire — regenerate before sharing if stale.
 */
import fs from 'fs';
import { randomUUID } from 'crypto';
import { authenticate } from '../../../../shared/lib/authService.js';
import { config } from '../../../../shared/config/env.js';
import { createSignature, createTimestamp, createRequestId } from '../../../../shared/lib/signature.js';
import { FlightService } from '../../src/service.js';
import { buildOneWaySearchBody, extractFirstSearchId, pollUntil } from '../../src/helpers.js';
import { futureDate } from '../../../../shared/lib/testUtils.js';

const CSV_PATH = 'Partner API Testing - DM.csv';
const BASE = config.baseUrl;

/** Set in main() from /auth/partner/token access_token — used as X-Partner-Key */
let activePartnerKey = null;

function pretty(obj) {
  return JSON.stringify(obj, null, 4);
}

function buildCurl({ method = 'POST', url, headers, body }) {
  const lines = [`curl --location '${url}'`];
  if (method !== 'POST' && method !== 'GET') {
    lines[0] = `curl --location --request ${method} '${url}'`;
  } else if (method === 'GET') {
    lines[0] = `curl --location --request GET '${url}'`;
  }
  for (const [key, value] of Object.entries(headers)) {
    lines.push(`--header '${key}: ${value}'`);
  }
  if (body !== undefined && body !== null) {
    const bodyStr = typeof body === 'string' ? body : pretty(body);
    // Escape single quotes for shell: ' -> '\''
    const escaped = bodyStr.replace(/'/g, `'\\''`);
    lines.push(`--data '${escaped}'`);
  }
  return lines.join(' \\\n');
}

function signedHeaders(authToken, bodyString, extra = {}) {
  const timestamp = createTimestamp();
  const requestId = createRequestId();
  const correlationId = randomUUID();
  const headers = {
    Authorization: `Bearer ${authToken}`,
    'Content-Type': extra.contentType || 'application/json',
    ...(extra.accept ? { Accept: extra.accept } : {}),
    'X-Request-Id': extra.requestId !== undefined ? extra.requestId : requestId,
    'X-Timestamp': timestamp,
    'X-Signature': createSignature(bodyString, timestamp, config.signingKey),
    'X-Correlation-ID': correlationId,
    ...Object.fromEntries(
      Object.entries(extra).filter(([k]) => !['contentType', 'accept', 'requestId', 'partnerKey'].includes(k)),
    ),
  };
  // Finalize / issue / cancel require partner access_token as X-Partner-Key
  if (extra.partnerKey) {
    headers['X-Partner-Key'] = extra.partnerKey;
  }
  return headers;
}

function searchCurl(authToken, body, query = 'lang=en&currency=INR&page=0&perpage=20&sortby=fare%2Casc', extraHeaders = {}) {
  const bodyStr = pretty(body);
  const headers = signedHeaders(authToken, bodyStr, extraHeaders);
  // Remove Content-Type override confusion — signedHeaders already set it
  return buildCurl({
    url: `${BASE}/v1/flights/search?${query}`,
    headers,
    body: bodyStr,
  });
}

function issueTicketCurl(authToken, body, partnerKey = activePartnerKey) {
  const q = new URLSearchParams({
    pid: config.flight.issueTicketQuery.pid,
    key: config.flight.issueTicketQuery.key,
    clientCode: config.flight.issueTicketQuery.clientCode,
    platform: config.flight.issueTicketQuery.platform,
    lang: 'en',
    currency: 'INR',
  }).toString();
  const bodyStr = pretty(body);
  return buildCurl({
    url: `${BASE}/v1/flights/booking/issue-ticket?${q}`,
    headers: signedHeaders(authToken, bodyStr, { partnerKey }),
    body: bodyStr,
  });
}

function seatmapCurl(authToken, requestReference) {
  const body = {
    currency: 'INR',
    requestReference,
    passengers: [
      { type: 'adult', title: 'Mr', firstName: 'Rohan', lastName: 'Bhagat' },
    ],
  };
  const bodyStr = pretty(body);
  return buildCurl({
    url: `${BASE}/v1/flights/seatmap?lang=en&currency=INR`,
    headers: signedHeaders(authToken, bodyStr),
    body: bodyStr,
  });
}

function statusCurl(authToken, bookingRef) {
  return buildCurl({
    method: 'GET',
    url: `${BASE}/v1/flights/booking/${bookingRef}/status?lang=en&currency=INR`,
    headers: signedHeaders(authToken, ''),
  });
}

function cancelCurl(authToken, bookingRef, partnerKey = activePartnerKey) {
  const bodyStr = pretty({});
  return buildCurl({
    url: `${BASE}/v1/flights/booking/${bookingRef}/cancel?lang=en&currency=INR`,
    headers: signedHeaders(authToken, bodyStr, { partnerKey }),
    body: bodyStr,
  });
}

function basePassenger(overrides = {}) {
  return {
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
      ...overrides.profile,
    },
    city: { cityCode: 'Pune', cityName: 'Pune' },
    passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
    ssr: { baggage: [], meals: [], seats: [] },
  };
}

function issueBody({
  priceId,
  bookingReference,
  searchIds,
  journeyType = 'ONE_WAY',
  email = 'rohan@travelvip.ai',
  mobile = '9876543210',
  profile = {},
} = {}) {
  return {
    type: 'ticket',
    currency: 'INR',
    language: 'en',
    bookingReference,
    searchIds,
    journeyType,
    timezone: 'Asia/Calcutta',
    data: {
      priceId,
      passportType: 'NONE',
      includeGst: false,
      gstDetails: null,
      contact: {
        email,
        mobile,
        countryCode: '+91',
      },
      passengers: [basePassenger({ profile })],
    },
  };
}

const owSearchBody = () => ({
  itinerary: [{ origin: 'BOM', destination: 'DEL', date: futureDate(12) }],
  travellers: { adults: 1, children: 0, infants: 0 },
  cabinClass: 'ECONOMY',
  journeyType: 'ONE_WAY',
  currency: 'INR',
  language: 'en',
  preferences: { airlines: [], maxStops: 0, refundableOnly: false },
  appliedFilters: {},
  selection: { selectedSearchIds: [] },
  fareType: 'NORMAL',
});

const owCorpBody = () => ({ ...owSearchBody(), fareType: 'CORPORATE' });

const rtCorpBody = () => ({
  itinerary: [
    { origin: 'BOM', destination: 'DEL', date: futureDate(12) },
    { origin: 'DEL', destination: 'BOM', date: futureDate(19) },
  ],
  travellers: { adults: 1, children: 0, infants: 0 },
  cabinClass: 'ECONOMY',
  journeyType: 'ROUND_TRIP',
  currency: 'INR',
  language: 'en',
  preferences: { airlines: [], maxStops: null, refundableOnly: false },
  appliedFilters: {},
  selection: { selectedSearchIds: [] },
  fareType: 'CORPORATE',
});

const rtEarlyBody = (onwardSearchId) => ({
  ...rtCorpBody(),
  fareType: 'NORMAL',
  selection: { selectedSearchIds: [onwardSearchId] },
});

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
      } else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function escapeCsv(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function main() {
  console.log('Authenticating...');
  const session = await authenticate(true);
  const token = session.authToken;
  activePartnerKey = session.accessToken;
  const flight = new FlightService(session.client);

  console.log('Authenticated. Building Postman-style signed curls...');
  // Optional: try a short search+pricing for live ids (do not block curl generation long)
  let searchId = 'SEARCH_ID_FROM_SEARCH_RESPONSE';
  let priceId = 'price_FROM_PRICING_RESPONSE';
  let bookingContext = 'bookingContext_FROM_PRICING_RESPONSE';
  let sampleBr = 'BR_FROM_ISSUE_TICKET_RESPONSE';

  try {
    const searchBody = buildOneWaySearchBody(45, {
      origin: 'BOM',
      destination: 'DEL',
      fareType: 'CORPORATE',
    });
    console.log('Quick search (max 8 polls)...');
    const searchRes = await pollUntil(
      () => flight.search(searchBody),
      (res) => res.ok && extractFirstSearchId(res.data),
      { maxAttempts: 8, intervalMs: 4000, label: 'Flight search (quick)' },
    );
    searchId = extractFirstSearchId(searchRes.data);
    const pricing = await flight.getPricing([searchId], 'ONE_WAY');
    if (pricing.ok) {
      priceId = pricing.data.priceId;
      bookingContext = pricing.data.bookingContext;
      console.log('Got live searchId / priceId / bookingContext');

      const invalidIssue = await session.client.request({
        method: 'POST',
        path: '/v1/flights/booking/issue-ticket',
        query: { ...config.flight.issueTicketQuery, lang: 'en', currency: 'INR' },
        body: issueBody({
          priceId: 'price_invalid_price_id_000',
          bookingReference: bookingContext,
          searchIds: [searchId],
        }),
        correlation: true,
      });
      sampleBr =
        invalidIssue.data?.bookingReferenceId ||
        invalidIssue.data?.bookingRefId ||
        invalidIssue.data?.data?.bookingReferenceId ||
        invalidIssue.data?.bookingReference ||
        sampleBr;
      console.log('Sample BR:', sampleBr);
    }
  } catch (err) {
    console.warn('Using placeholder search/pricing ids (token+signature are still live).');
    console.warn(String(err.message || err));
  }

  const onwardId = searchId;
  const genNote = `Curl generated ${new Date().toISOString()} — token/signature expire; re-run: node scripts/generate-real-qa-curls.js`;

  const curls = {
    5: searchCurl(token, owSearchBody(), 'lang=en&currency=INR&page=0&perpage=20&sortby=fare%2Casc', {
      contentType: 'text/plain',
      accept: 'application/xml',
    }),
    8: searchCurl(token, rtCorpBody()),
    9: searchCurl(token, rtEarlyBody(onwardId)),
    11: seatmapCurl(token, bookingContext),
    13: seatmapCurl(token, bookingContext),
    14: issueTicketCurl(
      token,
      issueBody({
        priceId: 'price_invalid_price_id_000',
        bookingReference: bookingContext,
        searchIds: [searchId],
      }),
    ),
    15: issueTicketCurl(
      token,
      issueBody({
        priceId,
        bookingReference: 'invalid-booking-context-token',
        searchIds: [searchId],
      }),
    ),
    16: issueTicketCurl(
      token,
      issueBody({
        priceId,
        bookingReference: 'BR0000000000001',
        searchIds: [searchId],
      }),
    ),
    17: issueTicketCurl(
      token,
      issueBody({
        priceId,
        bookingReference: bookingContext,
        searchIds: [searchId],
        profile: { lastName: 'Test123' },
      }),
    ),
    18: issueTicketCurl(
      token,
      issueBody({
        priceId,
        bookingReference: bookingContext,
        searchIds: [searchId],
        profile: { lastName: '' },
      }),
    ),
    19: issueTicketCurl(
      token,
      issueBody({
        priceId,
        bookingReference: bookingContext,
        searchIds: [searchId],
        email: 'not-an-email',
      }),
    ),
    21: issueTicketCurl(
      token,
      issueBody({
        priceId,
        bookingReference: bookingContext,
        searchIds: [searchId],
        profile: { dob: 'invalid' },
      }),
    ),
    22: issueTicketCurl(
      token,
      issueBody({
        priceId,
        bookingReference: bookingContext,
        searchIds: [searchId],
        journeyType: 'ROUND_TRIP',
      }),
    ),
    23: [
      'Naming mismatch demo:',
      '1) Pricing response uses field: bookingContext',
      '2) Issue-ticket request must send same token as: bookingReference',
      '',
      issueTicketCurl(
        token,
        issueBody({
          priceId,
          bookingReference: bookingContext,
          searchIds: [searchId],
        }),
      ),
    ].join('\n'),
    26: issueTicketCurl(
      token,
      issueBody({
        priceId: 'price_invalid_price_id_000',
        bookingReference: bookingContext,
        searchIds: [searchId],
      }),
    ),
    27: [
      'Step 1 — issue with invalid priceId:',
      issueTicketCurl(
        token,
        issueBody({
          priceId: 'price_invalid_price_id_000',
          bookingReference: bookingContext,
          searchIds: [searchId],
        }),
      ),
      '',
      'Step 2 — poll status (provider error appears here, not in issue-ticket):',
      statusCurl(token, sampleBr),
    ].join('\n'),
    28: statusCurl(token, sampleBr),
    29: statusCurl(token, sampleBr),
    30: statusCurl(token, sampleBr),
    31: statusCurl(token, sampleBr),
    32: cancelCurl(token, sampleBr),
    33: [
      'OW CORPORATE:',
      searchCurl(token, owCorpBody()),
      '',
      'RT CORPORATE:',
      searchCurl(token, rtCorpBody()),
    ].join('\n'),
    34: searchCurl(token, rtEarlyBody(onwardId)),
  };

  // fix circular ref for 25
  function curlsPlaceholder14() {
    return issueTicketCurl(
      token,
      issueBody({
        priceId: 'price_invalid_price_id_000',
        bookingReference: bookingContext,
        searchIds: [searchId],
      }),
    );
  }
  curls[25] = [
    'Umbrella — run any of Sr 14-19 / 21 curls. Example (invalid priceId):',
    curlsPlaceholder14(),
  ].join('\n');

  // Update CSV
  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const lines = raw.split(/\r?\n/).filter((l, idx, arr) => !(idx === arr.length - 1 && l.trim() === ''));
  const header = parseCsvLine(lines[0]);
  const srIdx = header.indexOf('Sr No');
  const statusIdx = header.indexOf('QA Status');
  const curlIdx = header.indexOf('Curl (Not Fixed)');
  const notesIdx = header.indexOf('QA Notes');

  const out = [header.map(escapeCsv).join(',')];
  let updated = 0;

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = parseCsvLine(lines[i]);
    while (cols.length < header.length) cols.push('');
    const sr = String(cols[srIdx] || '').trim();
    if (cols[statusIdx] === 'Not Fixed' && curls[sr]) {
      cols[curlIdx] = curls[sr];
      const prev = cols[notesIdx] || '';
      if (!prev.includes('Curl generated')) {
        cols[notesIdx] = prev ? `${prev} | ${genNote}` : genNote;
      } else {
        cols[notesIdx] = prev.replace(/Curl generated[^|]*/g, genNote).replace(/\s+\|\s+$/, '');
      }
      updated += 1;
    }
    out.push(cols.map(escapeCsv).join(','));
  }

  fs.writeFileSync(CSV_PATH, out.join('\n') + '\n', 'utf8');
  console.log(`Updated ${updated} Not Fixed curls in ${CSV_PATH}`);
  console.log('Sample (Sr 5) preview:\n', curls[5].slice(0, 400));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
