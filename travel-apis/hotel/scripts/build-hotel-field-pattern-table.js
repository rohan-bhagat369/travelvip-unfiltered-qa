import fs from 'fs';

const files = [
  'reports/hotel-desc-incl-excl-prod-india-a.json',
  'reports/hotel-desc-incl-excl-prod-india-b.json',
  'reports/hotel-desc-incl-excl-prod-intl.json',
];

const FIELDS = [
  'hotel.description',
  'room.inclusion',
  'room.exclusion',
  'hotel.checkInTime',
  'hotel.checkOutTime',
  'hotel.distance',
  'hotel.hotelReview',
  'room.bookingCondition',
  'hotel.price.priceReference',
  'room.price.priceReference',
  'hotel.refundableNotes',
  'room.refundableNotes',
  'room.cancelPolicies',
  'room.amenitiesIcon',
  'room.benefitsIcon',
  'hotel.amenities',
  'hotel.tags',
];

function cell(map, field) {
  if (!map || Object.keys(map).length === 0) return 'missing';
  const info = map[field];
  if (!info) return 'missing';
  if (info.present) return 'present';
  if (info.state === 'empty') return 'null';
  return info.state || 'null';
}

function csvEscape(s) {
  const t = String(s ?? '');
  if (/[",\n]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

const rows = [];
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const r of j.rows || []) rows.push(r);
}

const headers = ['City', 'Hotel', 'entityId'];
for (const field of FIELDS) {
  headers.push(`details.${field}`);
  headers.push(`prebook.${field}`);
}

const csv = [headers.map(csvEscape).join(',')].concat(
  rows.map((r) => {
    const vals = [r.city, r.hotelName, r.hotelId];
    for (const field of FIELDS) {
      vals.push(cell(r.detailsMap, field));
      vals.push(cell(r.prebookMap, field));
    }
    return vals.map(csvEscape).join(',');
  }),
).join('\n');

fs.writeFileSync('reports/hotel-field-pattern-prod.csv', csv);

const md = [];
md.push('# Prod hotel field pattern (details vs prebook)');
md.push('');
md.push('- Base: `https://api.travelvip.ai`');
md.push('- Stay: **2026-10-15 → 2026-10-16**. Search → details → prebook. **No book.**');
md.push('- Values: **present** / **null** / **missing**');
md.push('');
md.push(`| ${headers.join(' | ')} |`);
md.push(`|${headers.map(() => '---').join('|')}|`);
for (const r of rows) {
  const vals = [r.city, String(r.hotelName).replace(/\|/g, '/'), `\`${r.hotelId}\``];
  for (const field of FIELDS) {
    vals.push(cell(r.detailsMap, field));
    vals.push(cell(r.prebookMap, field));
  }
  md.push(`| ${vals.join(' | ')} |`);
}
fs.writeFileSync('reports/hotel-field-pattern-prod.md', md.join('\n'));

function writeGroup(slug, title, fieldList) {
  const hs = ['City', 'Hotel', 'entityId'];
  for (const field of fieldList) {
    hs.push(`details.${field}`);
    hs.push(`prebook.${field}`);
  }
  const out = [];
  out.push(`# ${title}`);
  out.push('');
  out.push('| ' + hs.join(' | ') + ' |');
  out.push('|' + hs.map(() => '---').join('|') + '|');
  for (const r of rows) {
    const vals = [r.city, String(r.hotelName).replace(/\|/g, '/'), '`' + r.hotelId + '`'];
    for (const field of fieldList) {
      vals.push(cell(r.detailsMap, field));
      vals.push(cell(r.prebookMap, field));
    }
    out.push('| ' + vals.join(' | ') + ' |');
  }
  fs.writeFileSync(`reports/hotel-field-pattern-prod-${slug}.md`, out.join('\n'));
}

writeGroup('core', 'Description / inclusion / exclusion / check-in / check-out', [
  'hotel.description',
  'room.inclusion',
  'room.exclusion',
  'hotel.checkInTime',
  'hotel.checkOutTime',
]);
writeGroup('nullish', 'Always-null / priceReference / notes', [
  'hotel.distance',
  'hotel.hotelReview',
  'room.bookingCondition',
  'hotel.price.priceReference',
  'room.price.priceReference',
  'hotel.refundableNotes',
  'room.refundableNotes',
]);
writeGroup('extras', 'cancelPolicies / icons / amenities / tags', [
  'room.cancelPolicies',
  'room.amenitiesIcon',
  'room.benefitsIcon',
  'hotel.amenities',
  'hotel.tags',
]);

console.log('hotels', rows.length, 'cols', headers.length);
