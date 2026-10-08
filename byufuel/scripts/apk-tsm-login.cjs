/**
 * Login TSM on one device. Usage:
 *   node scripts/apk-tsm-login.cjs <serial> <email> <password>
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ADB =
  'C:\\Users\\Rohan Bhagat\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe\\platform-tools\\adb.exe';
const OUT = 'd:/Travel VIP API Automation/reports/byufuel-drive';
const serial = process.argv[2];
const email = process.argv[3];
const pass = process.argv[4];
if (!serial || !email || !pass) {
  console.error('usage: node scripts/apk-tsm-login.cjs <serial> <email> <password>');
  process.exit(1);
}

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
  const local = path.join(OUT, `${name}.xml`);
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
      click: attr('clickable'),
      bounds: attr('bounds'),
    });
  }
  return rows;
}
function center(bounds) {
  const m = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!m) return null;
  return { x: Math.floor((+m[1] + +m[3]) / 2), y: Math.floor((+m[2] + +m[4]) / 2) };
}
function tapLabel(rows, substr) {
  const hit = rows.find(
    (r) => (r.d + ' ' + r.t).toLowerCase().includes(substr.toLowerCase()) && r.bounds
  );
  if (!hit) return { ok: false, substr };
  const c = center(hit.bounds);
  adb('shell', 'input', 'tap', String(c.x), String(c.y));
  return { ok: true, tapped: hit.d || hit.t, ...c };
}
function labels(rows) {
  return rows.map((r) => r.d || r.t).filter(Boolean).slice(0, 40);
}
function shot(name) {
  const p = path.join(OUT, name);
  execFileSync(ADB, ['-s', serial, 'exec-out', 'screencap', '-p'], {
    stdio: ['ignore', fs.openSync(p, 'w'), 'pipe'],
  });
  return p;
}

adb('logcat', '-c');
adb('shell', 'pm', 'clear', 'com.byufuel.mobile');
adb('shell', 'am', 'start', '-n', 'com.byufuel.mobile/.MainActivity');
sleep(6000);
let rows = dump('apk-tsm-login-start');
const allow = tapLabel(rows, 'Allow');
if (allow.ok) {
  sleep(1500);
  rows = dump('apk-tsm-login-after-allow');
}
const emailTap = tapLabel(rows, 'Email');
sleep(500);
adb('shell', 'input', 'text', escapeAdb(email));
sleep(400);
rows = dump('apk-tsm-login-email');
const passTap = tapLabel(rows, 'Password');
sleep(400);
adb('shell', 'input', 'text', escapeAdb(pass));
sleep(400);
adb('shell', 'input', 'keyevent', '111');
sleep(500);
rows = dump('apk-tsm-login-filled');
const loginTap = tapLabel(rows, 'Login');
sleep(10000);
rows = dump('apk-tsm-login-result');
const png = shot('apk-tsm-login.png');
let log = '';
try {
  log = adb('logcat', '-d', '-t', '200');
} catch (e) {
  log = String(e.stdout || e.message || '');
}
const hosts = [...log.matchAll(/https?:\/\/[^\s"']+/g)].map((m) => m[0]);
const interesting = log
  .split('\n')
  .filter((l) => /azure|ngrok|cloudflare|keycloak|byufuel|login|401|403|error/i.test(l))
  .slice(-40);
fs.writeFileSync(
  path.join(OUT, 'apk-tsm-login-result.json'),
  JSON.stringify(
    {
      serial,
      email,
      allow,
      emailTap,
      passTap,
      loginTap,
      resultLabels: labels(rows),
      png,
      hosts: [...new Set(hosts)].slice(0, 30),
      logLines: interesting,
    },
    null,
    2
  )
);
console.log(
  JSON.stringify(
    {
      allow,
      emailTap,
      passTap,
      loginTap,
      resultLabels: labels(rows),
      png,
      hosts: [...new Set(hosts)].slice(0, 15),
    },
    null,
    2
  )
);
