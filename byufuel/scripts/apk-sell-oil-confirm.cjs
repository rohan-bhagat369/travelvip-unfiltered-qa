const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ADB =
  'C:\\Users\\Rohan Bhagat\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe\\platform-tools\\adb.exe';
const OUT = 'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25';
const tap = path.join(__dirname, 'apk-tap.cjs');

function adb(...a) {
  return execFileSync(ADB, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function nt(...a) {
  return execFileSync(process.execPath, [tap, ...a], { encoding: 'utf8' });
}
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function dump(name) {
  adb('shell', 'uiautomator', 'dump', '/sdcard/uidump.xml');
  const local = path.join(OUT, name + '.xml');
  adb('pull', '/sdcard/uidump.xml', local);
  return fs.readFileSync(local, 'utf8');
}
function nodes(xml) {
  const out = [];
  const re = /<node [^>]*>/g;
  let m;
  while ((m = re.exec(xml))) {
    const a = m[0];
    const g = (n) => {
      const x = a.match(new RegExp(n + '="([^"]*)"'));
      return x ? x[1] : '';
    };
    const b = g('bounds').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (!b) continue;
    out.push({
      cls: g('class').split('.').pop(),
      t: g('text'),
      d: g('content-desc'),
      click: g('clickable'),
      x: ((+b[1] + +b[3]) / 2) | 0,
      y: ((+b[2] + +b[4]) / 2) | 0,
      bounds: g('bounds'),
    });
  }
  return out;
}

let xml = dump('apk-sell-confirm');
let ns = nodes(xml);
const confirm = ns.find((n) => n.d === 'Confirm' && n.click === 'true');
console.log('confirm', confirm);
if (confirm) {
  adb('shell', 'input', 'tap', String(confirm.x), String(confirm.y));
  sleep(12000);
}
console.log(nt('screenshot', 'apk-sell-confirmed.png'));
xml = dump('apk-sell-result');
ns = nodes(xml);
const texts = ns.filter((n) => n.d || n.t).map((n) => (n.d || n.t).replace(/&#10;/g, ' | '));
console.log('RESULT TEXTS:');
texts.forEach((t) => console.log(' -', t));
const sch = texts.find((t) => /SCH[- ]?\d|Schedule|Booked|success|reference|B-\d/i.test(t));
console.log('SCH_HINT', sch || '(none)');
fs.writeFileSync(
  path.join(OUT, 'apk-sell-oil-result.json'),
  JSON.stringify({ at: new Date().toISOString(), texts, sch: sch || null }, null, 2)
);
