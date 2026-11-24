/**
 * Zeta finalize-booking smoke — staging vgm creds → zeta-api.
 * Goal: produce a CREATE so Dev can verify tierId/subscriptionId in backend logs.
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
const OUT = path.join(root, 'inventory/reports/zeta-tier-create-booking.json');
const addDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

function brief(d, n = 600) {
  return JSON.stringify(d ?? null).slice(0, n);
}
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

function contact() {
  return {
    email: `zeta.tier.${Date.now()}@travelvip.ai`,
    countryCode: '+91',
    mobile: '9876543210',
  };
}
function leadPax() {
  const suffix = Date.now().toString(36).replace(/[0-9]/g, 'x').slice(-4);
  return {
    paxType: 'ADT',
    isLead: true,
    profile: {
      title: 'Mr',
      firstName: 'Rohan',
      lastName: `Zeta${suffix}`,
      gender: 'MALE',
      dob: '2001-05-29',
      nationality: 'IN',
    },
  };
}

async function pickLounge(client) {
  const seeds = ['bom', 'del', 'blr', 'sin', 'dxb', 'lhr', 'sin', 'Indira Gandhi', 'Chhatrapati'];
  const terminals = ['Terminal 1', 'Terminal 2', 'Terminal 3', 'Main Terminal'];
  for (const q of seeds) {
    const search = await req(client, {
      method: 'GET', path: '/v1/airports/search',
      query: { ...Q, page: 0, perpage: 10, q },
    });
    for (const a of search.data?.results || []) {
      const airportId = a.airportId || a.id;
      const termList = Array.isArray(a.terminals) && a.terminals.length ? a.terminals : terminals;
      for (const terminal of termList) {
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
                  product: 'lounge',
                  airportId,
                  airportCode: a.airportCode,
                  terminal,
                  productId,
                  optionId,
                  bookingContext,
                  price: o.pricing?.totalAmount ?? o.totalAmount ?? null,
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
  for (const q of ['hak', 'del', 'dxb', 'sin', 'bom']) {
    const s = await req(client, {
      method: 'GET', path: '/v1/fasttracks/airports/search',
      query: { ...Q, page: 0, perpage: 8, q },
    });
    for (const a of s.data?.results || []) {
      const airportId = a.airportId;
      if (!airportId) continue;
      const termList = Array.isArray(a.terminals) && a.terminals.length
        ? a.terminals
        : ['Terminal 1', 'Terminal 2'];
      for (const terminal of termList) {
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
                    product: 'fasttrack',
                    airportId,
                    airportCode: a.airportCode,
                    terminal,
                    terminalSide,
                    productId,
                    optionId: o.optionId || optionId,
                    bookingContext,
                    price: o.pricing?.totalAmount ?? o.totalAmount ?? null,
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
  const search = await req(client, {
    method: 'GET', path: '/v1/esim/search',
    query: { ...Q, page: 1, perpage: 20, q: 'singapore' },
  });
  const country = (search.data?.results || [])[0];
  if (!country) return null;
  const entityId = country.entityId || country.id || country.productId;
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
        if (!pick || amount < pick.price) {
          pick = {
            product: 'esim',
            entityId,
            productId: plan.productId,
            optionId: opt.optionId,
            variantId: variant.variantId,
            bookingContext,
            price: amount,
          };
        }
      }
    }
  }
  return pick;
}

const PATHS = {
  lounge: '/v1/airportServices/lounges/finalize-booking',
  fasttrack: '/v1/airportServices/fasttracks/finalize-booking',
  esim: '/v1/esims/finalize-booking',
};

const { client, authToken } = await authenticate(true);
client.setPartnerKey?.(client.partnerKey || process.env.PARTNER_ID);

// Decode session JWT payload (no verify) for tier/sub visibility
let sessionClaims = null;
try {
  const mid = String(authToken || '').split('.')[1];
  if (mid) sessionClaims = JSON.parse(Buffer.from(mid, 'base64url').toString('utf8'));
} catch { /* ignore */ }

console.log('BASE', process.env.BASE_URL);
console.log('PARTNER', process.env.PARTNER_ID, 'TIER', process.env.TIER_ID);
console.log('sessionClaims', {
  tierId: sessionClaims?.tierId ?? sessionClaims?.tier_id,
  subscriptionId: sessionClaims?.subscriptionId ?? sessionClaims?.subscription_id,
  partnerId: sessionClaims?.partnerId ?? sessionClaims?.partner_id ?? sessionClaims?.pid,
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
  inventory: null,
  request: null,
  response: null,
};

let inv = await pickLounge(client);
if (!inv) {
  console.log('no lounge inventory — trying fasttrack');
  inv = await pickFastTrack(client);
}
if (!inv) {
  console.log('no fasttrack inventory — trying esim');
  inv = await pickEsim(client);
}
if (!inv) {
  report.error = 'NO_INVENTORY';
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('NO_INVENTORY — wrote', OUT);
  process.exit(2);
}

report.inventory = { ...inv, bookingContext: String(inv.bookingContext).slice(0, 80) + '…' };
console.log('PICK', report.inventory);

const body = inv.product === 'esim'
  ? {
      bookingContext: inv.bookingContext,
      passengers: [{ paxType: 'ADT', profile: leadPax().profile }],
      contact: contact(),
    }
  : {
      bookingContext: inv.bookingContext,
      travelDate: addDays(inv.product === 'fasttrack' ? 5 : 7),
      travelTime: '10:00',
      timezone: 'Asia/Kolkata',
      passengers: [leadPax()],
      contact: contact(),
    };

const createPath = PATHS[inv.product];
report.request = {
  method: 'POST',
  path: createPath,
  query: Q,
  note: 'Client body does NOT include tierId/subscriptionId — server injects from session into outbound CREATE',
  body: {
    ...body,
    bookingContext: String(body.bookingContext).slice(0, 80) + '…',
  },
};

const res = await req(client, {
  method: 'POST',
  path: createPath,
  query: Q,
  body,
});

const br = brOf(res.data);
report.response = {
  http: res.status,
  ok: res.ok,
  br,
  status: res.data?.status ?? null,
  code: res.data?.error?.code || res.data?.code || null,
  paymentIntentId: res.data?.paymentIntentId || res.data?.payment?.paymentIntentId || null,
  sample: brief(res.data, 1200),
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log('CREATE', JSON.stringify(report.response, null, 2));
console.log('WROTE', OUT);
if (!res.ok && !br) process.exit(1);
