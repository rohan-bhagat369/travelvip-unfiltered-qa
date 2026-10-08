import fs from 'fs';
import XLSX from 'xlsx';

const wb = XLSX.readFile(
  'd:/Travel VIP API Automation/reports/hotel/zenith-region-autocomplete-availability.xlsx',
);
const rows = XLSX.utils.sheet_to_json(wb.Sheets['Region Autocomplete']);
const total = rows.length;
const withApi = rows.filter((r) => r['API Availability'] === 'Yes' || r['API Availability'] === 'No');
const blankApi = total - withApi.length;
const suburb = rows.filter((r) => String(r.place_type || '').toLowerCase() === 'suburb');
const suburbFilled = suburb.filter((r) => r['API Availability'] === 'Yes' || r['API Availability'] === 'No');
const suburbBlank = suburb.length - suburbFilled.length;

console.log(
  JSON.stringify(
    {
      excelTotalRows: total,
      excelRowsWithApiAvailability: withApi.length,
      excelRowsBlankApiAvailability: blankApi,
      excelSuburbRows: suburb.length,
      excelSuburbFilled: suburbFilled.length,
      excelSuburbBlank: suburbBlank,
      suburbYes: suburbFilled.filter((r) => r['API Availability'] === 'Yes').length,
      suburbNo: suburbFilled.filter((r) => r['API Availability'] === 'No').length,
    },
    null,
    2,
  ),
);
