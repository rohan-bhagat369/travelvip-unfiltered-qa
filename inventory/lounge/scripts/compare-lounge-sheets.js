/**
 * Compare New added Lounges sheet vs Final_new_lounges import + availability results.
 */
import fs from 'fs';
import XLSX from 'xlsx';

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function loungeKey(name) {
  return norm(name)
    .replace(
      /\b(terminal|main terminal|domestic|international|departure|arrival|pre security|post security)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function pairKey(iata, name) {
  return `${norm(iata)}|${loungeKey(name)}`;
}

function looseHit(set, k) {
  const [iata, name] = k.split('|');
  for (const bk of set) {
    const [bi, bn] = bk.split('|');
    if (bi !== iata) continue;
    if (name === bn || name.includes(bn) || bn.includes(name)) return true;
  }
  return false;
}

const aPath =
  'C:/Users/Rohan Bhagat/Downloads/New added Lounges and Fast Track -20260920 (1).xlsx';
const bPath =
  'C:/Users/Rohan Bhagat/Downloads/Final_new_lounges_2nd_Import_updated (1).xlsx';
const resPath = 'reports/final-new-lounges-2nd-import.csv';

const aWb = XLSX.readFile(aPath);
const aRows = XLSX.utils.sheet_to_json(aWb.Sheets['Lounge added'], { defval: '' });
const ft = XLSX.utils.sheet_to_json(aWb.Sheets['Fast Track added'], { defval: '' });

const bWb = XLSX.readFile(bPath);
const bRows = XLSX.utils.sheet_to_json(bWb.Sheets[bWb.SheetNames[0]], { defval: '' });

const resWb = XLSX.readFile(resPath);
const resRows = XLSX.utils
  .sheet_to_json(resWb.Sheets[resWb.SheetNames[0]], { defval: '' })
  .filter((r) => r.IATA || r['Lounge Name'] || r['Airport Name']);

const aPairs = new Set(aRows.map((r) => pairKey(r['IATA CODE'], r.Name)));
const bPairs = new Set(
  bRows.map((r) => pairKey(r.IATA, r['Normalized Lounge Name'] || r['Lounge Name'])),
);

const bGroup = new Map();
for (const r of resRows) {
  const k = pairKey(r.IATA, r['Normalized Lounge Name'] || r['Lounge Name']);
  if (!bGroup.has(k)) bGroup.set(k, []);
  bGroup.get(k).push(r);
}

let uniqYes = 0;
let uniqNf = 0;
let uniqMixed = 0;
const uniqStatus = [];
for (const [, rows] of bGroup) {
  const statuses = rows.map((r) => String(r.working_qa_status || '').trim());
  const yes = statuses.filter((s) => s === 'yes').length;
  const nf = statuses.filter((s) => s === 'not found').length;
  let st;
  if (yes && !nf) st = 'yes';
  else if (nf && !yes) st = 'not found';
  else if (yes && nf) st = 'mixed (some routes yes, some not found)';
  else st = 'blank';
  if (st === 'yes') uniqYes++;
  else if (st === 'not found') uniqNf++;
  else if (st.startsWith('mixed')) uniqMixed++;
  const sample = rows[0];
  uniqStatus.push({
    iata: sample.IATA,
    lounge: sample['Normalized Lounge Name'] || sample['Lounge Name'],
    airport: sample['Airport Name'],
    routeCount: rows.length,
    routes: rows.map((r) => `${r['Route Type']} => ${r.working_qa_status}`).join(' | '),
    overall: st,
  });
}

const onlyAStrict = [...aPairs].filter((k) => !bPairs.has(k) && !looseHit(bPairs, k));
const onlyBStrict = [...bPairs].filter((k) => !aPairs.has(k) && !looseHit(aPairs, k));

const summary = [
  { Item: 'New added Lounges sheet (Lounge added) rows', Value: aRows.length },
  { Item: 'New added unique IATA+Lounge', Value: aPairs.size },
  { Item: 'Final_new_lounges import rows', Value: bRows.length },
  { Item: 'Final unique IATA+Lounge', Value: bPairs.size },
  {
    Item: 'Extra Final rows from Route Type split (same lounge Dom+Intl etc.)',
    Value: bRows.length - bPairs.size,
  },
  { Item: 'Lounges in New added missing from Final', Value: onlyAStrict.length },
  { Item: 'Lounges in Final missing from New added', Value: onlyBStrict.length },
  { Item: 'Unique lounges Available on prod (yes)', Value: uniqYes },
  { Item: 'Unique lounges Missing on prod (not found)', Value: uniqNf },
  { Item: 'Unique lounges Mixed (some routes yes / some not)', Value: uniqMixed },
  {
    Item: 'Fast Track rows in New added file (not part of lounge API availability run)',
    Value: ft.length,
  },
];

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Summary');
XLSX.utils.book_append_sheet(
  wb,
  XLSX.utils.json_to_sheet(
    uniqStatus
      .filter((u) => u.overall !== 'yes')
      .map((u, i) => ({
        '#': i + 1,
        IATA: u.iata,
        Airport: u.airport,
        Lounge: u.lounge,
        'Route rows': u.routeCount,
        'Per-route availability': u.routes,
        Overall: u.overall,
      })),
  ),
  'Not fully available',
);
XLSX.utils.book_append_sheet(
  wb,
  XLSX.utils.json_to_sheet(
    uniqStatus
      .filter((u) => u.overall === 'yes')
      .map((u, i) => ({
        '#': i + 1,
        IATA: u.iata,
        Airport: u.airport,
        Lounge: u.lounge,
        'Route rows': u.routeCount,
      })),
  ),
  'Available on prod',
);
XLSX.utils.book_append_sheet(
  wb,
  XLSX.utils.json_to_sheet(
    ft.map((r, i) => ({
      '#': i + 1,
      Code: r.Code,
      IATA: r['IATA CODE'],
      Name: r.Name,
      Terminal: r.Terminal,
      Route: r.Route || r['Departure Type'],
      Note: 'Fast Track — not compared in lounge carousel availability run',
    })),
  ),
  'Fast Track (not lounge QA)',
);

fs.mkdirSync('reports', { recursive: true });
XLSX.writeFile(wb, 'reports/lounge-sheet-compare.xlsx');
XLSX.writeFile(wb, 'C:/Users/Rohan Bhagat/Downloads/lounge-sheet-compare.xlsx');

const out = {
  summary,
  onlyInNewAdded: onlyAStrict.length,
  onlyInFinal: onlyBStrict.length,
  notFullyAvailable: uniqStatus.filter((u) => u.overall !== 'yes'),
};
fs.writeFileSync('reports/lounge-sheet-compare.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
console.log('Wrote Downloads/lounge-sheet-compare.xlsx');
