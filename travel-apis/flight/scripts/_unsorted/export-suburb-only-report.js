import fs from 'fs';
import XLSX from 'xlsx';

const ROOT = 'd:/Travel VIP API Automation';
const SRC = `${ROOT}/reports/hotel/zenith-region-autocomplete-availability.xlsx`;
const OUT = `${ROOT}/reports/hotel/zenith-suburb-autocomplete-availability.xlsx`;

const wbIn = XLSX.readFile(SRC);
const all = XLSX.utils.sheet_to_json(wbIn.Sheets['Region Autocomplete'] || wbIn.Sheets[wbIn.SheetNames[0]]);
const suburb = all.filter((r) => String(r.place_type || '').toLowerCase() === 'suburb');

const yes = suburb.filter((r) => r['API Availability'] === 'Yes').length;
const no = suburb.filter((r) => r['API Availability'] === 'No').length;
const blank = suburb.length - yes - no;

const uniqueNames = new Set(suburb.map((r) => String(r.name || '').trim().toLowerCase()).filter(Boolean));
const uniqueYes = new Set(
  suburb
    .filter((r) => r['API Availability'] === 'Yes')
    .map((r) => String(r.name || '').trim().toLowerCase()),
);
const uniqueNo = new Set(
  suburb
    .filter((r) => r['API Availability'] === 'No')
    .map((r) => String(r.name || '').trim().toLowerCase()),
);

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(suburb), 'Suburb Results');
XLSX.utils.book_append_sheet(
  wb,
  XLSX.utils.json_to_sheet([
    { Metric: 'Suburb rows', Value: suburb.length },
    { Metric: 'API Availability Yes (rows)', Value: yes },
    { Metric: 'API Availability No (rows)', Value: no },
    { Metric: 'Blank API Availability (rows)', Value: blank },
    { Metric: 'Unique suburb names', Value: uniqueNames.size },
    { Metric: 'Unique Yes', Value: uniqueYes.size },
    { Metric: 'Unique No', Value: uniqueNo.size },
    { Metric: 'Generated At', Value: new Date().toISOString() },
    { Metric: 'Source', Value: SRC },
  ]),
  'Summary',
);
XLSX.writeFile(wb, OUT);

console.log(
  JSON.stringify(
    {
      out: OUT,
      suburbRows: suburb.length,
      yes,
      no,
      blank,
      uniqueNames: uniqueNames.size,
      uniqueYes: uniqueYes.size,
      uniqueNo: uniqueNo.size,
    },
    null,
    2,
  ),
);
