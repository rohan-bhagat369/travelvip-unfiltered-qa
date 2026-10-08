const fs = require('fs');
const { execSync } = require('child_process');
const adb =
  process.env.ADB ||
  'C:\\Users\\Rohan Bhagat\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe\\platform-tools\\adb.exe';
const serial = process.argv[2];
const needle = process.argv[3];
const xmlPath = process.argv[4];
const xml = fs.readFileSync(xmlPath, 'utf8');
const re = /<node [^>]*>/g;
let m;
const hits = [];
while ((m = re.exec(xml))) {
  const a = (n) => {
    const mm = m[0].match(new RegExp(n + '="([^"]*)"'));
    return mm ? mm[1] : '';
  };
  const d = (a('content-desc') || a('text') || '').replace(/&#10;/g, ' ');
  const b = a('bounds');
  if (new RegExp(needle, 'i').test(d) && b) {
    const mm = b.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (mm) {
      hits.push({
        d,
        x: Math.floor((+mm[1] + +mm[3]) / 2),
        y: Math.floor((+mm[2] + +mm[4]) / 2),
      });
    }
  }
}
if (!hits.length) {
  console.error('NO_MATCH', needle);
  process.exit(2);
}
const h = hits[0];
console.log(JSON.stringify(h));
execSync(`"${adb}" -s ${serial} shell input tap ${h.x} ${h.y}`, { stdio: 'inherit' });
