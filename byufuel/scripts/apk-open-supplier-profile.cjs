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

adb('shell', 'am', 'start', '-n', 'com.byufuel.mobile/.MainActivity');
sleep(3000);
adb('shell', 'uiautomator', 'dump', '/sdcard/uidump.xml');
adb('pull', '/sdcard/uidump.xml', path.join(OUT, 'apk-sup-full.xml'));
const xml = fs.readFileSync(path.join(OUT, 'apk-sup-full.xml'), 'utf8');
const nodes = [];
const re = /<node [^>]*>/g;
let m;
while ((m = re.exec(xml))) {
  const a = m[0];
  const g = (n) => {
    const x = a.match(new RegExp(n + '="([^"]*)"'));
    return x ? x[1] : '';
  };
  if (g('clickable') !== 'true') continue;
  const b = g('bounds').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!b) continue;
  const y = (+b[2] + +b[4]) / 2;
  if (y > 280) continue;
  nodes.push({
    t: g('text'),
    d: g('content-desc'),
    bounds: g('bounds'),
    x: ((+b[1] + +b[3]) / 2) | 0,
    y: y | 0,
  });
}
console.log('header clickables', nodes);

// Prefer rightmost header icon (profile)
const profile = nodes.sort((a, b) => b.x - a.x)[0];
if (profile) {
  console.log('tapping', profile);
  adb('shell', 'input', 'tap', String(profile.x), String(profile.y));
  sleep(4000);
}
console.log(nt('screenshot', 'apk-sup-after-avatar.png'));
console.log(nt('dump', 'apk-sup-after-avatar'));
