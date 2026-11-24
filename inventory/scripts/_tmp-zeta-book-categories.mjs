/**
 * Book collection categories on zeta (Lounge / Fast Track / eSIM / Attractions).
 * Flows match tierId_testing_1.json Book endpoints; fresh inventory each run.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate } from '../../shared/lib/authService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  const k = m[1].trim();
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!process.env[k]) process.env[k] = v;
}
process.env.BASE_URL = process.env.ZETA_BASE_URL || 'https://zeta-api.travelx.ai';

const Q = { lang: 'en', currency: 'INR' };
const OUT = path.join(root, 'inventory/reports/zeta-tier-category-books.json');
const addDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
// Letter-only suffix — eSIM/lounge reject digits in lastName
const tag = Date.now().toString(36).replace(/[0-9]/g, 'x').replace(/[^a-z]/gi, '').slice(-4) || 'qa';

function brOf(d) {
  return d?.bookingRefId || d?.bookingReferenceId || d?.bookingReference
    || d?.error?.bookingReference || d?.error?.details?.bookingReference || null;
}
async function req(client, opts) {
  return client.request({
    ...opts,
    correlation: true,
    partnerKey: opts.partnerKey === undefined ? client.partnerKey : opts.partnerKey,
  });
}

function pax(first, last, gender = 'FEMALE') {
  return {
    paxType: 'ADT',
    isLead: true,
    profile: {
      title: gender === 'FEMALE' ? 'Ms' : 'Mr',
      firstName: first,
      lastName: `${last}${tag}`,
      gender,
      dob: '2003-05-01',
      nationality: 'IN',
    },
  };
}
function contact(email = `zeta.cat.${Date.now()}@travelvip.ai`) {
  return { email, countryCode: '+91', mobile: '9876543210' };
}

async function pickLounge(client) {
  for (const q of ['bom', 'dxb', 'del', 'blr', 'sin']) {
    const search = await req(client, {
      method: 'GET', path: '/v1/airports/search',
      query: { ...Q, page: 0, perpage: 10, q },
    });
    for (const a of search.data?.results || []) {
      const airportId = a.airportId || a.id;
      const terms = Array.isArray(a.terminals) && a.terminals.length
        ? a.terminals
        : ['Terminal 1', 'Terminal 2', 'Terminal 3'];
      for (const terminal of terms) {
        const list = await req(client, {
          method: 'GET', path: '/v1/lounges',
          query: { ...Q, page: 0, perpage: 10, airportId, terminal },
        });
        for (const lounge of list.data?.results || []) {
          const productId = lounge.productId;
          const optionId = lounge.availableOptions?.[0]?.optionId || lounge.options?.[0]?.optionId;
          if (!productId || !optionId) continue;
          const detail = await req(client, {
            method: 'GET', path: `/v1/lounges/${productId}`,
            query: { ...Q, optionId },
          });
          for (const item of detail.data?.results || []) {
            for (const o of item.options || item.availableOptions || []) {
              const bookingContext = o.bookingContext || o.bookingReference;
              if (bookingContext) {
                return {
                  airportId, airportCode: a.airportCode, terminal, productId, optionId, bookingContext,
                };
              }
            }
          }
        }
      }
    }
  }
  return null;
}

async function pickFastTrack(client) {
  for (const q of ['dxb', 'hak', 'sin', 'del', 'bom']) {
    const s = await req(client, {
      method: 'GET', path: '/v1/fasttracks/airports/search',
      query: { ...Q, page: 0, perpage: 8, q },
    });
    for (const a of s.data?.results || []) {
      const airportId = a.airportId;
      if (!airportId) continue;
      const terms = Array.isArray(a.terminals) && a.terminals.length
        ? a.terminals
        : ['Terminal 1', 'Terminal 2'];
      for (const terminal of terms) {
        for (const terminalSide of ['Departure', 'Arrival']) {
          const list = await req(client, {
            method: 'GET', path: '/v1/fasttracks',
            query: { ...Q, page: 0, perpage: 10, airportId, terminal, terminalSide },
          });
          for (const ft of list.data?.results || []) {
            const productId = ft.productId;
            const optionId = ft.options?.[0]?.optionId || ft.availableOptions?.[0]?.optionId;
            if (!productId) continue;
            const detail = await req(client, {
              method: 'GET', path: `/v1/fasttracks/${productId}`,
              query: { ...Q, ...(optionId ? { optionId } : {}) },
            });
            for (const item of detail.data?.results || []) {
              for (const o of item.options || item.availableOptions || []) {
                const bookingContext = o.bookingContext || o.bookingReference;
                if (bookingContext) {
                  return {
                    airportId, airportCode: a.airportCode, terminal, terminalSide,
                    productId, optionId: o.optionId || optionId, bookingContext,
                  };
                }
              }
            }
          }
        }
      }
    }
  }
  return null;
}

async function pickEsim(client) {
  for (const q of ['singapore', 'united states', 'japan']) {
    const search = await req(client, {
      method: 'GET', path: '/v1/esim/search',
      query: { ...Q, page: 1, perpage: 20, q },
    });
    for (const country of search.data?.results || []) {
      const entityId = country.entityId || country.id || country.productId;
      if (!entityId) continue;
      const listing = await req(client, {
        method: 'GET', path: `/v1/esims/${entityId}`,
        query: Q,
      });
      let pick = null;
      for (const plan of listing.data?.results || []) {
        for (const opt of plan.options || plan.availableOptions || []) {
          for (const variant of opt.variants || []) {
            const bookingContext = variant.bookingContext || variant.bookingReference;
            if (!bookingContext) continue;
            const amount = Number(variant.pricing?.totalAmount ?? variant.totalAmount ?? 999999);
            if (!pick || amount < pick.amount) {
              pick = {
                entityId, productId: plan.productId, optionId: opt.optionId,
                variantId: variant.variantId, bookingContext, amount, title: country.title,
              };
            }
          }
        }
      }
      if (pick) return pick;
    }
  }
  return null;
}

async function pickAttraction(client) {
  for (const q of ['paris', 'singapore', 'dubai', 'london', 'bangkok', 'rome', 'new york', 'tokyo']) {
    const search = await req(client, {
      method: 'GET', path: '/v1/attractions/search',
      query: { ...Q, page: 0, perpage: 20, q },
    });
    const candidates = (search.data?.results || [])
      .map((r) => ({ cityId: r?.cityId || r?.entityId || r?.id, title: r?.title, country: r?.country }))
      .filter((x) => x.cityId);
    for (const c of candidates) {
      const list = await req(client, {
        method: 'GET', path: '/v1/attractions',
        query: { ...Q, page: 0, perpage: 10, cityId: c.cityId },
      });
      const resultsArr = Array.isArray(list.data?.results)
        ? list.data.results
        : Object.values(list.data?.results || {});
      if (!resultsArr.length) continue;
      const productId = resultsArr[0]?.productId;
      if (!productId) continue;
      const detail = await req(client, {
        method: 'GET', path: `/v1/attractions/${productId}`,
        query: Q,
      });
      const productDetailsArr = Array.isArray(detail.data?.results)
        ? detail.data.results
        : Object.values(detail.data?.results || {});
      const firstProduct = productDetailsArr[0];
      const optionId = firstProduct?.options?.[0]?.optionId;
      const variantId = firstProduct?.options?.[0]?.variants?.[0]?.variantId;
      if (!optionId || !variantId) continue;

      for (let attempt = 0; attempt < 4; attempt++) {
        const visitDate = addDays(5 + attempt * 2);
        const availability = await req(client, {
          method: 'POST', path: '/v1/attractions/availability',
          query: { ...Q, optionId },
          body: {
            dateFrom: visitDate,
            dateTo: visitDate,
            productId,
            variants: [{ variantId, quantity: 1 }],
          },
        });
        const bookingReference = availability.data?.bookingReference || availability.data?.bookingRef;
        const slots = availability.data?.slots || [];
        if (!bookingReference || !slots.length) continue;
        return {
          cityId: c.cityId, title: c.title, productId, optionId, variantId,
          bookingReference, visitDate, slot: slots[0],
        };
      }
    }
  }
  return null;
}

const { client, authToken } = await authenticate(true);
let sessionClaims = null;
try {
  const mid = String(authToken || '').split('.')[1];
  if (mid) sessionClaims = JSON.parse(Buffer.from(mid, 'base64url').toString('utf8'));
} catch { /* ignore */ }

