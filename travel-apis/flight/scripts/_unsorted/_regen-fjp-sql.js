import fs from 'fs';
import { authenticate, clearSession } from '../../../../shared/lib/authService.js';
import { FlightService } from '../../src/service.js';

const fixtures = [
  { scenario: 'OW_2ADT_DIRECT', br: 'BR1786561427255395', expectedCells: 2 },
  { scenario: 'OW_2ADT_CONNECTING', br: 'BR1786561629552992', expectedCells: 2 },
  { scenario: 'RT_2ADT_DIRECT', br: 'BR1786561521735923', expectedCells: 4 },
  { scenario: 'RT_2ADT_CONNECTING', br: 'BR1786561552340517', expectedCells: 4 },
];

clearSession();
const s = await authenticate(true);
s.client.setPartnerKey(s.accessToken);
const f = new FlightService(s.client);
for (const x of fixtures) {
  const st = await f.getBookingStatus(x.br);
  x.status = st.data?.status;
  console.log(x.scenario, x.br, x.status);
}

const parts = ['USE travelx;', '', '-- TC0 SCHEMA GATE', 'SHOW COLUMNS FROM flight_journey_passenger;',
  "SELECT COUNT(*) AS flight_segment_id_cols FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='travelx' AND TABLE_NAME='flight_journey_passenger' AND COLUMN_NAME='flight_segment_id';",
  '-- expect 0', ''];

for (const fx of fixtures) {
  parts.push(`-- ========== ${fx.scenario}  BR=${fx.br}  expect cells=${fx.expectedCells} ==========`);
  parts.push(`SET @br := '${fx.br}';`);
  parts.push(`SELECT
  (SELECT COUNT(*) FROM flight_journey fj JOIN booking_item bi ON bi.id=fj.booking_item_id JOIN booking b ON b.id=bi.booking_id WHERE b.booking_reference=@br) AS journeys,
  (SELECT COUNT(*) FROM booking_passenger bp JOIN booking b ON b.id=bp.booking_id WHERE b.booking_reference=@br) AS passengers,
  (SELECT COUNT(*) FROM flight_journey_passenger fjp JOIN flight_journey fj ON fj.id=fjp.flight_journey_id JOIN booking_item bi ON bi.id=fj.booking_item_id JOIN booking b ON b.id=bi.booking_id WHERE b.booking_reference=@br) AS cells,
  ${fx.expectedCells} AS expected_cells;`);
  parts.push(`SELECT bp.pax_id, bp.first_name, bp.last_name,
       fj.id AS journey_id, fj.direction, fj.sequence, fj.airline_pnr,
       fjp.id AS cell_id, fjp.eticket_number, fjp.pnr_override
FROM flight_journey_passenger fjp
JOIN flight_journey fj ON fj.id = fjp.flight_journey_id
JOIN booking_passenger bp ON bp.id = fjp.booking_passenger_id
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY fj.sequence, bp.pax_id;`);
  parts.push('');
}

parts.push('-- ALL FIXTURES');
parts.push(`SELECT b.booking_reference, COUNT(DISTINCT fj.id) AS journeys, COUNT(DISTINCT bp.id) AS pax, COUNT(fjp.id) AS cells
FROM booking b
JOIN booking_item bi ON bi.booking_id=b.id
JOIN flight_journey fj ON fj.booking_item_id=bi.id
JOIN booking_passenger bp ON bp.booking_id=b.id
LEFT JOIN flight_journey_passenger fjp ON fjp.flight_journey_id=fj.id AND fjp.booking_passenger_id=bp.id
WHERE b.booking_reference IN (${fixtures.map((x) => `'${x.br}'`).join(',')})
GROUP BY b.booking_reference;`);

fs.writeFileSync('reports/fjp-cell-model-postdeploy.sql', parts.join('\n'));
fs.writeFileSync('reports/fjp-cell-model-postdeploy.json', JSON.stringify({
  ranAt: new Date().toISOString(),
  baseUrl: 'https://canary-api.travelvip.ai',
  fixtures,
  sqlFile: 'reports/fjp-cell-model-postdeploy.sql',
}, null, 2));
console.log('Wrote SQL + JSON');
