/**
 * Diagnose cab booking flow (Search → Fare → Finalize → Status → Cancel).
 * Tries staging + canary unless BASE_URL is already set.
 *
 *   node scripts/probe-cab-flow.js
 *   BASE_URL=https://api-staging.travelvip.ai node scripts/probe-cab-flow.js
 */
import { authenticate } from '../../../shared/lib/authService.js';
import { CabService } from '../src/service.js';
import { config } from '../../../shared/config/env.js';
import {
  buildAirportSearchBody,
  buildOutstationSearchBody,
  buildRentalSearchBody,
  futurePickupDatetime,
  pickCab,
  CAB_QUERY,
} from '../src/helpers.js';

const envs = process.env.BASE_URL
  ? [{ name: 'configured', baseUrl: process.env.BASE_URL }]
  : [
      { name: 'staging', baseUrl: 'https://api-staging.travelvip.ai' },
      { name: 'canary', baseUrl: 'https://canary-api.travelvip.ai' },
    ];

function summarize(label, res) {
  return {
    label,
    http: res?.status,
    ok: res?.ok,
    code: res?.data?.code || res?.data?.error?.code || res?.data?.error?.error || null,
    message: res?.data?.message || res?.data?.error?.message || res?.data?.errors?.[0]?.error || null,
    snippet: typeof res?.data === 'string'
      ? res.data.slice(0, 200)
      : JSON.stringify(res?.data || {}).slice(0, 350),
  };
}

async function probeEnv(baseUrl, label) {
  console.log(`\n############## ${label.toUpperCase()} ${baseUrl} ##############`);
  const { TravelVipClient } = await import('../src/lib/TravelVipClient.js');
  const { createRequestId } = await import('../src/lib/signature.js');

  const boot = new TravelVipClient({ baseUrl, signingKey: config.signingKey });

  const tokenRes = await boot.request({
    method: 'POST',
    path: '/auth/partner/token',
    body: {
      partner_id: config.partnerId,
      partner_secret: config.partnerSecret,
    },
    signed: false,
    auth: false,
    extraHeaders: { 'X-Request-Id': createRequestId() },
  });
  if (!tokenRes.ok) {
    console.log('AUTH FAIL', summarize('auth', tokenRes));
    return { label, baseUrl, authOk: false, steps: [summarize('auth', tokenRes)] };
  }

  const sessionRes = await boot.request({
    method: 'POST',
    path: '/v1/auth/session',
    body: { tierId: config.tierId },
    signed: false,
    auth: false,
    partnerKey: tokenRes.data.access_token,
    extraHeaders: { 'X-Request-Id': createRequestId() },
  });
  if (!sessionRes.ok) {
    console.log('SESSION FAIL', summarize('session', sessionRes));
    return { label, baseUrl, authOk: false, steps: [summarize('session', sessionRes)] };
  }

  const client = new TravelVipClient({
    baseUrl,
    signingKey: config.signingKey,
    authToken: sessionRes.data.auth_token,
  });
  const cab = new CabService(client);
  const journeys = [
    { type: 'AIRPORT', body: buildAirportSearchBody(futurePickupDatetime(5)) },
    { type: 'RENTAL', body: buildRentalSearchBody(futurePickupDatetime(5)) },
    { type: 'OUTSTATION', body: buildOutstationSearchBody(futurePickupDatetime(5)) },
  ];

  const report = { label, baseUrl, authOk: true, journeys: [] };

  for (const j of journeys) {
    console.log(`\n=== ${j.type} SEARCH ===`);
    console.log('body pickupDatetime', j.body.pickupDatetime, 'airport', j.body.airportCode || '-');
    const search = await cab.search(j.body);
    const s = summarize('search', search);
    console.log(JSON.stringify(s, null, 2));
    const cabs = search.data?.cabs || [];
    console.log('cab count:', cabs.length);
    if (cabs[0]) {
      console.log('sample cab:', JSON.stringify({
        searchId: cabs[0].searchId,
        fareId: cabs[0].fareId,
        operator: cabs[0].operator?.name,
        vehicle: cabs[0].vehicle?.type || cabs[0].vehicle?.model,
        price: cabs[0].pricing || cabs[0].price,
      }));
    }

    const journeyReport = {
      journeyType: j.type,
      search: s,
      cabCount: cabs.length,
      fare: null,
      finalize: null,
      status: null,
      cancel: null,
      bookingRefId: null,
      bookingStatus: null,
      issue: null,
    };

    if (!search.ok) {
      journeyReport.issue = `Search failed HTTP ${search.status}`;
      report.journeys.push(journeyReport);
      continue;
    }
    if (!cabs.length) {
      journeyReport.issue = 'Search OK but 0 cabs returned';
      report.journeys.push(journeyReport);
      continue;
    }

    // Only full book flow for AIRPORT (one booking) if cabs exist
    if (j.type !== 'AIRPORT') {
      report.journeys.push(journeyReport);
      continue;
    }

    const selected = pickCab(cabs);
    console.log('\n=== FARE ===', selected?.searchId);
    const fare = await cab.fare(selected.searchId);
    const f = summarize('fare', fare);
    console.log(JSON.stringify(f, null, 2));
    journeyReport.fare = f;
    journeyReport.selectedCab = {
      searchId: selected.searchId,
      fareId: selected.fareId,
      operator: selected.operator?.name,
    };

    if (!fare.ok || !fare.data?.bookingReference || !fare.data?.priceId) {
      journeyReport.issue = 'Fare failed or missing bookingReference/priceId';
      report.journeys.push(journeyReport);
      continue;
    }

    console.log('\n=== FINALIZE ===');
    const finalize = await cab.finalizeBooking({
      bookingReference: fare.data.bookingReference,
      priceId: fare.data.priceId,
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
        email: 'chaitanya@travelvip.ai',
        countryCode: '+91',
        mobile: '9921862715',
      },
      otherDetails: 'API automation cab flow probe',
    });
    const fin = summarize('finalize', finalize);
    console.log(JSON.stringify(fin, null, 2));
    journeyReport.finalize = fin;
    const br = finalize.data?.bookingRefId || finalize.data?.bookingReferenceId;
    journeyReport.bookingRefId = br;

    if (!finalize.ok || !br) {
      journeyReport.issue = 'Finalize failed / no BR';
      report.journeys.push(journeyReport);
      continue;
    }

    console.log('\n=== STATUS (poll) ===');
    let statusRes = null;
    for (let i = 0; i < 8; i++) {
      statusRes = await cab.getBookingStatus(br);
      const st = statusRes.data?.status;
      console.log(`  [${i + 1}]`, st, statusRes.status);
      if (st && String(st).toLowerCase() !== 'pending') break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    journeyReport.status = summarize('status', statusRes);
    journeyReport.bookingStatus = statusRes?.data?.status;

    console.log('\n=== CANCEL ===');
    const cancel = await cab.cancelBooking(br);
    console.log(JSON.stringify(summarize('cancel', cancel), null, 2));
    journeyReport.cancel = summarize('cancel', cancel);

    const after = await cab.getBookingStatus(br);
    journeyReport.statusAfterCancel = after.data?.status;
    console.log('Status after cancel:', after.data?.status);

    if (!journeyReport.issue) {
      journeyReport.issue = String(journeyReport.bookingStatus).toLowerCase() === 'confirmed'
        || String(journeyReport.bookingStatus).toLowerCase() === 'pending'
        ? null
        : `Unexpected booking status: ${journeyReport.bookingStatus}`;
    }
    report.journeys.push(journeyReport);
  }

  // Extra helper APIs on AIRPORT env if search worked
  console.log('\n=== HELPERS: locations / autocomplete ===');
  const locations = await client.request({
    method: 'GET',
    path: '/v1/airportServices/cabs/locations',
    query: { lang: 'en', latitude: 18.5679, longitude: 73.9143 },
    correlation: true,
  });
  console.log('locations', summarize('locations', locations));
  report.locations = summarize('locations', locations);

  const ac = await client.request({
    method: 'GET',
    path: '/v1/airportServices/cabs/places/autocomplete',
    query: { lang: 'en', searchText: 'viman nagar' },
    correlation: true,
  });
  console.log('autocomplete', summarize('autocomplete', ac));
  report.autocomplete = summarize('autocomplete', ac);

  return report;
}

