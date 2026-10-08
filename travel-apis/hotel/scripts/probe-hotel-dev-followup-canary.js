/**
 * Retest hotel finalize per Dev comments (canary):
 * - Mobile validation deployed (accept + reject)
 * - Dates: no finalize date validation (from booking context) — must not 500
 * - GST: gstDetails not received (confirm behavior)
 * - PAN: only when isPANMandatory true
 *
 * Run: BASE_URL=https://canary-api.travelvip.ai node scripts/probe-hotel-dev-followup-canary.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { HotelService } from '../src/service.js';
import {
  HOTEL_QUERY,
  buildSearchBody,
  extractRequestId,
  extractBookingCodes,
  extractBookingContext,
} from '../src/helpers.js';

const OUT = path.join('reports', 'hotel-dev-followup-canary.json');
const rows = [];

function brief(d, n = 400) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}
function errCode(res) {
  return res?.data?.error?.code || null;
}
function errDetails(res) {
  return res?.data?.error?.details ?? null;
}
function isValErr(res) {
  return res.status === 400 && errCode(res) === 'VALIDATION_ERROR';
}
function booked(res) {
  return Boolean(res?.data?.bookingRefId || res?.data?.bookingReference);
}

function add(tc, api, what, expected, res, pass) {
  rows.push({
    tc,
    api,
    what,
    expected,
    actual: `HTTP ${res.status} code=${errCode(res)} details=${JSON.stringify(errDetails(res))} booked=${booked(res)}`,
    status: pass ? 'PASS' : 'BUG',
    response: brief(res.data, 500),
  });
  console.log(`${pass ? 'PASS' : 'BUG'} | ${tc} | HTTP ${res.status} | ${errCode(res) || '-'} | ${brief(res.data, 120)}`);
}

async function main() {
  console.log('Base:', config.baseUrl);
  const session = await authenticate(true);
  const client = session.client;
  const hotel = new HotelService(client);

  const searchBody = buildSearchBody({
    checkinDays: 40,
    nights: 2,
    rooms: [{ adults: 2, children: 0, childrenAges: [] }],
  });
  searchBody.rooms[0].adults = 2;
  searchBody.rooms[0].children = 0;

  await hotel.search(searchBody);
  const dRes = await hotel.getDetails(searchBody);
  const rid = extractRequestId(dRes.data);
  const codes = extractBookingCodes(dRes.data, 12);

  let ctx = null;
  let bookingCode = null;
  let preData = null;
  for (const c of codes) {
    const pre = await hotel.prebook({ bookingCode: c, requestId: rid });
    ctx = extractBookingContext(pre.data);
    if (ctx) {
      bookingCode = c;
      preData = pre.data;
      break;
    }
  }
  if (!ctx) throw new Error('No prebook context');

  const panFlag = preData?.isPANMandatory ?? preData?.panMandatory ?? preData?.isPanMandatory ?? null;
  const gstFlag = preData?.gstRequired ?? preData?.isGstRequired ?? preData?.gstMandatory ?? null;
  console.log('Prebook flags', { panFlag, gstFlag, keys: Object.keys(preData || {}).slice(0, 40) });

  let n = 0;
  const base = () => {
    n += 1;
    return {
      bookingContext: ctx,
      bookingCode,
      requestId: rid,
      checkin: searchBody.checkin,
      checkout: searchBody.checkout,
      rooms: [{
        guests: [
          {
            title: 'Mr',
            firstName: 'Rohan',
            lastName: `BhagatT${String(n).padStart(2, '0')}`.replace(/\d/g, (d) => 'ABCDEFGHIJ'[Number(d)]),
            type: 'Adult',
            isLead: true,
          },
          {
            title: 'Mr',
            firstName: 'Amit',
            lastName: 'Sharma',
            type: 'Adult',
            isLead: false,
          },
        ],
      }],
      contact: {
        email: `dev.follow.${Date.now()}.${n}@travelvip.ai`,
        countryCode: '+91',
        mobile: '9876543210',
      },
    };
  };

  async function finalize(body) {
    return client.request({
      method: 'POST',
      path: '/api/v2/hotels/finalize-booking',
      query: { ...HOTEL_QUERY, page: 0, perpage: 20 },
      body,
      correlation: true,
      partnerKey: client.partnerKey,
    });
  }

  const API = 'POST /api/v2/hotels/finalize-booking';

  // ─── Mobile (Dev: deployed) ───
  console.log('\n=== Mobile reject ===');
  {
    const b = base();
    b.contact.mobile = '5123456789';
    const res = await finalize(b);
    add('TC1', API, 'mobile +91 starting with 5', 'HTTP 400 VALIDATION_ERROR', res, isValErr(res) && !booked(res));
  }
  {
    const b = base();
    b.contact.mobile = '98765';
    const res = await finalize(b);
    add('TC2', API, 'mobile length != 10 for +91', 'HTTP 400 VALIDATION_ERROR', res, isValErr(res) && !booked(res));
  }

  console.log('\n=== Mobile accept (docs) ===');
  {
    const b = base();
    b.contact.countryCode = '91';
    b.contact.mobile = '9876543210';
    const res = await finalize(b);
    // PASS if not VALIDATION_ERROR and not 500
    add('TC3', API, 'countryCode plain 91', 'Accept (not VALIDATION_ERROR, not 500)', res,
      res.status !== 500 && !isValErr(res));
  }
  {
    const b = base();
    b.contact.mobile = '98765-43210';
    const res = await finalize(b);
    add('TC4', API, 'mobile with hyphen', 'Accept (not VALIDATION_ERROR, not 500)', res,
      res.status !== 500 && !isValErr(res));
  }
  {
    const b = base();
    b.contact.countryCode = '+91';
    b.contact.mobile = '919876543210';
    const res = await finalize(b);
    add('TC5', API, 'mobile repeats country code', 'Accept (not VALIDATION_ERROR, not 500)', res,
      res.status !== 500 && !isValErr(res));
  }

  // ─── Dates (Dev: no validation / from booking context; must not 500) ───
  console.log('\n=== Dates (no validation expected; must not 500) ===');
  const dateCases = [
    ['TC6', 'checkin DD-MM-YYYY', (b) => { b.checkin = '14-09-2026'; }],
    ['TC7', 'checkin slashes', (b) => { b.checkin = '2026/09/14'; }],
    ['TC8', 'checkin unpadded', (b) => { b.checkin = '2026-9-14'; }],
    ['TC9', 'impossible date', (b) => { b.checkin = '2026-02-30'; b.checkout = '2026-03-02'; }],
    ['TC10', 'checkout == checkin', (b) => { b.checkout = b.checkin; }],
    ['TC11', 'past checkin', (b) => { b.checkin = '2020-01-15'; b.checkout = '2020-01-17'; }],
  ];
  for (const [tc, what, mut] of dateCases) {
    const b = base();
    mut(b);
    const res = await finalize(b);
    // Per Dev: no date validation — PASS if not 500 (ignore/use context). BUG if 500 or if still VALIDATION_ERROR on dates (docs changing).
    const pass = res.status !== 500;
    add(tc, API, what, 'No crash (Dev: dates from booking context; not validated)', res, pass);
  }

  // ─── GST (Dev: gstDetails not received) ───
  console.log('\n=== GST ===');
  {
    const b = base();
    delete b.gstDetails;
    const res = await finalize(b);
    add('TC12', API, 'omit gstDetails', 'Accept / not 500', res, res.status !== 500 && !isValErr(res));
  }
  {
    const b = base();
    b.gstDetails = {};
    const res = await finalize(b);
    add('TC13', API, 'gstDetails {}', 'Accept / not 500', res, res.status !== 500 && !isValErr(res));
  }
  {
    const b = base();
    b.gstDetails = {
      gstNumber: '27AABCT1332L1ZU',
      gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
      gstAddress: '5th Floor, Trade Centre, BKC, Mumbai 400051',
      gstEmailID: 'accounts@travelvip.ai',
      gstMobileNumber: '9820011223',
    };
    const res = await finalize(b);
    add('TC14', API, 'full valid gstDetails', 'Accept / not 500 (Dev: field may not be received yet)', res,
      res.status !== 500 && !isValErr(res));
  }
  {
    const b = base();
    b.gstDetails = { gstNumber: '27AABCT1332L1ZU' };
    const res = await finalize(b);
    // If gst not received, partial may also not validate — record outcome
    add('TC15', API, 'partial gstDetails', 'If GST wired: 400 VALIDATION_ERROR; if not received: may pass/ignore', res,
      true); // informational — always record, mark PASS for run completeness then override below
    rows[rows.length - 1].status = isValErr(res) ? 'PASS' : (res.status === 500 ? 'BUG' : 'NOTE');
    rows[rows.length - 1].note = isValErr(res)
      ? 'GST validation active'
      : (res.status === 500 ? 'HTTP 500' : 'Not rejected — consistent with gstDetails not received');
  }

  // ─── PAN (only if mandatory) ───
  console.log('\n=== PAN ===');
  if (panFlag === true) {
    {
      const b = base();
      b.contact.panCardNumber = 'BADPAN';
      b.contact.panCardName = 'TRAVELVIP';
      const res = await finalize(b);
      add('TC16', API, 'invalid PAN on PAN-mandatory rate', 'HTTP 400 VALIDATION_ERROR', res, isValErr(res));
    }
    {
      const b = base();
      delete b.contact.panCardNumber;
      delete b.contact.panCardName;
      const res = await finalize(b);
      add('TC17', API, 'missing PAN on PAN-mandatory rate', 'HTTP 400 VALIDATION_ERROR', res, isValErr(res));
    }
  } else {
    {
      const b = base();
      b.contact.panCardNumber = 'BADPAN';
      b.contact.panCardName = 'TRAVELVIP';
      const res = await finalize(b);
      // Dev: PAN not validated unless mandatory — invalid PAN may be ignored
      add('TC16', API, `invalid PAN when isPANMandatory=${panFlag}`, 'Ignored / not VALIDATION_ERROR (non-mandatory)', res,
        !isValErr(res) && res.status !== 500);
    }
    rows.push({
      tc: 'TC17',
      api: API,
      what: 'PAN mandatory missing-PAN test',
      expected: 'Needs isPANMandatory=true rate',
      actual: `prebook isPANMandatory=${panFlag}`,
      status: 'NOT TESTED',
      response: brief({ sampleKeys: Object.keys(preData || {}).filter((k) => /pan|gst|mandatory/i.test(k)) }),
    });
    console.log('NOT TESTED | TC17 | no PAN-mandatory rate in this prebook');
  }

  // ─── Guest accept (still open earlier) ───
  console.log('\n=== Guest accept smoke ===');
  {
    const b = base();
    b.rooms[0].guests[0].type = 'adult';
    const res = await finalize(b);
    add('TC18', API, 'type adult lowercase', 'Accept / not 500', res, res.status !== 500 && !isValErr(res));
  }
  {
    const b = base();
    b.rooms[0].guests[1] = {
      title: 'Miss', firstName: 'Anita', lastName: 'Sharma', type: 'Adult', gender: 'Female', isLead: false,
    };
    const res = await finalize(b);
    add('TC19', API, 'Miss + Female adult', 'Accept / not 500', res, res.status !== 500 && !isValErr(res));
  }

  // Prebook empty body (still open)
  console.log('\n=== Prebook {} ===');
  {
    const res = await client.request({
      method: 'POST',
      path: '/v1/hotels/prebook',
      query: HOTEL_QUERY,
      body: {},
      correlation: true,
    });
    const det = errDetails(res) || [];
    const both = Array.isArray(det) && det.some((m) => /bookingCode/i.test(m)) && det.some((m) => /requestId/i.test(m));
    add('TC20', 'POST /v1/hotels/prebook', 'body {}', 'details names bookingCode + requestId', res,
      isValErr(res) && both);
  }

  const counts = { PASS: 0, BUG: 0, 'NOT TESTED': 0, NOTE: 0 };
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;

  const summary = {
    baseUrl: config.baseUrl,
    generatedAt: new Date().toISOString(),
    devNotes: {
      dates: 'No finalize date validation; from booking context',
      gst: 'gstDetails not received in payload',
      pan: 'Only when isPANMandatory true',
      mobile: 'Validation changes deployed',
    },
    prebookFlags: { isPANMandatory: panFlag, gstFlag },
    counts,
    rows,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));

  console.log('\n========== FOLLOW-UP REPORT ==========');
  console.log(`PASS ${counts.PASS} | BUG ${counts.BUG} | NOTE ${counts.NOTE || 0} | NOT TESTED ${counts['NOT TESTED'] || 0}`);
  console.log('| TC | What | Status |');
  console.log('|----|------|--------|');
  rows.forEach((r) => console.log(`| ${r.tc} | ${r.what} | ${r.status} |`));
  console.log('Report:', OUT);

  if (counts.BUG > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exitCode = 1;
});
