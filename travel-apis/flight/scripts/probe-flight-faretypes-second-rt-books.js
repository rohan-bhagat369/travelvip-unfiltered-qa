import fs from 'fs';
import { authenticate } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';
import { buildRoundTripSearchBody, buildIssueTicketPayload } from '../src/helpers.js';
import { pollRoundTripSearch } from '../src/searchPicker.js';
import { buildPassengers, uniqueTag } from '../src/passengerBuilder.js';
import { GST } from '../../hotel/src/regression/fixtures.js';
import { sleep } from '../../../shared/lib/testUtils.js';

function classify(raw) {
  const s = String(raw || '');
  if (/confirm/i.test(s)) return 'Confirmed';
  if (/inprogress|in.?progress/i.test(s)) return 'Inprogress';
  if (/fail/i.test(s)) return 'Failed';
  if (/cancel/i.test(s)) return 'Cancelled';
  return s || 'Pending';
}

async function poll(flight, br) {
  let last = { classified: 'Pending' };
  for (let i = 0; i < 16; i += 1) {
    const st = await flight.getBookingStatus(br);
    last = { classified: classify(st.data?.status) };
    console.log('  status', last.classified);
    if (['Confirmed', 'Inprogress', 'Failed', 'Cancelled'].includes(last.classified)) return last;
    await sleep(3000);
  }
  return last;
}

function faresOf(opt) {
  return (opt?.fares || []).map((f) => f.fareType);
}

async function issue(flight, searchIds, intl, lag) {
  const details = await flight.getDetails(searchIds, 'ROUND_TRIP');
  const pricing = await flight.getPricing(searchIds, 'ROUND_TRIP');
  const hop = {
    detailsHttp: details.status,
    detailsCode: details.data?.error?.code,
    pricingHttp: pricing.status,
    pricingCode: pricing.data?.error?.code,
    priceId: pricing.data?.priceId,
  };
  if (!pricing.data?.priceId) return hop;
  const payload = buildIssueTicketPayload({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds,
    journeyType: 'ROUND_TRIP',
  });
  payload.data.passengers = buildPassengers({ adults: 1, uniqueNames: true, nameIndex: lag, withPassport: intl });
  payload.data.contact.email = `ft.book2.${uniqueTag()}@travelvip.ai`;
  payload.data.passportType = intl
    ? (pricing.data.passportType && pricing.data.passportType !== 'NONE' ? pricing.data.passportType : 'MINI')
    : (pricing.data.passportType || 'NONE');
  if (pricing.data.addGstInfo === true) {
    payload.data.includeGst = true;
    payload.data.addGstInfo = true;
    payload.data.gstDetails = { ...GST };
  }
  const iss = await flight.issueTicketV2(payload);
  hop.issueHttp = iss.status;
  hop.br = iss.data?.bookingReference || iss.data?.bookingReferenceId;
  hop.issueCode = iss.data?.error?.code;
  if (hop.br) hop.status = (await poll(flight, hop.br)).classified;
  return hop;
}

async function bookFirstPricable(flight, pairs, intl, lag, label) {
  for (const p of (pairs || []).slice(0, 12)) {
    console.log(`\n=== ${label} try`, p.onward.label, '+', p.ret.label, 'faresO', faresOf(p.onward.opt), 'faresR', faresOf(p.ret.opt));
    const hop = await issue(flight, p.searchIds, intl, lag);
    hop.flights = `${p.onward.label} | ${p.ret.label}`;
    hop.fares = { onward: faresOf(p.onward.opt), ret: faresOf(p.ret.opt) };
    console.log(hop);
    if (hop.br) return hop;
    if (hop.detailsCode === 'INVALID_COMBINATION') continue;
    if (hop.pricingCode === 'VENDOR_ERROR') continue;
  }
  return { skip: 'no pricable pair' };
}

async function main() {
  process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
  const session = await authenticate(true);
  const flight = new FlightService(session.client);

  const domFlexi = buildRoundTripSearchBody(33, 40, { origin: 'DEL', destination: 'BOM', fareType: 'NORMAL' });
  const flexiRt = await pollRoundTripSearch(flight, domFlexi, { flexi: true, maxStops: null }, { maxPolls: 10 });
  console.log('DOM flexi pairs', flexiRt.pairs?.length);
  const dom = await bookFirstPricable(flight, flexiRt.pairs, false, 31, 'RT-DOM-FLEXI');

  const intlFlex = buildRoundTripSearchBody(34, 41, { origin: 'BOM', destination: 'DXB', fareType: 'NORMAL' });
  const intlRt = await pollRoundTripSearch(flight, intlFlex, { flexi: true, maxStops: null }, { maxPolls: 10 });
  console.log('INTL flexi pairs', intlRt.pairs?.length);
  let intl = await bookFirstPricable(flight, intlRt.pairs, true, 32, 'RT-INTL-FLEXI');
  if (!intl.br) {
    const any = await pollRoundTripSearch(flight, intlFlex, { maxStops: null, fareType: 'NORMAL' }, { maxPolls: 8 });
    // skip first cheapest (already booked 6E 1501) — try later pairs
    intl = await bookFirstPricable(flight, (any.pairs || []).slice(3), true, 33, 'RT-INTL-SECOND');
  }

  const out = { dom, intl };
  fs.writeFileSync('reports/flight-faretypes-rt-second-books.json', JSON.stringify(out, null, 2));
  console.log('\nSaved reports/flight-faretypes-rt-second-books.json', { domBr: dom.br, intlBr: intl.br });
}

main().catch((e) => { console.error(e); process.exit(1); });