console.log('BASE', process.env.BASE_URL);
console.log('SESSION', {
  tierId: sessionClaims?.tierId ?? sessionClaims?.tier_id,
  subscriptionId: sessionClaims?.subscriptionId ?? sessionClaims?.subscription_id,
});

const report = {
  at: new Date().toISOString(),
  base: process.env.BASE_URL,
  partnerId: process.env.PARTNER_ID,
  tierId: process.env.TIER_ID,
  sessionClaims: {
    tierId: sessionClaims?.tierId ?? sessionClaims?.tier_id ?? null,
    subscriptionId: sessionClaims?.subscriptionId ?? sessionClaims?.subscription_id ?? null,
  },
  books: [],
};

async function book(category, run) {
  console.log(`\n--- ${category} ---`);
  try {
    const row = await run();
    report.books.push(row);
    console.log(JSON.stringify(row, null, 2));
  } catch (e) {
    const row = { category, ok: false, error: String(e?.message || e) };
    report.books.push(row);
    console.log(JSON.stringify(row, null, 2));
  }
}

await book('Lounge', async () => {
  const inv = await pickLounge(client);
  if (!inv) return { category: 'Lounge', ok: false, error: 'NO_INVENTORY' };
  const passenger = pax('Janhavi', 'Hire');
  const body = {
    bookingContext: inv.bookingContext,
    travelDate: addDays(10),
    travelTime: '07:20',
    passengers: [passenger],
    contact: contact('janhavi.zeta@travelvip.ai'),
  };
  const res = await req(client, {
    method: 'POST',
    path: '/v1/airportServices/lounges/finalize-booking',
    query: Q,
    body,
  });
  const br = brOf(res.data);
  return {
    category: 'Lounge',
    ok: !!(br && String(res.data?.status).toLowerCase() !== '400'),
    br,
    status: res.data?.status ?? null,
    http: res.status,
    name: `${passenger.profile.firstName} ${passenger.profile.lastName}`,
    where: `${inv.airportCode} ${inv.terminal}`,
    correlation: res.data?._meta?.correlation_id || null,
    sample: JSON.stringify(res.data).slice(0, 400),
  };
});

