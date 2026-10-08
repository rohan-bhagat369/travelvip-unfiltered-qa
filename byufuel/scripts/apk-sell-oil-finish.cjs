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

// ensure weight field visible - scroll UCO into mid
adb('shell', 'input', 'swipe', '540', '900', '540', '1500', '250');
sleep(800);
let xml = dump('apk-sell-uco');
let ns = nodes(xml);
console.log(
  'interesting',
  ns.filter((n) => /EditText|Kg|Grade|UCO|Book|10|weight/i.test(n.cls + n.d + n.t)).slice(0, 40)
);

// Tap likely kg input: near "Kg" text inside fill section - from earlier UCO button y
const kgHint = ns.find((n) => /Kg/i.test(n.d) || /Kg/i.test(n.t));
const edit = ns.find((n) => n.cls === 'EditText');
if (edit) {
  console.log('tap edit', edit);
  adb('shell', 'input', 'tap', String(edit.x), String(edit.y));
} else if (kgHint) {
  console.log('tap kgHint', kgHint);
  adb('shell', 'input', 'tap', String(kgHint.x), String(kgHint.y + 80));
} else {
  // heuristic: UCO button area above, kg field often left of grade
  console.log('heuristic tap 300,780');
  adb('shell', 'input', 'tap', '300', '780');
}
sleep(500);
adb('shell', 'input', 'text', '10');
sleep(800);

xml = dump('apk-sell-weighed');
ns = nodes(xml);
console.log(
  'after weight',
  ns.filter((n) => /0\.00|10|Book|Total|Grade|Kg/i.test(n.d + n.t)).slice(0, 20)
);
console.log(nt('screenshot', 'apk-sell-weighed.png'));

// Grade A
const grade = ns.find((n) => /Grade A/i.test(n.d) && n.click === 'true');
if (grade) {
  adb('shell', 'input', 'tap', String(grade.x), String(grade.y));
  sleep(500);
}

// scroll to book
adb('shell', 'input', 'swipe', '540', '2000', '540', '700', '300');
sleep(1000);
xml = dump('apk-sell-book');
ns = nodes(xml);
const book = ns.find((n) => /Book your slot/i.test(n.d));
console.log('book', book);
if (book) {
  adb('shell', 'input', 'tap', String(book.x), String(book.y));
  sleep(8000);
}
console.log(nt('screenshot', 'apk-sell-submitted.png'));
console.log(nt('dump', 'apk-sell-submitted'));
