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

// Hide keyboard if open
adb('shell', 'input', 'keyevent', '4');
sleep(600);

// Tap Grade A area (inside Fill UCO section)
let xml = dump('apk-sell-prebook');
let ns = nodes(xml);
const gradeBtn = ns.find((n) => /Grade A/i.test(n.d) && n.click === 'true');
const gradeArea = ns.find((n) => /Choose Oil Grade|Grade A/i.test(n.d));
if (gradeBtn) {
  console.log('tap gradeBtn', gradeBtn);
  adb('shell', 'input', 'tap', String(gradeBtn.x), String(gradeBtn.y));
} else if (gradeArea) {
  // Grade A chip typically under "Choose Oil Grade"
  console.log('tap gradeArea lower', gradeArea);
  adb('shell', 'input', 'tap', String(gradeArea.x - 200), String(gradeArea.y + 120));
}
sleep(800);

// Scroll down until Book visible
for (let i = 0; i < 6; i++) {
  xml = dump('apk-sell-scroll' + i);
  ns = nodes(xml);
  const book = ns.find((n) => /Book your slot/i.test(n.d));
  const total = ns.find((n) => /Total Amount|0\.00 Kg|10\.00|Bill/i.test(n.d + n.t));
  console.log('scroll', i, 'book', !!book, 'total?', total && (total.d || total.t));
  if (book) {
    console.log(nt('screenshot', 'apk-sell-ready.png'));
    adb('shell', 'input', 'tap', String(book.x), String(book.y));
    sleep(10000);
    console.log(nt('screenshot', 'apk-sell-submitted.png'));
    console.log(nt('dump', 'apk-sell-submitted'));
    xml = dump('apk-sell-after');
    ns = nodes(xml);
    console.log(
      'after book',
      ns
        .filter((n) => n.d || n.t)
        .map((n) => n.d || n.t)
        .slice(0, 40)
    );
    return;
  }
  adb('shell', 'input', 'swipe', '540', '1900', '540', '900', '280');
  sleep(900);
}
console.log('Book not found');
console.log(nt('screenshot', 'apk-sell-nobook.png'));
console.log(nt('dump', 'apk-sell-nobook'));
