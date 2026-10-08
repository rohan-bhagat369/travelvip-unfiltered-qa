import fs from 'fs';
import { authenticate } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';
import { buildRoundTripSearchBody, buildIssueTicketPayload } from '../src/helpers.js';
import { pollRoundTripSearch, pickFareSearchId, collectOptions } from '../src/searchPicker.js';
import { buildPassengers, uniqueTag } from '../src/passengerBuilder.js';
import { GST } from '../../hotel/src/regression/fixtures.js';
import { sleep } from '../../../shared/lib/testUtils.js';

function ftype(f) { return String(f?.fareType || ''); }
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

function fareId(opt, want) {
  if (want === 'FLEXI') {
    const f = (opt?.fares || []).find((x) => /flexi/i.test(ftype(x)));
    return { searchId: f?.searchId || null, fareType: ftype(f) };
  }
  const f = (opt?.fares || []).find((x) => /normal/i.test(ftype(x))) || opt?.fares?.[0];
  return { searchId: f?.searchId || opt?.searchId || pickFareSearchId(opt, { fareType: want }), fareType: ftype(f) };
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
  payload.data.contact.email = `ft.book.${uniqueTag()}@travelvip.ai`;
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

async function main() {
  process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
  const session = await authenticate(true);
  const flight = new FlightService(session.client);
  const rows = [];

  const body = buildRoundTripSearchBody(30, 37, { origin: 'DEL', destination: 'BOM', fareType: 'NORMAL' });
  const rt = await pollRoundTripSearch(flight, body, { fareType: 'NORMAL' }, { maxPolls: 12 });
  console.log('unfiltered pairs', rt.pairs?.length);

  // 1) same Normal/Normal from a valid pair (control that fareTypes selection of Normal still books)
  let same = null;
  for (const p of rt.pairs || []) {
    const o = fareId(p.onward.opt, 'NORMAL');
    const r = fareId(p.ret.opt, 'NORMAL');
    if (!o.searchId || !r.searchId) continue;
    console.log('\n=== RT-DOM-SAME-NORMAL', p.onward.label, '+', p.ret.label, o.fareType, r.fareType);
    same = await issue(flight, [o.searchId, r.searchId], false, 21);
    same.selected = { onward: o, ret: r, flights: `${p.onward.label} | ${p.ret.label}` };
    console.log(same);
    if (same.priceId || same.detailsCode) {
      rows.push({ id: 'RT-DOM-SAME-NORMAL', ...same });
      if (same.br) break;
      if (same.pricingCode === 'VENDOR_ERROR') continue;
      break;
    }
  }

  // 2) different Normal onward + Flexi return on a pair that has both
  let diff = null;
  for (const p of rt.pairs || []) {
    const o = fareId(p.onward.opt, 'NORMAL');
    const r = fareId(p.ret.opt, 'FLEXI');
    if (!o.searchId || !r.searchId) continue;
    console.log('\n=== RT-DOM-DIFF-NORMAL-FLEXI', p.onward.label, '+', p.ret.label, o.fareType, r.fareType);
    diff = await issue(flight, [o.searchId, r.searchId], false, 22);
    diff.selected = { onward: o, ret: r, flights: `${p.onward.label} | ${p.ret.label}` };
    console.log(diff);
    rows.push({ id: 'RT-DOM-DIFF-NORMAL-FLEXI', ...diff });
    if (diff.br) break;
    if (diff.detailsCode === 'INVALID_COMBINATION') {
      // expected for some mixes; keep looking for a combinable pair
      continue;
    }
    if (diff.pricingCode === 'VENDOR_ERROR') continue;
    break;
  }

  // 3) intl unfiltered pair — same published fare both legs (pricing often VENDOR_ERROR on BOM-DXB)
  const intlBody = buildRoundTripSearchBody(32, 39, { origin: 'BOM', destination: 'DXB', fareType: 'NORMAL' });
  const intl = await pollRoundTripSearch(flight, intlBody, { fareType: 'NORMAL' }, { maxPolls: 10 });
  console.log('\nintl pairs', intl.pairs?.length);
  const ip = intl.pairs?.[0];
  if (ip) {
    console.log('=== RT-INTL-UNFILTERED-PAIR', ip.onward.label, '+', ip.ret.label);
    const booked = await issue(flight, ip.searchIds, true, 23);
    booked.selected = { searchIds: ip.searchIds, flights: `${ip.onward.label} | ${ip.ret.label}` };
    console.log(booked);
    rows.push({ id: 'RT-INTL-UNFILTERED-PAIR', ...booked });
  }

  const scored = rows.map((r) => {
    let status = 'BUG';
    if (r.br && (r.status === 'Confirmed' || r.status === 'Inprogress')) status = 'PASS';
    else if (r.detailsCode === 'INVALID_COMBINATION') status = 'PASS';
    else if (r.pricingCode === 'VENDOR_ERROR') status = 'NOT TESTED';
    else if (!r.priceId && !r.br) status = 'BUG';
    return { id: r.id, status, br: r.br, bookingStatus: r.status, details: `${r.detailsHttp} ${r.detailsCode || ''}`, pricing: `${r.pricingHttp} ${r.pricingCode || r.priceId || ''}`, selected: r.selected };
  });
  const counts = scored.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
  fs.writeFileSync('reports/flight-faretypes-rt-valid-pair-book.json', JSON.stringify({ counts, scored, rows }, null, 2));
  console.log('\nSaved reports/flight-faretypes-rt-valid-pair-book.json', counts);
}

main().catch((e) => { console.error(e); process.exit(1); });