async function main() {
  const reports = [];
  for (const env of envs) {
    try {
      reports.push(await probeEnv(env.baseUrl, env.name));
    } catch (e) {
      reports.push({ label: env.name, baseUrl: env.baseUrl, fatal: e.message });
      console.error(env.name, e);
    }
  }

  console.log('\n\n========== CAB FLOW DIAGNOSIS SUMMARY ==========');
  for (const r of reports) {
    console.log(`\n## ${r.label} (${r.baseUrl})`);
    if (r.fatal) {
      console.log('FATAL:', r.fatal);
      continue;
    }
    if (!r.authOk) {
      console.log('AUTH/SESSION failed');
      continue;
    }
    for (const j of r.journeys || []) {
      console.log(`- ${j.journeyType}: search HTTP ${j.search?.http} cabs=${j.cabCount}`
        + (j.fare ? ` | fare HTTP ${j.fare.http}` : '')
        + (j.finalize ? ` | book HTTP ${j.finalize.http} BR=${j.bookingRefId}` : '')
        + (j.bookingStatus ? ` | status=${j.bookingStatus}` : '')
        + (j.cancel ? ` | cancel HTTP ${j.cancel.http}` : '')
        + (j.issue ? ` | ISSUE: ${j.issue}` : ' | OK'));
      if (j.search && !j.search.ok) {
        console.log(`  search error: ${j.search.code || ''} ${j.search.message || ''} ${j.search.snippet}`);
      }
    }
    if (r.locations) console.log(`- locations HTTP ${r.locations.http} ${r.locations.code || ''}`);
    if (r.autocomplete) console.log(`- autocomplete HTTP ${r.autocomplete.http} ${r.autocomplete.code || ''}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
