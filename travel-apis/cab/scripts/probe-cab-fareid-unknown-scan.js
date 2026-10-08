/**
 * Scan cab search for fareId === "Unknown" across locations + journey types.
 *   BASE_URL=https://api-staging.travelvip.ai node scripts/probe-cab-fareid-unknown-scan.js
 */
import fs from 'fs';
import { authenticate } from '../../../shared/lib/authService.js';
import { CabService } from '../src/service.js';
import { futurePickupDatetime } from '../src/helpers.js';

const pickupDatetime = futurePickupDatetime(10);

const SCENARIOS = [
  {
    id: 'AIRPORT-DEP-DEL',
    label: 'Airport DEPARTURE — Delhi (Vasant Kunj → IGI T1)',
    body: {
      journeyType: 'AIRPORT',
      travelType: 'DEPARTURE',
      airportCode: 'DEL',
      pickup: { name: 'Vasant Kunj, Delhi', city: 'Delhi', latitude: 28.5201, longitude: 77.1591 },
      drop: { name: 'IGI Airport-T1', city: 'Delhi', latitude: 28.5588, longitude: 77.0814 },
      distanceKm: 15,
      durationMin: 15,
      pickupDatetime,
    },
  },
  {
    id: 'AIRPORT-ARR-DEL',
    label: 'Airport ARRIVAL — Delhi (IGI T1 → Vasant Kunj)',
    body: {
      journeyType: 'AIRPORT',
      travelType: 'ARRIVAL',
      airportCode: 'DEL',
      pickup: { name: 'IGI Airport-T1', city: 'Delhi', latitude: 28.5588, longitude: 77.0814 },
      drop: { name: 'Vasant Kunj, Delhi', city: 'Delhi', latitude: 28.5201, longitude: 77.1591 },
      distanceKm: 15,
      durationMin: 15,
      pickupDatetime,
    },
  },
  {
    id: 'AIRPORT-DEP-BOM',
    label: 'Airport DEPARTURE — Mumbai (Andheri → BOM T2)',
    body: {
      journeyType: 'AIRPORT',
      travelType: 'DEPARTURE',
      airportCode: 'BOM',
      pickup: { name: 'Andheri East, Mumbai', city: 'Mumbai', latitude: 19.1136, longitude: 72.8697 },
      drop: { name: 'Mumbai Airport T2', city: 'Mumbai', latitude: 19.0896, longitude: 72.8656 },
      distanceKm: 8,
      durationMin: 25,
      pickupDatetime,
    },
  },
  {
    id: 'AIRPORT-DEP-BLR',
    label: 'Airport DEPARTURE — Bangalore (Indiranagar → BLR)',
    body: {
      journeyType: 'AIRPORT',
      travelType: 'DEPARTURE',
      airportCode: 'BLR',
      pickup: { name: 'Indiranagar, Bangalore', city: 'Bangalore', latitude: 12.9784, longitude: 77.6408 },
      drop: { name: 'Kempegowda International Airport', city: 'Bangalore', latitude: 13.1989, longitude: 77.7068 },
      distanceKm: 35,
      durationMin: 60,
      pickupDatetime,
    },
  },
  {
    id: 'OUTSTATION-PUNE',
    label: 'Outstation / point-to-point — Pune (Keshav Nagar → Viman Nagar)',
    body: {
      journeyType: 'OUTSTATION',
      travelType: 'DEPARTURE',
      pickup: { name: 'Keshav Nagar, Pune', city: 'Pune', latitude: 18.5518, longitude: 73.9467 },
      drop: { name: 'Viman Nagar, Pune', city: 'Pune', latitude: 18.5679, longitude: 73.9143 },
      distanceKm: 8,
      durationMin: 25,
      pickupDatetime,
    },
  },
  {
    id: 'OUTSTATION-DEL-AGR',
    label: 'Outstation — Delhi → Agra (city to city)',
    body: {
      journeyType: 'OUTSTATION',
      travelType: 'DEPARTURE',
      pickup: { name: 'Connaught Place, Delhi', city: 'Delhi', latitude: 28.6315, longitude: 77.2167 },
      drop: { name: 'Taj Mahal, Agra', city: 'Agra', latitude: 27.1751, longitude: 78.0421 },
      distanceKm: 230,
      durationMin: 240,
      pickupDatetime,
    },
  },
  {
    id: 'OUTSTATION-BOM-PUNE',
    label: 'Outstation — Mumbai → Pune',
    body: {
      journeyType: 'OUTSTATION',
      travelType: 'DEPARTURE',
      pickup: { name: 'Bandra West, Mumbai', city: 'Mumbai', latitude: 19.0596, longitude: 72.8295 },
      drop: { name: 'Shivaji Nagar, Pune', city: 'Pune', latitude: 18.5304, longitude: 73.8567 },
      distanceKm: 150,
      durationMin: 180,
      pickupDatetime,
    },
  },
  {
    id: 'RENTAL-PUNE',
    label: 'Rental / hourly — Pune (Keshav Nagar)',
    body: {
      journeyType: 'RENTAL',
      travelType: 'DEPARTURE',
      pickup: { name: 'Keshav Nagar, Pune', city: 'Pune', latitude: 18.5518, longitude: 73.9467 },
      drop: { name: 'Keshav Nagar, Pune', city: 'Pune', latitude: 18.5518, longitude: 73.9467 },
      distanceKm: 20,
      durationMin: 120,
      pickupDatetime,
    },
  },
  {
    id: 'RENTAL-DEL',
    label: 'Rental / hourly — Delhi (Connaught Place)',
    body: {
      journeyType: 'RENTAL',
      travelType: 'DEPARTURE',
      pickup: { name: 'Connaught Place, Delhi', city: 'Delhi', latitude: 28.6315, longitude: 77.2167 },
      drop: { name: 'Connaught Place, Delhi', city: 'Delhi', latitude: 28.6315, longitude: 77.2167 },
      distanceKm: 40,
      durationMin: 240,
      pickupDatetime,
    },
  },
  {
    id: 'RENTAL-BOM',
    label: 'Rental / hourly — Mumbai (Andheri)',
    body: {
      journeyType: 'RENTAL',
      travelType: 'DEPARTURE',
      pickup: { name: 'Andheri East, Mumbai', city: 'Mumbai', latitude: 19.1136, longitude: 72.8697 },
      drop: { name: 'Andheri East, Mumbai', city: 'Mumbai', latitude: 19.1136, longitude: 72.8697 },
      distanceKm: 40,
      durationMin: 240,
      pickupDatetime,
    },
  },
];

