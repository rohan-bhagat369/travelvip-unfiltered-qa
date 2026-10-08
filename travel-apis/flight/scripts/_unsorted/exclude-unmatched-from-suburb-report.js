import fs from 'fs';
import XLSX from 'xlsx';

const ROOT = 'd:/Travel VIP API Automation';
const UNMATCHED = 'c:/Users/Rohan Bhagat/Downloads/india-260723_areas.unmatched-areas.csv';
const SRC = `${ROOT}/reports/hotel/zenith-suburb-autocomplete-availability.xlsx`;
const OUT = `${ROOT}/reports/hotel/zenith-suburb-autocomplete-availability-FILTERED.xlsx`;
const OUT_REMOVED = `${ROOT}/reports/hotel/zenith-suburb-unmatched-excluded.xlsx`;

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (q) {
      if (c === '"' && n === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cur);
      cur = '';
    } else if (c === '\n') {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else if (c !== '\r') cur += c;
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

function nk(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function rowKey(r) {
  return [
    nk(r.name),
    nk(r.parent_city),
    String(r.latitude || '').trim(),
    String(r.longitude || '').trim(),
  ].join('||');
}

function nameCityKey(r) {
  return `${nk(r.name)}||${nk(r.parent_city)}`;
}

const unmatchedTable = parseCsv(fs.readFileSync(UNMATCHED, 'utf8'));
const uh = unmatchedTable[0].map((x) => String(x || '').trim());
const uidx = Object.fromEntries(uh.map((k, i) => [k, i]));
const excludeExact = new Set();
const excludeNameCity = new Set();
const unmatchedRows = [];

for (const r of unmatchedTable.slice(1)) {
  if (!(r[uidx.name] || '').trim()) continue;
  const obj = {
    name: r[uidx.name],
    parent_city: r[uidx.parent_city],
    latitude: r[uidx.latitude],
    longitude: r[uidx.longitude],
    place_type: r[uidx.place_type],
    reason: r[uidx.reason],
  };
  unmatchedRows.push(obj);
  excludeExact.add(rowKey(obj));
  excludeNameCity.add(nameCityKey(obj));
}

const wbIn = XLSX.readFile(SRC);
const suburb = XLSX.utils.sheet_to_json(
  wbIn.Sheets['Suburb Results'] || wbIn.Sheets[wbIn.SheetNames[0]],
);

const kept = [];
const removed = [];

for (const r of suburb) {
  const exact = excludeExact.has(rowKey(r));
  const soft = excludeNameCity.has(nameCityKey(r));
  if (exact || soft) removed.push(r);
  else kept.push(r);
}

const yes = kept.filter((r) => r['API Availability'] === 'Yes').length;
const no = kept.filter((r) => r['API Availability'] === 'No').length;
const uniqueKept = new Set(kept.map((r) => nk(r.name))).size;
const uniqueYes = new Set(
  kept.filter((r) => r['API Availability'] === 'Yes').map((r) => nk(r.name)),
).size;
const uniqueNo = new Set(
  kept.filter((r) => r['API Availability'] === 'No').map((r) => nk(r.name)),
).size;

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(kept), 'Suburb Results');
XLSX.utils.book_append_sheet(
  wb,
  XLSX.utils.json_to_sheet([
    { Metric: 'Unmatched exclude list rows', Value: unmatchedRows.length },
    { Metric: 'Suburb rows before exclude', Value: suburb.length },
    { Metric: 'Suburb rows removed', Value: removed.length },
    { Metric: 'Suburb rows after exclude', Value: kept.length },
    { Metric: 'API Availability Yes (rows)', Value: yes },
    { Metric: 'API Availability No (rows)', Value: no },
    { Metric: 'Unique names kept', Value: uniqueKept },
    { Metric: 'Unique Yes', Value: uniqueYes },
    { Metric: 'Unique No', Value: uniqueNo },
    { Metric: 'Generated At', Value: new Date().toISOString() },
    {
      Metric: 'Exclude source',
      Value: 'india-260723_areas.unmatched-areas.csv',
    },
  ]),
  'Summary',
);
XLSX.writeFile(wb, OUT);

const wb2 = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb2, XLSX.utils.json_to_sheet(removed), 'Excluded from Suburb');
XLSX.utils.book_append_sheet(wb2, XLSX.utils.json_to_sheet(unmatchedRows), 'Unmatched Source List');
XLSX.writeFile(wb2, OUT_REMOVED);

console.log(
  JSON.stringify(
    {
      unmatchedList: unmatchedRows.length,
      before: suburb.length,
      removed: removed.length,
      after: kept.length,
      yes,
      no,
      uniqueKept,
      uniqueYes,
      uniqueNo,
      out: OUT,
      excludedCopy: OUT_REMOVED,
    },
    null,
    2,
  ),
);
