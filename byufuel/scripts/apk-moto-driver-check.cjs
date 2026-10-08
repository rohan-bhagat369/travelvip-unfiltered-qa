const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ADB =
  'C:\\Users\\Rohan Bhagat\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe\\platform-tools\\adb.exe';
const SER = 'ZD222HYKTS';
const OUT = 'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25';

function adb(...a) {
  return execFileSync(ADB, ['-s', SER, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
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
    const t = g('text');
    const d = g('content-desc').replace(/&#10;/g, ' | ');
    if (!t && !d) continue;
    const b = g('bounds').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    out.push({
      t,
      d,
      click: g('clickable'),
      x: b ? ((+b[1] + +b[3]) / 2) | 0 : 0,
      y: b ? ((+b[2] + +b[4]) / 2) | 0 : 0,
      bounds: g('bounds'),
    });
  }
  return out;
}
function shot(name) {
  adb('shell', 'screencap', '-p', '/sdcard/moto.png');
  adb('pull', '/sdcard/moto.png', path.join(OUT, name));
}

// Open profile - typically top-right avatar; try tapping common area or find node
let ns = nodes(dump('apk-moto-home'));
console.log('HOME', ns.map((n) => n.d || n.t).slice(0, 30));

// Tap avatar area (right of Scan) - Scan ends ~393, avatar often near top right
adb('shell', 'input', 'tap', '980', '165');
sleep(2500);
ns = nodes(dump('apk-moto-profile'));
shot('apk-moto-driver-profile.png');
console.log('PROFILE', ns.map((n) => n.d || n.t).slice(0, 40));

// Back then Upcoming
adb('shell', 'input', 'keyevent', '4');
sleep(1500);
const upcoming = nodes(dump('apk-moto-home2')).find((n) => /Upcoming/i.test(n.d));
if (upcoming) {
  adb('shell', 'input', 'tap', String(upcoming.x), String(upcoming.y));
  sleep(2500);
}
ns = nodes(dump('apk-moto-upcoming'));
shot('apk-moto-driver-upcoming.png');
console.log('UPCOMING', ns.map((n) => n.d || n.t).slice(0, 40));

fs.writeFileSync(
  path.join(OUT, 'apk-moto-driver-check.json'),
  JSON.stringify(
    {
      at: new Date().toISOString(),
      serial: SER,
      model: 'motorola edge 40 neo',
      package: 'com.byufuel.mobile',
      home: nodes(fs.readFileSync(path.join(OUT, 'apk-moto-home.xml'), 'utf8')).map((n) => n.d || n.t),
      profile: nodes(fs.readFileSync(path.join(OUT, 'apk-moto-profile.xml'), 'utf8')).map((n) => n.d || n.t),
      upcoming: ns.map((n) => n.d || n.t),
    },
    null,
    2
  )
);
