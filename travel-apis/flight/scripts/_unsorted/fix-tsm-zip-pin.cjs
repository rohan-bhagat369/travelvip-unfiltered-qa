const fs = require('fs');
const sstPath = 'd:/Travel VIP API Automation/reports/byufuel-drive/tsm-zip-unzip/xl/sharedStrings.xml';
const sheetPath = 'd:/Travel VIP API Automation/reports/byufuel-drive/tsm-zip-unzip/xl/worksheets/sheet1.xml';

let sst = fs.readFileSync(sstPath, 'utf8');
if (!sst.includes('<si><t></t></si>')) {
  console.log('no empty pin string');
  process.exit(1);
}
sst = sst.replace('<si><t></t></si>', '<si><t>500001</t></si>');
sst = sst.replace('<si><t>500018</t></si>', '');
sst = sst.replace('count="93" uniqueCount="93"', 'count="92" uniqueCount="92"');
fs.writeFileSync(sstPath, sst);

let sheet = fs.readFileSync(sheetPath, 'utf8');
sheet = sheet.replace(
  '<row r="49"><c r="A49" s="2"><v>2347</v></c><c r="B49" s="2" t="s"><v>89</v></c><c r="C49" s="2" t="s"><v>90</v></c><c r="D49" s="2" t="s"><v>91</v></c><c r="E49" s="2" t="s"><v>92</v></c></row>',
  ''
);
sheet = sheet.replace('ref="A1:E49"', 'ref="A1:E48"');
fs.writeFileSync(sheetPath, sheet);
console.log('blank pin set to 500001', sst.includes('500001'), 'row49 gone', !sheet.includes('r="49"'));
