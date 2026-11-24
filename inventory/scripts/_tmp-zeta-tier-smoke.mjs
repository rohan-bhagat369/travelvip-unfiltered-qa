/**
 * Smoke: api-staging (vgm) creds against zeta-api base URL.
 *   node inventory/scripts/_tmp-zeta-tier-smoke.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate } from '../../shared/lib/authService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..');

function loadEnvFile(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const k = m[1].trim();
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnvFile(path.join(root, '.env'));
process.env.BASE_URL = 'https://zeta-api.travelx.ai';

const out = {
  at: new Date().toISOString(),
  base: process.env.BASE_URL,
  partnerId: process.env.PARTNER_ID,
  tierId: process.env.TIER_ID,
  hasSecret: Boolean(process.env.PARTNER_SECRET),
  hasSigning: Boolean(process.env.SIGNING_KEY),
  auth: null,
  calls: [],
};

console.log('BASE', out.base);
console.log('PARTNER_ID', out.partnerId, 'TIER_ID', out.tierId);

try {
  const { client, authToken } = await authenticate(true);
  client.setPartnerKey(client.partnerKey || process.env.PARTNER_ID);
  out.auth = { ok: true, hasAuthToken: Boolean(authToken), partnerKey: client.partnerKey };
  console.log('AUTH OK', out.auth);

  const Q = { lang: 'en', currency: 'INR' };
  const calls = [
    { name: 'v1/airports/search', method: 'GET', path: '/v1/airports/search', query: { ...Q, page: 0, perpage: 5, q: 'del' } },
    { name: 'v1/lounges', method: 'GET', path: '/v1/lounges', query: { ...Q, page: 0, perpage: 5, airportCode: 'DEL' } },
    { name: 'v1/fasttracks/airports/search', method: 'GET', path: '/v1/fasttracks/airports/search', query: { ...Q, page: 0, perpage: 5, q: 'del' } },
    { name: 'v1/fasttracks', method: 'GET', path: '/v1/fasttracks', query: { ...Q, page: 0, perpage: 5, airportCode: 'DEL' } },
    { name: 'v1/esim/search', method: 'GET', path: '/v1/esim/search', query: { ...Q, page: 1, perpage: 5, q: 'singapore' } },
    { name: 'v1/attractions/search', method: 'GET', path: '/v1/attractions/search', query: { ...Q, page: 0, perpage: 5, q: 'singapore' } },
    { name: 'legacy airportServices/search', method: 'GET', path: '/api/airportServices/search', query: { ...Q, page: 0, perpage: 5, q: 'del' } },
    { name: 'legacy esim-services', method: 'GET', path: '/api/airportServices/esim-services', query: { ...Q, page: 0, perpage: 5, q: 'singapore' } },
    {
      name: 'legacy tours-and-attractions/search',
      method: 'GET',
      path: '/api/airportServices/tours-and-attractions/search',
      query: { ...Q, page: 0, perpage: 5, q: 'singapore' },
    },
  ];

  for (const c of calls) {
    try {
      const res = await client.request({
        method: c.method,
        path: c.path,
        query: c.query,
        correlation: true,
        partnerKey: client.partnerKey,
      });
      const d = res.data;
      const row = {
        call: c.name,
        path: c.path,
        http: res.status,
        ok: Boolean(res.ok),
        err: d?.error?.code || d?.code || null,
        sample: JSON.stringify(d).slice(0, 280),
      };
      out.calls.push(row);
      console.log(JSON.stringify(row));
    } catch (e) {
      const row = { call: c.name, path: c.path, exception: e.message };
      out.calls.push(row);
      console.log(JSON.stringify(row));
    }
  }
} catch (e) {
  out.auth = { ok: false, error: e.message };
  console.log('AUTH FAIL', e.message);
}

// Follow-up: lounges/fasttracks with airportId + legacy with pid/key
if (out.auth?.ok) {
  try {
    const { client } = await authenticate(true);
    client.setPartnerKey(client.partnerKey || process.env.PARTNER_ID);
    const Q2 = { lang: 'en', currency: 'INR' };
    const air = await client.request({
      method: 'GET',
      path: '/v1/airports/search',
      query: { ...Q2, page: 0, perpage: 10, q: 'DEL' },
      correlation: true,
      partnerKey: client.partnerKey,
    });
    const del =
      (air.data?.results || []).find((r) => r.airportCode === 'DEL') ||
      (air.data?.results || [])[0];
    out.delAirport = del ? { airportId: del.airportId, airportCode: del.airportCode } : null;
    console.log('DEL pick', out.delAirport);

    if (del?.airportId) {
      for (const p of [
        { name: 'v1/lounges?airportId', path: '/v1/lounges', query: { ...Q2, page: 0, perpage: 5, airportId: del.airportId } },
        { name: 'v1/fasttracks?airportId', path: '/v1/fasttracks', query: { ...Q2, page: 0, perpage: 5, airportId: del.airportId } },
      ]) {
        const res = await client.request({
          method: 'GET',
          path: p.path,
          query: p.query,
          correlation: true,
          partnerKey: client.partnerKey,
        });
        const row = {
          call: p.name,
          http: res.status,
          ok: Boolean(res.ok),
          err: res.data?.error?.code || res.data?.status || null,
          sample: JSON.stringify(res.data).slice(0, 280),
        };
        out.calls.push(row);
        console.log(JSON.stringify(row));
      }
    }

    const pid = process.env.SMT_PID || process.env.LOUNGE_PID || 'smt';
    const key = process.env.SMT_KEY || process.env.LOUNGE_API_KEY || 'palsgcvgscvvs';
    out.legacyAuth = { pid, hasKey: Boolean(key) };
    for (const pathName of [
      '/api/airportServices/search',
      '/api/airportServices/esim-services',
      '/api/airportServices/tours-and-attractions/search',
    ]) {
      const res = await client.request({
        method: 'GET',
        path: pathName,
        query: {
          ...Q2,
          page: 0,
          perpage: 5,
          q: pathName.includes('esim') || pathName.includes('attraction') ? 'singapore' : 'del',
          pid,
          key,
        },
        correlation: true,
        partnerKey: client.partnerKey,
      });
      const row = {
        call: `legacy+pid ${pathName}`,
        http: res.status,
        ok: Boolean(res.ok),
        err: res.data?.error?.code || null,
        sample: JSON.stringify(res.data).slice(0, 280),
      };
      out.calls.push(row);
      console.log(JSON.stringify(row));
    }
  } catch (e) {
    out.followUpError = e.message;
    console.log('FOLLOW-UP FAIL', e.message);
  }
}

const outPath = path.join(root, 'inventory', 'reports', 'zeta-tier-subscription-smoke.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log('WROTE', outPath);