function summarizeCab(c) {
  return {
    fareId: c.fareId,
    operator: c.operator?.name || null,
    vehicleType: c.vehicle?.type || c.vehicleType || null,
    vehicleCategory: c.vehicle?.category || null,
    vehicleModel: c.vehicle?.model || null,
    searchIdPresent: Boolean(c.searchId),
    tags: c.tags || [],
    totalAmount: c.priceDetail?.totalAmount ?? c.totalAmount ?? null,
  };
}

async function main() {
  const { client } = await authenticate(true);
  const cab = new CabService(client);
  const scenarios = [];
  const unknownHits = [];

  for (const s of SCENARIOS) {
    const res = await cab.search(s.body);
    const cabs = res.data?.cabs || [];
    const unknown = cabs.filter((c) => String(c.fareId) === 'Unknown');
    const known = cabs.filter((c) => c.fareId && String(c.fareId) !== 'Unknown');
    const nullish = cabs.filter((c) => c.fareId == null || c.fareId === '');

    const row = {
      id: s.id,
      label: s.label,
      journeyType: s.body.journeyType,
      travelType: s.body.travelType,
      airportCode: s.body.airportCode || null,
      http: res.status,
      totalCabs: cabs.length,
      unknownCount: unknown.length,
      knownCount: known.length,
      nullishCount: nullish.length,
      operatorsUnknown: [...new Set(unknown.map((c) => c.operator?.name || '?'))],
      operatorsKnown: [...new Set(known.map((c) => c.operator?.name || '?'))],
      unknownCabs: unknown.map(summarizeCab),
      allCabs: cabs.map(summarizeCab),
    };
    scenarios.push(row);

    for (const u of unknown) {
      unknownHits.push({
        scenario: s.id,
        label: s.label,
        journeyType: s.body.journeyType,
        travelType: s.body.travelType,
        location: s.label,
        operator: u.operator?.name,
        vehicleType: u.vehicle?.type,
        vehicleCategory: u.vehicle?.category,
        vehicleModel: u.vehicle?.model,
        fareId: u.fareId,
        totalAmount: u.priceDetail?.totalAmount ?? u.totalAmount,
      });
    }

    console.log(
      `[${unknown.length ? 'UNKNOWN' : 'OK'}] ${s.id} http=${res.status} cabs=${cabs.length} unknown=${unknown.length} known=${known.length} opsUnknown=${row.operatorsUnknown.join('|') || '-'}`,
    );
  }

  const byOperator = {};
  for (const h of unknownHits) {
    const k = h.operator || '?';
    byOperator[k] = (byOperator[k] || 0) + 1;
  }
  const byJourney = {};
  for (const h of unknownHits) {
    const k = h.journeyType;
    byJourney[k] = (byJourney[k] || 0) + 1;
  }

  const report = {
    when: new Date().toISOString(),
    pickupDatetime,
    summary: {
      scenarios: scenarios.length,
      scenariosWithUnknown: scenarios.filter((s) => s.unknownCount > 0).length,
      totalUnknownHits: unknownHits.length,
      byOperator,
      byJourney,
    },
    unknownHits,
    scenarios: scenarios.map((s) => ({
      id: s.id,
      label: s.label,
      journeyType: s.journeyType,
      travelType: s.travelType,
      airportCode: s.airportCode,
      http: s.http,
      totalCabs: s.totalCabs,
      unknownCount: s.unknownCount,
      knownCount: s.knownCount,
      operatorsUnknown: s.operatorsUnknown,
      operatorsKnown: s.operatorsKnown,
      unknownCabs: s.unknownCabs,
    })),
  };

  fs.writeFileSync('reports/cab-fareid-unknown-scan.json', JSON.stringify(report, null, 2));
  console.log('\nSUMMARY', JSON.stringify(report.summary, null, 2));
  console.log('Wrote reports/cab-fareid-unknown-scan.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
