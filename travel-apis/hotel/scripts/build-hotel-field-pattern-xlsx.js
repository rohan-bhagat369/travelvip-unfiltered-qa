import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const files = [
  'reports/hotel-desc-incl-excl-prod-india-a.json',
  'reports/hotel-desc-incl-excl-prod-india-b.json',
  'reports/hotel-desc-incl-excl-prod-intl.json',
];

const PROPERTIES = [
  { sheet: 'description', field: 'hotel.description' },
  { sheet: 'inclusion', field: 'room.inclusion' },
  { sheet: 'exclusion', field: 'room.exclusion' },
  { sheet: 'checkInTime', field: 'hotel.checkInTime' },
  { sheet: 'checkOutTime', field: 'hotel.checkOutTime' },
  { sheet: 'distance', field: 'hotel.distance' },
  { sheet: 'hotelReview', field: 'hotel.hotelReview' },
  { sheet: 'bookingCondition', field: 'room.bookingCondition' },
  { sheet: 'hotel_priceReference', field: 'hotel.price.priceReference' },
  { sheet: 'room_priceReference', field: 'room.price.priceReference' },
  { sheet: 'hotel_refundableNotes', field: 'hotel.refundableNotes' },
  { sheet: 'room_refundableNotes', field: 'room.refundableNotes' },
  { sheet: 'cancelPolicies', field: 'room.cancelPolicies' },
  { sheet: 'amenitiesIcon', field: 'room.amenitiesIcon' },
  { sheet: 'benefitsIcon', field: 'room.benefitsIcon' },
  { sheet: 'amenities', field: 'hotel.amenities' },
  { sheet: 'tags', field: 'hotel.tags' },
];

function cell(map, field) {
  if (!map || Object.keys(map).length === 0) return 'missing';
  const info = map[field];
  if (!info) return 'missing';
  if (info.present) return 'present';
  if (info.state === 'empty') return 'null';
  return info.state || 'null';
}

function addSheet(wb, name, aoa) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const lastR = Math.max(aoa.length - 1, 0);
  const lastC = Math.max((aoa[0] || []).length - 1, 0);
  ws['!autofilter'] = {
    ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastR, c: lastC } }),
  };
  ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activeCell: 'A2' };
  ws['!cols'] = (aoa[0] || []).map((h, i) => {
    let w = String(h || '').length;
    for (const row of aoa) w = Math.max(w, String(row[i] ?? '').length);
    return { wch: Math.min(Math.max(w + 2, 14), 48) };
  });
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
}

const hotels = [];
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const r of j.rows || []) hotels.push(r);
}

const wb = XLSX.utils.book_new();

addSheet(wb, 'Legend', [
  ['Prod hotel field pattern — one sheet per property'],
  ['Base', 'https://api.travelvip.ai'],
  ['Stay', '2026-10-15 → 2026-10-16'],
  ['Flow', 'CITY search → HOTEL details → prebook. No book.'],
  ['Hotels', hotels.length],
  [],
  ['Value', 'Meaning'],
  ['present', 'Field exists in that API response and has a non-empty value'],
  ['null', 'Field exists in that API response but is null / empty'],
  ['missing', 'Field (or whole hotel/room block) is not in that API response'],
  [],
  ['Sheet', 'API field'],
  ...PROPERTIES.map((p) => [p.sheet, p.field]),
]);

for (const p of PROPERTIES) {
  const aoa = [
    ['City', 'Hotel', 'entityId', `details.${p.field}`, `prebook.${p.field}`],
  ];
  for (const r of hotels) {
    aoa.push([
      r.city,
      r.hotelName,
      r.hotelId,
      cell(r.detailsMap, p.field),
      cell(r.prebookMap, p.field),
    ]);
  }
  addSheet(wb, p.sheet, aoa);
}

const out = path.join('reports', 'hotel-field-pattern-prod.xlsx');
XLSX.writeFile(wb, out);
console.log('Wrote', out);
console.log('sheets', wb.SheetNames.join(' | '));