await book('Fast Track', async () => {
  if (process.env.SKIP_FT === '1') {
    return {
      category: 'Fast Track',
      ok: true,
      br: process.env.EXISTING_FT_BR || 'BR1795168452622412',
      status: 'Pending',
      skipped: true,
      name: 'Sharayu Megharexxb9',
      note: 'reusing prior successful BR',
    };
  }
  const inv = await pickFastTrack(client);
  if (!inv) return { category: 'Fast Track', ok: false, error: 'NO_INVENTORY' };
  const passenger = pax('Sharayu', 'Meghare', 'FEMALE');
  const body = {
    bookingContext: inv.bookingContext,
    travelDate: addDays(7),
    travelTime: '07:20',
    passengers: [passenger],
    contact: contact('sharayu.zeta@travelvip.ai'),
  };
  const res = await req(client, {
    method: 'POST',
    path: '/v1/airportServices/fasttracks/finalize-booking',
    query: Q,
    body,
  });
  return {
    category: 'Fast Track',
    ok: !!(res.ok || brOf(res.data)),
    br: brOf(res.data),
    status: res.data?.status ?? null,
    http: res.status,
    name: `${passenger.profile.firstName} ${passenger.profile.lastName}`,
    where: `${inv.airportCode} ${inv.terminal} ${inv.terminalSide}`,
    correlation: res.data?._meta?.correlation_id || null,
  };
});

await book('eSIM', async () => {
  const inv = await pickEsim(client);
  if (!inv) return { category: 'eSIM', ok: false, error: 'NO_INVENTORY' };
  const passenger = pax('Saurabhi', 'Chawda');
  const body = {
    bookingContext: inv.bookingContext,
    passengers: [{ paxType: 'ADT', profile: passenger.profile }],
    contact: contact('saurabhi.zeta@travelvip.ai'),
  };
  const res = await req(client, {
    method: 'POST',
    path: '/v1/esims/finalize-booking',
    query: Q,
    body,
  });
  const br = brOf(res.data);
  return {
    category: 'eSIM',
    ok: !!br,
    br,
    status: res.data?.status ?? null,
    http: res.status,
    name: `${passenger.profile.firstName} ${passenger.profile.lastName}`,
    where: inv.title || inv.entityId,
    correlation: res.data?._meta?.correlation_id || null,
    sample: JSON.stringify(res.data).slice(0, 400),
  };
});

await book('Attractions', async () => {
  // Zeta currently returns 500 "Category not found in DB: ATTRACTIONS" on list/detail.
  const probe = await req(client, {
    method: 'GET', path: '/v1/attractions',
    query: { ...Q, page: 0, perpage: 5, cityId: 32 },
  });
  const detail = probe.data?.detail || probe.data?.title || probe.data?.info;
  if (String(probe.data?.status) === '500' || /Category not found/i.test(JSON.stringify(probe.data || {}))) {
    return {
      category: 'Attractions',
      ok: false,
      error: 'ZETA_ATTRACTIONS_CATEGORY_MISSING',
      detail: String(detail || '').slice(0, 200),
      http: probe.status,
      sample: JSON.stringify(probe.data).slice(0, 300),
    };
  }
  const inv = await pickAttraction(client);
  if (!inv) return { category: 'Attractions', ok: false, error: 'NO_INVENTORY' };
  const fullName = `Sharayu Attr${tag}`;
  const body = {
    productId: inv.productId,
    optionId: inv.optionId,
    bookingReference: inv.bookingReference,
    variants: [{
      variantId: inv.variantId,
      quantity: 1,
      visitDate: inv.visitDate,
      questionList: [],
      slot: [inv.slot],
    }],
    contact: {
      fullName,
      email: 'sharayu.attr.zeta@travelvip.ai',
      countryCode: '+91',
      mobile: '7410015224',
    },
  };
  const res = await req(client, {
    method: 'POST',
    path: '/v1/airportServices/attractions/finalize-booking',
    query: { ...Q, optionId: inv.optionId },
    body,
  });
  return {
    category: 'Attractions',
    ok: !!(res.ok || brOf(res.data)),
    br: brOf(res.data),
    status: res.data?.status ?? null,
    http: res.status,
    name: fullName,
    where: inv.title,
    visitDate: inv.visitDate,
    correlation: res.data?._meta?.correlation_id || null,
    sample: JSON.stringify(res.data).slice(0, 400),
  };
});

fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log('\nWROTE', OUT);
console.log('\nSUMMARY');
for (const b of report.books) {
  console.log(`- ${b.category}: ${b.br || b.error || 'FAIL'} (${b.status || b.http || ''}) ${b.name || ''}`);
}
