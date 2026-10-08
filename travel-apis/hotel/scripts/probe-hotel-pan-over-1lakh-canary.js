/**
 * Canary read-only: isPANMandatory on rooms ABOVE and BELOW ₹1 lakh.
 *
 *   $env:BASE_URL='https://canary-api.travelvip.ai'; node scripts/probe-hotel-pan-over-1lakh-canary.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { HotelService } from '../src/service.js';
import { HOTEL_QUERY } from '../src/helpers.js';
import { futureDate } from '../../../shared/lib/testUtils.js';

const OUT = path.join('reports', 'hotel-pan-1lakh-threshold-canary.json');
const THRESHOLD = 100000;
const CITIES = ['Mumbai', 'Pune', 'Dubai'];

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickCity(content, q) {
  const list = content || [];
  return list.find((x) => /CITY/i.test(String(x.type || '')) && new RegExp(`^${q}$`, 'i').test(String(x.title || '').trim()))
    || list.find((x) => /CITY/i.test(String(x.type || '')) && new RegExp(q, 'i').test(x.title || ''))
    || list[0]
    || null;
}

function supplier(code) {
  return String(code || '').split('!TB!')[1] || null;
}

function bucket(amt) {
  if (amt == null) return 'unknown';
  return amt >= THRESHOLD ? '>=1L' : '<1L';
}

function tally(rows) {
  return {
    rooms: rows.length,
    panTrue: rows.filter((r) => r.isPANMandatory === true).length,
    panFalse: rows.filter((r) => r.isPANMandatory === false).length,
    panMissing: rows.filter((r) => r.isPANMandatory == null).length,
    minAmt: rows.length ? Math.min(...rows.map((r) => r.amount)) : null,
    maxAmt: rows.length ? Math.max(...rows.map((r) => r.amount)) : null,
  };
}

async function main() {
  process.env.BASE_URL = process.env.BASE_URL || 'https://canary-api.travelvip.ai';
  console.log('Base', config.baseUrl);
  console.log('PAN flag vs ₹1 lakh — details only, no book');

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const hotel = new HotelService(session.client);
  const client = session.client;

  const checkin = futureDate(21);
  const checkout = futureDate(22); // 1 night
  const roomsOcc = [{ adults: 1, children: 0, childrenAges: [] }];
  const hits = [];
  const scanned = [];

  async function inspectHotel(entityId, label, cityTitle) {
    const details = await hotel.getDetails({
      checkin, checkout, entityId: String(entityId), nationality: 'IN', rooms: roomsOcc,
    });
    if (!details.ok) {
      scanned.push({ label, entityId, http: details.status });
      return;
    }
    const h = details.data?.results?.[0];
    const rooms = (h?.rooms || []).filter((r) => r.available !== false && r.bookingCode);
    let nOver = 0;
    let nUnder = 0;
    for (const r of rooms) {
      const amt = money(r.price?.totalAmount);
      if (amt == null) continue;
      const b = bucket(amt);
      if (b === '>=1L') nOver += 1;
      else nUnder += 1;
      hits.push({
        city: cityTitle,
        hotelId: h?.id,
        hotelName: h?.name || label,
        roomTitle: r.title || r.roomType || (Array.isArray(r.name) ? r.name[0] : r.name),
        amount: amt,
        bucket: b,
        supplier: supplier(r.bookingCode),
        isPANMandatory: r.isPANMandatory,
        hasKey: Object.prototype.hasOwnProperty.call(r, 'isPANMandatory'),
        isGSTClaimable: r.isGSTClaimable ?? r.isGstClaimable ?? null,
      });
    }
    scanned.push({ label, hotelName: h?.name, rooms: rooms.length, nOver, nUnder });
    console.log(`  ${h?.name || label} rooms=${rooms.length} >=1L=${nOver} <1L=${nUnder}`);
  }

  for (const q of CITIES) {
    console.log(`\n=== ${q} ${checkin} → ${checkout} ===`);
    const ac = await hotel.autocomplete(q);
    const city = pickCity(ac.data?.content, q);
    if (!city?.entityId) {
      console.log('  no city');
      continue;
    }
    console.log('  city', city.entityId, city.title);

    const citySearch = await client.request({
      method: 'POST',
      path: '/v1/hotels/search',
      query: { ...HOTEL_QUERY, page: 0, perpage: 30, sortby: 'price,desc' },
      body: {
        checkin, checkout, entityId: String(city.entityId), nationality: 'IN', type: 'CITY', rooms: roomsOcc,
      },
      correlation: true,
      partnerKey: session.accessToken,
    });
    if (!citySearch.ok) {
      console.log('  search fail', citySearch.status);
      continue;
    }
    const results = [...(citySearch.data?.results || [])]
      .filter((h) => h.available !== false)
      .sort((a, b) => (money(b.price?.totalAmount) ?? 0) - (money(a.price?.totalAmount) ?? 0));
    console.log('  hotels', results.length, 'max', results[0]?.name, results[0]?.price?.totalAmount,
      'min', results[results.length - 1]?.name, results[results.length - 1]?.price?.totalAmount);

    const expensive = results.filter((h) => (money(h.price?.totalAmount) ?? 0) >= THRESHOLD).slice(0, 5);
    const cheap = [...results].reverse().slice(0, 5);
    const mid = results.filter((h) => {
      const a = money(h.price?.totalAmount) ?? 0;
      return a > 20000 && a < THRESHOLD;
    }).slice(0, 3);
    const seen = new Set();
    const toOpen = [...expensive, ...cheap, ...mid].filter((h) => {
      if (seen.has(String(h.id))) return false;
      seen.add(String(h.id));
      return true;
    });
    for (const h of toOpen) {
      await inspectHotel(h.id, h.name, city.title);
    }
  }

  const over = hits.filter((h) => h.bucket === '>=1L');
  const under = hits.filter((h) => h.bucket === '<1L');
  const overT = tally(over);
  const underT = tally(under);

  const report = {
    baseUrl: config.baseUrl,
    at: new Date().toISOString(),
    threshold: THRESHOLD,
    checkin,
    checkout,
    occupancy: '1ADT 1N',
    over1L: overT,
    under1L: underT,
    answer: {
      over1L: overT.rooms === 0
        ? 'No rooms >= ₹1 lakh in this sample'
        : (overT.panFalse === 0 && overT.panMissing === 0
          ? 'All sampled rooms >= ₹1 lakh have isPANMandatory=true'
          : `MIXED/NO — >=1L panTrue=${overT.panTrue} panFalse=${overT.panFalse} missing=${overT.panMissing}`),
      under1L: underT.rooms === 0
        ? 'No rooms < ₹1 lakh in this sample'
        : (underT.panTrue === 0
          ? 'All sampled rooms < ₹1 lakh have isPANMandatory=false (or missing)'
          : `NOT only-false — <1L panTrue=${underT.panTrue} panFalse=${underT.panFalse} missing=${underT.panMissing}`),
    },
    sampleOver: over.slice(0, 12),
    sampleUnder: under.slice(0, 12),
    hits,
    scanned,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== OVER 1 LAKH ===', JSON.stringify(overT));
  console.log(report.answer.over1L);
  console.log('=== BELOW 1 LAKH ===', JSON.stringify(underT));
  console.log(report.answer.under1L);
  console.log('Wrote', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
