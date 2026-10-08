const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ADB =
  'C:\\Users\\Rohan Bhagat\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe\\platform-tools\\adb.exe';
const OUT = 'd:/Travel VIP API Automation/reports/byufuel-drive';
const serial = '00117648V003247';
const email = 'rohan.tsm.byufuel@yopmail.com';
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
function clearField(x, y) {
  adb('shell', 'input', 'tap', String(x), String(y));
  sleep(300);
  const dels = Array(80).fill('67');
  adb('shell', 'input', 'keyevent', '123', ...dels);
  sleep(300);
}

adb('logcat', '-c');
clearField(540, 848);
adb('shell', 'input', 'text', escapeAdb(email));
sleep(400);
clearField(540, 1013);
adb('shell', 'input', 'text', escapeAdb(pass));
sleep(400);
adb('shell', 'input', 'tap', '540', '668');
sleep(700);
let rows = dump('apk-tsm-clean');
const emailText = rows.find((r) => (r.t || '').includes('@'))?.t || '';
const login = rows.find((r) => r.d === 'Login');
console.log('emailField', emailText);
if (!login) {
  console.log(rows.map((r) => r.d || r.t).filter(Boolean).join('\n'));
  process.exit(1);
}
const lc = center(login.bounds);
adb('shell', 'input', 'tap', String(lc.x), String(lc.y));
sleep(15000);
rows = dump('apk-tsm-home');
const png = path.join(OUT, 'apk-tsm-home.png');
execFileSync(ADB, ['-s', serial, 'exec-out', 'screencap', '-p'], {
  stdio: ['ignore', fs.openSync(png, 'w'), 'pipe'],
});
const labels = rows.map((r) => r.d || r.t).filter(Boolean);
let log = '';
try {
  log = adb('logcat', '-d', '-t', '400');
} catch (e) {
  log = String(e.stdout || '');
}
const lines = log
  .split('\n')
  .filter((l) => /https?:\/\/|flutter|byufuel|keycloak|401|403|Exception|error/i.test(l))
  .slice(-50);
fs.writeFileSync(path.join(OUT, 'apk-tsm-home.json'), JSON.stringify({ emailText, labels, lines }, null, 2));
console.log('LABELS');
console.log(labels.slice(0, 50).join('\n'));
console.log('LOG');
console.log(lines.join('\n'));
