/**
 * API-only SMT/card book once on delta-api (no web/shop).
 * Auth: staging vgm partner token + session (SMT partner_secret not in collection).
 * Product calls: signed; createBooking with paymentMethod=CARD (cardpayment.json shape).
 * Query pid/key: smt / palsgcvgscvvs when SMT_QUERY=1 (default).
 *
 *   $env:BASE_URL='https://delta-api.travelvip.ai'
 *   $env:ALLOW_BOOK='true'
 *   node travel-apis/hotel/scripts/probe-delta-smt-card-once.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { HotelService } from '../src/service.js';
import {
  buildSearchBody,
  extractBookingCodes,
  extractBookingContext,
  extractRequestId,
  isPrebookSuccess,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'reports', 'delta-hotel-smt');
const SMT_PID = process.env.SMT_PID || 'smt';
const SMT_KEY = process.env.SMT_KEY || 'palsgcvgscvvs';
const USE_SMT_QUERY = !/^(0|false|no)$/i.test(String(process.env.SMT_QUERY || '1'));

function loadStripeSk() {
  if (process.env.STRIPE_SK) return process.env.STRIPE_SK;
  try {
    const raw = fs.readFileSync(path.join(process.env.USERPROFILE, 'Downloads', 'cardpayment.json'), 'utf8');
    const m = raw.match(/sk_test_[A-Za-z0-9]+/);
    return m ? m[0] : null;
  } catch {
    return null;
  }
}

function brief(d, n = 400) {
  try {
    return JSON.stringify(d).slice(0, n);
  } catch {
    return String(d).slice(0, n);
  }
}

async function findBookable(hotel) {
  const entityIds = ['39627872', config.hotel.defaultEntityId, '2869073'].filter(Boolean);
  for (const entityId of entityIds) {
    for (const checkinDays of [21, 28, 35, 14]) {
      for (const nights of [1, 2]) {
        console.log(`Try entity=${entityId} +${checkinDays}d n=${nights}`);
        const searchBody = buildSearchBody({
          entityId,
          checkinDays,
          nights,
          rooms: [{ adults: 1, children: 0, childrenAges: [] }],
        });
        const search = await hotel.search(searchBody);
        if (!search.ok) {
          console.log('  search', search.status, brief(search.data, 120));
          continue;
        }
        const details = await hotel.getDetails(searchBody);
        if (!details.ok) continue;
        const requestId = extractRequestId(details.data) || extractRequestId(search.data);
        const codes = extractBookingCodes(details.data, 12);
        if (!requestId || !codes.length) continue;
        for (const bookingCode of codes) {
          const prebook = await hotel.prebook({ bookingCode, requestId });
          if (!isPrebookSuccess(prebook)) continue;
          return {
            searchBody,
            details,
            prebook,
            bookingCode,
            requestId,
            hotelName: prebook.data?.results?.[0]?.name || details.data?.results?.[0]?.name,
          };
        }
      }
    }
  }
  return null;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  console.log('Base:', config.baseUrl);
  console.log('Auth partner (.env):', config.partnerId, '| SMT query:', USE_SMT_QUERY ? `${SMT_PID}/${SMT_KEY}` : 'off');

  // Prove SMT partner token fails with collection key (expected)
  {
    const probe = await fetch(`${config.baseUrl}/auth/partner/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Request-Id': `req-smt-${Date.now()}`,
      },
      body: JSON.stringify({ partner_id: SMT_PID, partner_secret: SMT_KEY }),
    });
    const t = await probe.text();
    console.log(`SMT partner token with collection key: HTTP ${probe.status} ${t.slice(0, 140)}`);
  }

  const { client, accessToken } = await authenticate(true);
  const hotel = new HotelService(client);

  const found = await findBookable(hotel);
  if (!found) {
    const report = { ok: false, error: 'No bookable inventory', at: new Date().toISOString(), base: config.baseUrl };
    fs.writeFileSync(path.join(OUT, 'latest.json'), JSON.stringify(report, null, 2));
    console.error('FAILED: no inventory');
    process.exit(1);
  }

  const { searchBody, details, prebook, bookingCode, requestId, hotelName } = found;
  console.log(`\nInventory OK: ${hotelName} code=${String(bookingCode).slice(0, 28)}…`);

  const bookingContext = extractBookingContext(prebook.data) || extractBookingContext(details.data);
  const createBody = {
    bookingCode,
    bookingContext,
    requestId,
    checkin: searchBody.checkin,
    checkout: searchBody.checkout,
    paymentMethod: 'CARD',
    redirectUrl: 'https://delta-shop.travelvip.ai/booking/status',
    contact: {
      email: `smt.api.${Date.now()}@travelvip.ai`,
      countryCode: '+91',
      mobile: config.hotel.contactMobile || '9876543210',
      panCardNumber: 'EUIPB1672M',
      panCardName: 'Rohan Bhagat',
    },
    rooms: [
      {
        guests: [
          {
            title: 'Mr',
            firstName: config.hotel.guestFirstName || 'Rohan',
            lastName: config.hotel.guestLastName || 'Bhagat',
            type: 'Adult',
            isLead: true,
          },
        ],
      },
    ],
  };

  const query = {
    lang: 'en',
    currency: 'INR',
    platform: 'web',
    client: 'web',
    page: 0,
    perpage: 20,
  };
  if (USE_SMT_QUERY) {
    query.pid = SMT_PID;
    query.key = SMT_KEY;
  }

  console.log('\n[CARD] POST /api/hotels/createBooking');
  const createRes = await client.request({
    method: 'POST',
    path: '/api/hotels/createBooking',
    query,
    body: createBody,
    correlation: true,
    partnerKey: accessToken || client.partnerKey,
  });
  console.log('  HTTP', createRes.status, brief(createRes.data, 500));

  const d = createRes.data?.data || createRes.data || {};
  const pd = d.paymentData || d;
  const clientSecret =
    pd.clientSecret
    || pd.client_secret
    || (typeof pd.paymentIntent === 'string' ? pd.paymentIntent : null)
    || pd.paymentIntent?.client_secret
    || d.stripeClientSecret;
  const paymentIntentId =
    pd.paymentIntentId
    || pd.payment_intent_id
    || (typeof pd.paymentIntent === 'object' ? pd.paymentIntent?.id : null)
    || d.paymentIntentId
    || (typeof clientSecret === 'string' && clientSecret.includes('_secret')
      ? clientSecret.split('_secret')[0]
      : null);

  const report = {
    at: new Date().toISOString(),
    base: config.baseUrl,
    mode: 'API-only',
    authPartner: config.partnerId,
    smtQuery: USE_SMT_QUERY ? { pid: SMT_PID, key: SMT_KEY } : null,
    inventory: { hotelName, bookingCode, requestId, checkin: searchBody.checkin, checkout: searchBody.checkout },
    createBooking: { status: createRes.status, data: createRes.data },
    payment: {
      paymentIntentId: paymentIntentId || null,
      clientSecret: clientSecret ? `${String(clientSecret).slice(0, 28)}…` : null,
    },
  };

  const stripeSk = loadStripeSk();
  if (createRes.ok && paymentIntentId && stripeSk) {
    console.log('\n[CARD] Stripe confirm', paymentIntentId);
    const conf = await fetch(`https://api.stripe.com/v1/payment_intents/${paymentIntentId}/confirm`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeSk}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        payment_method: 'pm_card_visa',
        return_url: 'https://delta-shop.travelvip.ai/booking/status',
      }),
    });
    const confData = await conf.json().catch(async () => ({ _raw: await conf.text() }));
    console.log('  Stripe', conf.status, brief(confData, 300));
    report.stripeConfirm = { status: conf.status, data: confData };

    if (conf.ok || ['succeeded', 'requires_capture', 'processing'].includes(confData.status)) {
      await sleep(1500);
      const bookingReference = createRes.data?.bookingReference || createRes.data?.bookingRefId;
      const book = await client.request({
        method: 'POST',
        path: '/api/v2/hotels/booking',
        query,
        body: {
          paymentIntentId,
          bookingReference,
          bookingRefId: bookingReference,
          bookingCode,
          requestId,
          bookingContext,
        },
        correlation: true,
        partnerKey: accessToken || client.partnerKey,
      });
      console.log('\n[CARD] POST /api/v2/hotels/booking', book.status, brief(book.data, 400));
      report.v2Booking = { status: book.status, data: book.data };

      if (bookingReference) {
        for (let i = 0; i < 12; i += 1) {
          await sleep(3000);
          const st = await client.request({
            method: 'GET',
            path: `/v1/hotels/bookings/${bookingReference}/status`,
            query,
            correlation: true,
            partnerKey: accessToken || client.partnerKey,
          });
          const status = st.data?.status;
          console.log(`  status poll ${i + 1}: ${status}`);
          if (status && /Confirmed|Failed|Cancelled/i.test(String(status))) {
            report.finalStatus = st.data;
            break;
          }
        }
      }
    }
  } else if (!paymentIntentId) {
    report.note = 'createBooking did not return a PaymentIntent — card path may be off for this partner/session, or error response';
  }

  fs.writeFileSync(path.join(OUT, 'latest.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT, `run-${Date.now()}.json`), JSON.stringify(report, null, 2));
  console.log('\nWROTE', path.join(OUT, 'latest.json'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
