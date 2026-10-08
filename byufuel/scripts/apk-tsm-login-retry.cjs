const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ADB =
  'C:\\Users\\Rohan Bhagat\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe\\platform-tools\\adb.exe';
const OUT = 'd:/Travel VIP API Automation/reports/byufuel-drive';
const serial = '00117648V003247';
const pass = process.argv[2];

function adb(...args) {
  return execFileSync(ADB, ['-s', serial, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function escapeAdb(s) {
  return String(s)
    .replace(/([\\@#$%&*()=|{};:<>?/!'"])/g, '\\$1')
    .replace(/ /g, '%s');
}
function dump(name) {
  adb('shell', 'uiautomator', 'dump', '/sdcard/uidump.xml');
  const local = path.join(OUT, name + '.xml');
  adb('pull', '/sdcard/uidump.xml', local);
  const xml = fs.readFileSync(local, 'utf8');
  const rows = [];
  const re = /<node [^>]*>/g;
  let m;
  while ((m = re.exec(xml))) {
    const attr = (n) => {
      const mm = m[0].match(new RegExp(n + '="([^"]*)"'));
      return mm ? mm[1] : '';
    };
    rows.push({
      cls: attr('class').split('.').pop(),
      t: attr('text'),
      d: attr('content-desc'),
      hint: attr('hint'),
      pwd: attr('password'),
      bounds: attr('bounds'),
    });
  }
  return rows;
}
function center(bounds) {
  const m = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  return { x: Math.floor((+m[1] + +m[3]) / 2), y: Math.floor((+m[2] + +m[4]) / 2) };
}
function shot(name) {
  const p = path.join(OUT, name);
  execFileSync(ADB, ['-s', serial, 'exec-out', 'screencap', '-p'], {
    stdio: ['ignore', fs.openSync(p, 'w'), 'pipe'],
  });
  return p;
}

adb('shell', 'input', 'keyevent', '4');
sleep(1500);
let rows = dump('apk-tsm-back');
const summary = rows
  .filter((r) => r.d || r.t || r.hint || r.pwd === 'true')
  .map((r) => [r.cls, r.bounds, r.d || r.t || r.hint, r.pwd].join(' | '));
console.log('AFTER BACK\n' + summary.join('\n'));

const pwd = rows.find((r) => r.pwd === 'true');
if (!pwd) {
  console.log('no password field');
  process.exit(1);
}
const pc = center(pwd.bounds);
adb('shell', 'input', 'tap', String(pc.x), String(pc.y));
sleep(400);
adb('shell', 'input', 'text', escapeAdb(pass));
sleep(400);
adb('shell', 'input', 'tap', '540', '668');
sleep(600);
rows = dump('apk-tsm-ready');
const login = rows.find((r) => r.d === 'Login');
if (!login) {
  console.log('no login button');
  console.log(rows.filter((r) => r.d || r.t).map((r) => r.d || r.t).join('\n'));
  process.exit(1);
}
const lc = center(login.bounds);
adb('shell', 'input', 'tap', String(lc.x), String(lc.y));
sleep(12000);
rows = dump('apk-tsm-after-login');
const png = shot('apk-tsm-after-login.png');
const labels = rows.map((r) => r.d || r.t).filter(Boolean);
let log = '';
try {
  log = adb('logcat', '-d', '-t', '300');
} catch (e) {
  log = String(e.stdout || '');
}
const hosts = [...new Set([...log.matchAll(/https?:\/\/[^\s"']+/g)].map((m) => m[0]))];
fs.writeFileSync(
  path.join(OUT, 'apk-tsm-after-login.json'),
  JSON.stringify({ png, labels, hosts: hosts.slice(0, 40) }, null, 2)
);
console.log('\nAFTER LOGIN');
console.log(labels.slice(0, 40).join('\n'));
console.log('png', png);
console.log('hosts', hosts.slice(0, 20).join('\n'));
