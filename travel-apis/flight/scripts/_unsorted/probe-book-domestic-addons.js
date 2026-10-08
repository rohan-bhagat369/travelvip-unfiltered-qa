/**
 * Quick domestic DEL-BOM OW SG booking with seat/meal/baggage.
 *   BASE_URL=https://api-staging.travelvip.ai node scripts/probe-book-domestic-addons.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../../shared/lib/authService.js';
import { FlightService } from '../../src/service.js';
import {
  buildOneWaySearchBody,
  buildPassengerProfile,
  canSelectSeats,
} from '../../src/helpers.js';
import { config } from '../../../../shared/config/env.js';

const Q = { lang: 'en', currency: 'INR' };

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function brOf(d) {
  return d?.bookingReference || d?.bookingReferenceId || d?.data?.bookingReference || null;
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('Base URL:', config.baseUrl);
  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const flight = new FlightService(session.client);

  const dayOffsets = [40, 48, 55, 62];
  let lastErr = null;

  for (const day of dayOffsets) {
    const body = buildOneWaySearchBody(day, {
      origin: 'DEL',
      destination: 'BOM',
      fareType: 'NORMAL',
      maxStops: 0,
    });
    body.preferences.airlines = ['SG', '6E', 'IX'];
    console.log('\nSearch day+', day, body.itinerary);

    let search;
    try {
      search = await flight.searchUntilComplete(body);
    } catch (e) {
      lastErr = e.message;
      console.log('search fail', lastErr);
      continue;
    }

    const ids = (search.searchIds?.length ? search.searchIds : [search.searchId]).slice(0, 5);
    for (const sid of ids) {
      const pricing = await flight.getPricing([sid], 'ONE_WAY');
      if (!pricing.ok) {
        lastErr = JSON.stringify(pricing.data).slice(0, 250);
        console.log('pricing fail', lastErr);
        continue;
      }

      const airline = pricing.data?.itinerary?.[0]?.segments?.[0]?.airline?.code
        || pricing.data?.itinerary?.[0]?.segments?.[0]?.flightNumber;
      const fare = pricing.data?.pricing?.totalAmount;
      console.log('priced', pricing.data.priceId, airline, 'fare', fare);

      const ssr = await flight.getSsr(pricing.data.priceId);
      let meal = null;
      let bag = null;
      for (const seg of ssr.data?.meal?.segments || []) {
        for (const m of seg.Meals || seg.meals || []) {
          const amt = money(m.pricing?.totalAmount ?? m.amount);
          if (amt > 0 && (m.priceReference || m.pricing?.priceReference) && (!meal || amt < meal.amount)) {
            meal = {
              ...m,
              amount: amt,
              priceReference: m.priceReference || m.pricing?.priceReference,
              segmentId: m.segmentId || seg.segmentId || 'SEG_1',
              origin: m.origin || 'DEL',
              destination: m.destination || 'BOM',
              title: m.title || m.description,
              description: m.description || m.title,
            };
          }
        }
      }
      for (const seg of ssr.data?.baggage?.segments || []) {
        for (const b of seg.Baggage || seg.baggage || []) {
          const amt = money(b.pricing?.totalAmount ?? b.amount);
          if (amt > 0 && (b.priceReference || b.pricing?.priceReference) && (!bag || amt < bag.amount)) {
            bag = {
              ...b,
              amount: amt,
              priceReference: b.priceReference || b.pricing?.priceReference,
              segmentId: b.segmentId || seg.segmentId || 'SEG_1',
              origin: b.origin || 'DEL',
              destination: b.destination || 'BOM',
              title: b.title || b.description,
              weight: b.weight || 5,
            };
          }
        }
      }

      let seat = null;
      if (canSelectSeats(pricing.data)) {
        const sm = await flight.getSeatMap(pricing.data.bookingContext, [
          {
            paxRefNumber: '1',
            passengerType: 1,
            gender: 'Male',
            title: 'Mr',
            firstName: 'Kabir',
            lastName: 'Sharma',
          },
        ]);
        for (const seg of (sm.data?.data || sm.data || {}).segments || []) {
          for (const s of seg.seatMap || []) {
            if (!/open/i.test(String(s.seatAvailability || ''))) continue;
            const amt = money(s.amount ?? s.price);
            if (amt > 0 && (!seat || amt < seat.amount)) {
              seat = {
                ...s,
                amount: amt,
                seatName: String(s.seatName || s.seatNumber),
                segmentId: s.segmentId || seg.segmentId || 'SEG_1',
                origin: s.origin || seg.origin,
                destination: s.destination || seg.destination,
              };
            }
          }
        }
      }

      console.log('addons', {
        meal: meal?.amount,
        bag: bag?.amount,
        seat: seat ? `${seat.seatName}:${seat.amount}` : null,
      });

      const uniq = `K${Date.now().toString().slice(-6)}`;
      const profile = buildPassengerProfile({
        title: 'Mr',
        firstName: uniq,
        lastName: 'Sharma',
        gender: 'Male',
        dob: '1994-07-21',
      });

      const buildIssue = (withSeat) => ({
        type: 'ticket',
        currency: 'INR',
        language: 'en',
        bookingReference: pricing.data.bookingContext,
        searchIds: [sid],
        journeyType: 'ONE_WAY',
        timezone: 'Asia/Calcutta',
        data: {
          priceId: pricing.data.priceId,
          passportType: 'NONE',
          includeGst: false,
          gstDetails: null,
          contact: {
            email: config.flight.contactEmail || 'rohan@travelvip.ai',
            mobile: config.flight.contactMobile || '9876543210',
            countryCode: '+91',
          },
          passengers: [
            {
              paxId: 'PAX1',
              type: 'adult',
              isLead: true,
              profile: {
                title: profile.title,
                firstName: profile.firstName,
                lastName: profile.lastName,
                gender: profile.gender,
                dob: profile.dob,
                nationality: 'IN',
              },
              city: { cityCode: 'DEL', cityName: 'New Delhi' },
              passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
              ssr: {
                meals: meal
                  ? [{
                    mealId: String(meal.ssrId || meal.mealId),
                    ssrId: String(meal.ssrId || meal.mealId),
                    code: meal.code,
                    title: meal.title,
                    description: meal.description || meal.title,
                    segmentId: meal.segmentId,
                    direction: 'ONWARD',
                    paxType: 'ADT',
                    quantity: 1,
                    priceReference: meal.priceReference,
                    amount: meal.amount,
                    origin: meal.origin,
                    destination: meal.destination,
                  }]
                  : [],
                baggage: bag
                  ? [{
                    baggageId: String(bag.ssrId || bag.baggageId),
                    ssrId: String(bag.ssrId || bag.baggageId),
                    code: bag.code,
                    title: bag.title,
                    description: bag.title,
                    segmentId: bag.segmentId,
                    direction: 'ONWARD',
                    paxType: 'ADT',
                    quantity: 1,
                    priceReference: bag.priceReference,
                    amount: bag.amount,
                    weight: bag.weight || 5,
                    origin: bag.origin,
                    destination: bag.destination,
                  }]
                  : [],
                seats: withSeat && seat
                  ? [{
                    segmentId: seat.segmentId,
                    seatName: seat.seatName,
                    seatNumber: seat.seatName,
                    seatId: seat.seatId || seat.seatKey,
                    seatAvailability: 'Open',
                    code: seat.seatName,
                    amount: seat.amount,
                    price: seat.amount,
                    row: seat.row ?? seat.xaxis,
                    column: seat.column ?? seat.yaxis,
                    priceReference: seat.priceDetail?.priceReference || seat.priceReference,
                    seatKey: seat.seatKey || seat.seatId,
                    direction: 'ONWARD',
                    paxType: 'ADT',
                    description: `Seat ${seat.seatName}`,
                    origin: seat.origin,
                    destination: seat.destination,
                  }]
                  : [],
              },
            },
          ],
        },
      });

      const attempts = [
        { label: 'with-addons', body: buildIssue(true) },
        { label: 'no-seat', body: buildIssue(false) },
      ];

      for (const attempt of attempts) {
        const issue = await session.client.request({
          method: 'POST',
          path: '/v1/flights/booking/issue-ticket',
          query: { ...config.flight.issueTicketQuery, ...Q, count: 10, page: 0, perpage: 20 },
          body: attempt.body,
          correlation: true,
          partnerKey: session.accessToken,
        });
        const br = brOf(issue.data);
        console.log(attempt.label, issue.status, issue.data?.message || issue.data?.info || issue.data?.error?.message || '', 'BR', br);

        if (!issue.ok || !br) {
          lastErr = JSON.stringify(issue.data).slice(0, 500);
          if (issue.data?.available != null) {
            console.log('wallet available', issue.data.available, 'required', issue.data.required);
          }
          continue;
        }

        let status = issue.data?.status;
        for (let i = 0; i < 30; i += 1) {
          const st = await flight.getBookingStatus(br);
          status = st.data?.status || status;
          console.log(`poll ${i + 1}:`, status);
          if (/confirm|fail|cancel/i.test(String(status))) break;
          await sleep(5000);
        }

        const detail = await flight.getBookingDetail(br);
        const sales = detail.data?.bookingResponse?.salesSummary || {};
        const out = {
          ranAt: new Date().toISOString(),
          br,
          status: detail.data?.status || status,
          route: 'DEL-BOM ONE_WAY',
          attempt: attempt.label,
          sales: {
            totalAmount: sales.totalAmount,
            mealPrice: sales.mealPrice,
            baggagePrice: sales.baggagePrice,
            seatPrice: sales.seatPrice,
          },
          itinerary: (detail.data?.bookingResponse?.itinerary || []).map((j) => ({
            direction: j.direction,
            pnr: j.pnr,
            flight: j.segments?.[0]?.flightNumber,
          })),
          selected: {
            fare,
            meal: meal?.amount,
            bag: bag?.amount,
            seat: seat ? { seatName: seat.seatName, amount: seat.amount } : null,
          },
        };

        fs.mkdirSync('reports/flight', { recursive: true });
        fs.writeFileSync(path.join('reports/flight', 'latest-booking.json'), JSON.stringify(out, null, 2));
        console.log('\n=== DONE ===');
        console.log(JSON.stringify(out, null, 2));
        return;
      }
    }
  }

  throw new Error(lastErr || 'booking failed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
