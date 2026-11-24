/**
 * Canary catalog_v1 matrix — Lounge + Fast Track + eSIM (vgm wallet new-flow).
 * Also probes old-flow reads on canary-api (pid/key) and notes canary-shop SPA.
 *
 *   BASE_URL=https://canary-api.travelvip.ai node inventory/scripts/probe-canary-catalog-v1-matrix.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { authenticate } from '../../shared/lib/authService.js';
import { config } from '../../shared/config/env.js';
import { createRequestId } from '../../shared/lib/signature.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'reports', 'canary-catalog-v1');
fs.mkdirSync(OUT_DIR, { recursive: true });

const Q = { lang: 'en', currency: 'INR' };
const report = {
  at: new Date().toISOString(),
  base: config.baseUrl,
  partner: config.partnerId,
  products: { lounge: {}, fasttrack: {}, esim: {} },
  oldFlow: {},
  gate: {},
  cases: [],
};

function ok(res) {
  return res.ok || (res.status >= 200 && res.status < 300);
}

function brief(d, n = 400) {
  return JSON.stringify(d ?? null).slice(0, n);
}

function addDays(days) {
  const d = new Date(Date.now() + days * 86400000);
  return d.toISOString().slice(0, 10);
}

function record(caseId, product, status, extra = {}) {
  const row = { caseId, product, status, ...extra };
  report.cases.push(row);
  console.log(`=> ${caseId} [${product}] ${status}${extra.br ? ` br=${extra.br}` : ''}${extra.note ? ` | ${extra.note}` : ''}`);
  return row;
}

async function req(client, opts) {
  const requestId = opts.requestId || createRequestId();
  return client.request({
    ...opts,
    correlation: true,
    partnerKey: opts.partnerKey === undefined ? client.partnerKey : opts.partnerKey,
    extraHeaders: {
      'X-Request-Id': requestId,
      ...(opts.extraHeaders || {}),
    },
  });
}

function contact() {
  return {
    email: `canary.catalog.${Date.now()}@travelvip.ai`,
    countryCode: config.flight?.contactCountryCode || '+91',
    mobile: config.flight?.contactMobile || '9876543210',
  };
}

function leadPax({ isLead = true } = {}) {
  // letters only — API rejects digits in names
  const suffix = Date.now().toString(36).replace(/[0-9]/g, 'x').slice(-4);
  return {
    paxType: 'ADT',
    isLead,
    profile: {
      title: 'Mr',
      firstName: config.flight?.passengerFirstName || 'Rohan',
      lastName: `Catalog${suffix}`,
      gender: 'MALE',
      dob: config.flight?.passengerDob || '2001-05-29',
      nationality: 'IN',
    },
  };
}

async function pickLounge(client) {
  const search = await req(client, {
    method: 'GET',
    path: '/v1/airports/search',
    query: { ...Q, page: 0, perpage: 20, q: 'bom' },
  });
  const airports = search.data?.results || [];
  for (const a of airports) {
    const airportId = a.airportId || a.id;
    if (!airportId) continue;
    for (const terminal of ['Terminal 1', 'Terminal 2', 'Terminal 3']) {
      const list = await req(client, {
        method: 'GET',
        path: '/v1/lounges',
        query: { ...Q, page: 0, perpage: 10, airportId, terminal },
      });
      const lounges = list.data?.results || [];
      for (const lounge of lounges) {
        const productId = lounge.productId;
        const optionId = lounge.availableOptions?.[0]?.optionId || lounge.options?.[0]?.optionId;
        if (!productId || !optionId) continue;
        const detail = await req(client, {
          method: 'GET',
          path: `/v1/lounges/${productId}`,
          query: { ...Q, optionId },
        });
        for (const item of detail.data?.results || []) {
          for (const o of item.options || item.availableOptions || []) {
            const bookingContext = o.bookingContext || o.bookingReference;
            if (bookingContext) {
              return {
                airportId, terminal, productId, optionId, bookingContext, offerId: o.offerId || null,
              };
            }
          }
        }
      }
    }
  }
  throw new Error('no lounge inventory');
}

async function pickFastTrack(client) {
  // Apidog sample uses airportId=3110 + Terminal 2 + Departure
  const seedAirports = [{ airportId: 3110, airportCode: 'HAK' }];
  const queries = ['hak', 'del', 'bom', 'dxb', 'sin', 'lhr', 'cdg'];
  for (const q of queries) {
    const search = await req(client, {
      method: 'GET',
      path: '/v1/fasttracks/airports/search',
      query: { ...Q, page: 0, perpage: 10, q },
    });
    for (const a of search.data?.results || []) {
      if (a.airportId) seedAirports.push({ airportId: a.airportId, airportCode: a.airportCode });
    }
  }
  const seen = new Set();
  const airports = seedAirports.filter((a) => {
    const k = String(a.airportId);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  for (const a of airports) {
    for (const terminal of ['Terminal 2', 'Terminal 1', 'Terminal 3', 'T1', 'T2']) {
      for (const terminalSide of ['Departure', 'Arrival']) {
        const list = await req(client, {
          method: 'GET',
          path: '/v1/fasttracks',
          query: {
            ...Q,
            page: 0,
            perpage: 10,
            airportId: a.airportId,
            terminal,
            terminalSide,
          },
        });
        const items = list.data?.results || [];
        for (const ft of items) {
          const productId = ft.productId || ft.id;
          const optionId = ft.availableOptions?.[0]?.optionId || ft.options?.[0]?.optionId;
          if (!productId) continue;
          const detail = await req(client, {
            method: 'GET',
            path: `/v1/fasttracks/${productId}`,
            query: { ...Q, ...(optionId ? { optionId } : {}) },
          });
          const detailItems = detail.data?.results || (detail.data ? [detail.data] : []);
          for (const item of detailItems) {
            for (const o of item?.options || item?.availableOptions || []) {
              const bookingContext = o.bookingContext || o.bookingReference;
              if (bookingContext) {
                return {
                  airportId: a.airportId,
                  airportCode: a.airportCode,
                  terminal,
                  terminalSide,
                  productId,
                  optionId: o.optionId || optionId,
                  bookingContext,
                };
              }
            }
          }
        }
      }
    }
  }
  throw new Error('no fasttrack inventory');
}

async function pickEsim(client) {
  const search = await req(client, {
    method: 'GET',
    path: '/v1/esim/search',
    query: { ...Q, page: 1, perpage: 20, q: 'singapore' },
  });
  const countries = search.data?.results || [];
  if (!countries.length) throw new Error('no esim search results');
  const country = countries[0];
  const entityId = country.entityId || country.id || country.productId;
  const listing = await req(client, {
    method: 'GET',
    path: `/v1/esims/${entityId}`,
    query: Q,
  });
  const plans = listing.data?.results || [];
  let pick = null;
  for (const plan of plans) {
    for (const opt of plan.options || plan.availableOptions || []) {
      for (const variant of opt.variants || []) {
        const bookingContext = variant.bookingContext || variant.bookingReference;
        if (!bookingContext) continue;
        const amount = Number(
          variant.pricing?.totalAmount
          ?? variant.price?.totalAmount
          ?? variant.totalAmount
          ?? opt.startingPrice
          ?? plan.startingPrice
          ?? 999999,
        );
        if (!pick || amount < pick.amount) {
          pick = {
            entityId,
            productId: plan.productId,
            optionId: opt.optionId,
            variantId: variant.variantId,
            bookingContext,
            amount,
            title: plan.title,
          };
        }
      }
    }
  }
  if (!pick) throw new Error('no esim variant with bookingContext');
  return pick;
}

async function pollStatus(client, statusPath, br) {
  let status = null;
  let last = null;
  for (let i = 0; i < 10; i += 1) {
    last = await req(client, {
      method: 'GET',
      path: statusPath.replace('{br}', br),
      query: Q,
    });
    status = last.data?.status || last.data?.bookingStatus || status;
    if (/Confirm|Fail|Cancel/i.test(String(status || ''))) break;
    await new Promise((r) => setTimeout(r, 2500));
  }
  return { status, last };
}

async function runW1(client, product, inv, finalizePath, statusPath, detailsPath, historyPath, bodyBuilder) {
  const requestId = `canary-w1-${product}-${randomUUID()}`;
  const body = bodyBuilder(inv);
  const fin = await req(client, {
    method: 'POST',
    path: finalizePath,
    query: Q,
    body,
    requestId,
  });
  const br = fin.data?.bookingRefId
    || fin.data?.bookingReferenceId
    || fin.data?.bookingReference
    || fin.data?.error?.bookingReference
    || null;
  const code = fin.data?.error?.code || fin.data?.code || null;
  if (!ok(fin) || !br) {
    record('W1', product, 'BUG', {
      http: fin.status, code, br, note: brief(fin.data), requestId,
    });
    report.products[product].W1 = { status: 'BUG', http: fin.status, code, data: brief(fin.data, 800) };
    return null;
  }
  const polled = await pollStatus(client, statusPath, br);
  const details = await req(client, { method: 'GET', path: detailsPath.replace('{br}', br), query: Q });
  const history = await req(client, { method: 'GET', path: historyPath, query: { ...Q, page: 0, perpage: 10 } });
  const finalStatus = polled.status || fin.data?.status;
  const pass = /Pending|Confirm|Inprogress|Success/i.test(String(finalStatus || 'Pending'));
  record('W1', product, pass ? 'PASS' : 'CHECK', {
    br, http: fin.status, finalStatus, requestId,
    note: `details=${details.status} history=${history.status}`,
  });
  record('R1', product, ok(polled.last) ? 'PASS' : 'BUG', { br, finalStatus });
  record('R2', product, ok(details) ? 'PASS' : 'BUG', { br });
  record('R3', product, ok(history) ? 'PASS' : 'BUG', { br });
  report.products[product].W1 = {
    status: pass ? 'PASS' : 'CHECK',
    br,
    http: fin.status,
    finalStatus,
    requestId,
    detailsHttp: details.status,
    historyHttp: history.status,
  };
  report.products[product].inventory = inv;
  return { br, body, requestId, fin };
}

async function runNegatives(client, product, inv, finalizePath, bodyBuilder) {
  // W4 missing partner key
  {
    const res = await req(client, {
      method: 'POST',
      path: finalizePath,
      query: Q,
      body: bodyBuilder(inv),
      partnerKey: null,
      extraHeaders: { 'X-Partner-Key': '' },
      requestId: `canary-w4-${product}-${randomUUID()}`,
    });
    const code = res.data?.error?.code || res.data?.code;
    const pass = res.status === 401 || res.status === 403
      || /MISSING_HEADER|PARTNER|UNAUTHORIZED|FORBIDDEN|INVALID/i.test(String(code || ''));
    record('W4', product, pass ? 'PASS' : 'BUG', { http: res.status, code, note: brief(res.data, 200) });
  }

  // W6 currency mismatch
  {
    const res = await req(client, {
      method: 'POST',
      path: finalizePath,
      query: { lang: 'en', currency: 'USD' },
      body: bodyBuilder(inv),
      requestId: `canary-w6-${product}-${randomUUID()}`,
    });
    const code = res.data?.error?.code || res.data?.code;
    const pass = res.status === 400 && /CURRENCY_MISMATCH/i.test(String(code || ''))
      || /CURRENCY_MISMATCH/i.test(JSON.stringify(res.data || {}));
    record('W6', product, pass ? 'PASS' : (res.status >= 400 ? 'CHECK' : 'BUG'), {
      http: res.status, code, note: brief(res.data, 220),
    });
  }

  // V1 empty body
  {
    const res = await req(client, {
      method: 'POST',
      path: finalizePath,
      query: Q,
      body: {},
      requestId: `canary-v1-${product}-${randomUUID()}`,
    });
    const code = res.data?.error?.code || res.data?.code;
    const pass = res.status === 400 && /VALID/i.test(String(code || 'VALIDATION_ERROR'));
    record('V1', product, pass || res.status === 400 ? 'PASS' : 'BUG', { http: res.status, code });
  }

  // V2 bad bookingContext
  {
    const bad = bodyBuilder(inv);
    bad.bookingContext = 'tampered-invalid-context';
    const res = await req(client, {
      method: 'POST',
      path: finalizePath,
      query: Q,
      body: bad,
      requestId: `canary-v2-${product}-${randomUUID()}`,
    });
    const code = res.data?.error?.code || res.data?.code;
    const pass = res.status >= 400 && /BOOKING_CONTEXT|VALID|INVALID/i.test(String(code || ''));
    record('V2', product, pass || res.status >= 400 ? 'PASS' : 'BUG', { http: res.status, code });
  }

  // I1 same X-Request-Id twice (use fresh inventory context if possible — same body)
  {
    const requestId = `canary-i1-${product}-${randomUUID()}`;
    const body = bodyBuilder(inv);
    // mutate contact so we don't hit W1 cache; keep requestId same for both
    body.contact = { ...body.contact, email: `i1.${Date.now()}@travelvip.ai` };
    const first = await req(client, {
      method: 'POST', path: finalizePath, query: Q, body, requestId,
    });
    const second = await req(client, {
      method: 'POST', path: finalizePath, query: Q, body, requestId,
    });
    const br1 = first.data?.bookingRefId || first.data?.bookingReference;
    const br2 = second.data?.bookingRefId || second.data?.bookingReference;
    const same = br1 && br2 && br1 === br2;
    const pass = same || (ok(first) && ok(second) && brief(first.data) === brief(second.data));
    record('I1', product, pass ? 'PASS' : 'CHECK', {
      http1: first.status, http2: second.status, br1, br2, requestId,
      note: `sameBR=${same}`,
    });
  }
}

async function oldFlowSmoke(client) {
  // Old APIs need pid + legacy key query (from Apidog: key=palsgcvgscvvs or ojny1swtigd4as)
  const pid = config.partnerId;
  const keyCandidates = [
    config.flight?.issueTicketQuery?.key,
    process.env.LEGACY_PARTNER_KEY,
    'palsgcvgscvvs',
    'ojny1swtigd4as',
    client.partnerKey,
  ].filter(Boolean);
  let key = keyCandidates[0];
  // probe offers until a key works
  for (const k of keyCandidates) {
    const probe = await req(client, {
      method: 'GET',
      path: '/api/airportServices/offers',
      query: { lang: 'en', pid, key: k },
      requestId: `canary-old-keyprobe-${randomUUID()}`,
    });
    if (ok(probe) || probe.status === 400 || probe.data?.error?.code !== 'INVALID_PARTNER_KEY') {
      key = k;
      report.oldFlow.keyUsed = k === client.partnerKey ? 'session_partnerKey' : String(k).slice(0, 6) + '…';
      break;
    }
  }
  const attempts = [
    {
      id: 'L5_history',
      method: 'GET',
      path: '/api/airportServices/getAirportServiceBookingHistory',
      query: { lang: 'en', page: 0, perpage: 5, pid, key },
    },
    {
      id: 'L8_offers',
      method: 'GET',
      path: '/api/airportServices/offers',
      query: { lang: 'en', pid, key },
    },
    {
      id: 'L5_fetch_status_shape',
      method: 'GET',
      path: '/api/airportServices/fetchBookingStatus',
      query: { lang: 'en', pid, key, bookingId: 'BR0000000000000001' },
    },
  ];
  for (const a of attempts) {
    const res = await req(client, {
      method: a.method,
      path: a.path,
      query: a.query,
      requestId: `canary-old-${a.id}-${randomUUID()}`,
    });
    const html = typeof res.data === 'string' && res.data.includes('<!DOCTYPE html>');
    const code = res.data?.error?.code || res.data?.code;
    let status = 'CHECK';
    if (html) status = 'BUG';
    else if (ok(res) || res.status === 404 || res.status === 400) status = 'PASS';
    else if (res.status === 403 || res.status === 401) status = 'CHECK';
    record(a.id, 'old', status, { http: res.status, code, note: brief(res.data, 180) });
    report.oldFlow[a.id] = { status, http: res.status, code, brief: brief(res.data, 300) };
  }
}

async function main() {
  console.log('BASE', config.baseUrl, 'partner', config.partnerId);
  report.gate.auth = 'pending';
  const { client } = await authenticate(true);
  report.gate.auth = 'PASS';

  // Phase 0 read smokes
  const loungeSearch = await req(client, {
    method: 'GET', path: '/v1/airports/search', query: { ...Q, page: 0, perpage: 5, q: 'bom' },
  });
  const ftSearch = await req(client, {
    method: 'GET', path: '/v1/fasttracks/airports/search', query: { ...Q, page: 0, perpage: 5, q: 'del' },
  });
  const esimSearch = await req(client, {
    method: 'GET', path: '/v1/esim/search', query: { ...Q, page: 1, perpage: 5, q: 'singapore' },
  });
  report.gate.loungeSearch = { http: loungeSearch.status, n: loungeSearch.data?.results?.length };
  report.gate.ftSearch = { http: ftSearch.status, n: ftSearch.data?.results?.length || ftSearch.data?.totalCount };
  report.gate.esimSearch = { http: esimSearch.status, n: esimSearch.data?.results?.length };
  record('P0_search', 'lounge', ok(loungeSearch) ? 'PASS' : 'BUG', { http: loungeSearch.status });
  record('P0_search', 'fasttrack', ok(ftSearch) ? 'PASS' : 'BUG', { http: ftSearch.status });
  record('P0_search', 'esim', ok(esimSearch) ? 'PASS' : 'BUG', { http: esimSearch.status });

  // Lounge W1 + negatives
  let loungeInv = null;
  try {
    loungeInv = await pickLounge(client);
    await runW1(
      client,
      'lounge',
      loungeInv,
      '/v1/airportServices/lounges/finalize-booking',
      '/v1/airportServices/lounge/{br}/status',
      '/v1/airportServices/lounge/booking/{br}',
      '/v1/airportServices/lounge/booking/history',
      (inv) => ({
        bookingContext: inv.bookingContext,
        travelDate: addDays(7),
        travelTime: '07:20',
        passengers: [leadPax()],
        contact: contact(),
      }),
    );
    await runNegatives(
      client,
      'lounge',
      loungeInv,
      '/v1/airportServices/lounges/finalize-booking',
      (inv) => ({
        bookingContext: inv.bookingContext,
        travelDate: addDays(8),
        travelTime: '08:00',
        passengers: [leadPax()],
        contact: contact(),
      }),
    );
  } catch (e) {
    record('W1', 'lounge', 'BUG', { note: e.message });
  }

  // Fast Track W1 + negatives
  let ftInv = null;
  try {
    ftInv = await pickFastTrack(client);
    await runW1(
      client,
      'fasttrack',
      ftInv,
      '/v1/airportServices/fasttracks/finalize-booking',
      '/v1/airportServices/fasttrack/{br}/status',
      '/v1/airportServices/fasttrack/booking/{br}',
      '/v1/airportServices/fasttrack/booking/history',
      (inv) => ({
        bookingContext: inv.bookingContext,
        travelDate: addDays(5),
        travelTime: '10:00',
        passengers: [leadPax()],
        contact: contact(),
      }),
    );
    await runNegatives(
      client,
      'fasttrack',
      ftInv,
      '/v1/airportServices/fasttracks/finalize-booking',
      (inv) => ({
        bookingContext: inv.bookingContext,
        travelDate: addDays(6),
        travelTime: '11:00',
        passengers: [leadPax()],
        contact: contact(),
      }),
    );
  } catch (e) {
    record('W1', 'fasttrack', 'BUG', { note: e.message });
  }

  // eSIM W1 + negatives
  let esimInv = null;
  try {
    esimInv = await pickEsim(client);
    await runW1(
      client,
      'esim',
      esimInv,
      '/v1/esims/finalize-booking',
      '/v1/esim/{br}/status',
      '/v1/esim/booking/{br}',
      '/v1/esim/booking/history',
      (inv) => ({
        bookingContext: inv.bookingContext,
        passengers: [{
          paxType: 'ADT',
          profile: leadPax().profile,
        }],
        contact: contact(),
      }),
    );
    await runNegatives(
      client,
      'esim',
      esimInv,
      '/v1/esims/finalize-booking',
      (inv) => ({
        bookingContext: inv.bookingContext,
        passengers: [{ paxType: 'ADT', profile: leadPax().profile }],
        contact: contact(),
      }),
    );
  } catch (e) {
    record('W1', 'esim', 'BUG', { note: e.message });
  }

  // Old-flow smoke on same API host (canary-shop is SPA)
  await oldFlowSmoke(client);
  report.oldFlow.note = 'canary-shop.travelvip.ai returns SPA HTML for /api/*; old API probes run on canary-api with pid+key';

  // DB helper for user
  const brs = ['lounge', 'fasttrack', 'esim']
    .map((p) => report.products[p]?.W1?.br)
    .filter(Boolean);
  report.dbSql = brs.map((br) => `SET @br := '${br}';
SELECT b.booking_reference, bi.id AS booking_item_id, bi.service_type,
       lounge.booking_flow AS lounge_flow, ft.booking_flow AS ft_flow, esim.booking_flow AS esim_flow
FROM booking b
JOIN booking_item bi ON bi.booking_id = b.id
LEFT JOIN booking_item_lounge lounge ON lounge.booking_item_id = bi.id
LEFT JOIN booking_item_fast_track ft ON ft.booking_item_id = bi.id
LEFT JOIN booking_item_esim esim ON esim.booking_item_id = bi.id
WHERE b.booking_reference = @br;`).join('\n\n');

  const outPath = path.join(OUT_DIR, 'matrix-latest.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log('\nWrote', outPath);
  console.log('\n=== SUMMARY ===');
  for (const c of report.cases) {
    console.log(`${c.caseId.padEnd(16)} ${String(c.product).padEnd(10)} ${c.status} ${c.br || ''} ${c.note || c.code || ''}`);
  }
  if (brs.length) {
    console.log('\nDB check BRs:', brs.join(', '));
    console.log(report.dbSql);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
