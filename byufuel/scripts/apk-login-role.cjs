const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ADB =
  'C:\\Users\\Rohan Bhagat\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe\\platform-tools\\adb.exe';
const OUT = 'd:/Travel VIP API Automation/reports/byufuel-drive';
const serial = process.argv[2];
const email = process.argv[3];
const pass = process.argv[4];
const tag = process.argv[5] || 'login';

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
    const bounds = attr('bounds');
    const b = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    rows.push({
      t: attr('text'),
      d: attr('content-desc'),
      hint: attr('hint'),
      cls: attr('class'),
      pwd: attr('password'),
      bounds,
      x: b ? Math.floor((+b[1] + +b[3]) / 2) : 0,
      y: b ? Math.floor((+b[2] + +b[4]) / 2) : 0,
    });
  }
  return rows;
}
function labels(rows) {
  return rows.map((r) => r.d || r.t || r.hint).filter(Boolean);
}
function shot(name) {
  const png = path.join(OUT, name + '.png');
  const buf = execFileSync(ADB, ['-s', serial, 'exec-out', 'screencap', '-p'], { stdio: ['ignore', 'pipe', 'pipe'] });
  fs.writeFileSync(png, buf);
}

adb('shell', 'am', 'start', '-n', 'com.byufuel.mobile/.MainActivity');
sleep(5000);
let rows = dump(tag + '-open');
let text = labels(rows).join(' | ');
console.log('OPEN', text.slice(0, 500));

const alreadyHome = /Hi |Upcoming|Sell Oil|Next Itinerary|Ongoing/i.test(text);
if (alreadyHome && !/Email Address|Welcome/i.test(text)) {
  shot(tag + '-already');
  console.log('ALREADY_IN', text.slice(0, 400));
  process.exit(0);
}

function field(pred) {
  return rows.find(pred);
}
const emailNode =
  field((r) => /Email Address/i.test(r.d) || /Email Address/i.test(r.hint) || /Email Address/i.test(r.t)) ||
  field((r) => r.cls.includes('EditText') && r.pwd !== 'true');
const passNode =
  field((r) => r.pwd === 'true' || /Password/i.test(r.hint) || (r.d === 'Password')) ||
  rows.filter((r) => r.cls.includes('EditText'))[1];
if (!emailNode || !passNode) {
  console.log('NO_FIELDS');
  console.log(labels(rows).join('\n'));
  process.exit(1);
}

function clearField(x, y) {
  adb('shell', 'input', 'tap', String(x), String(y));
  sleep(300);
  adb('shell', 'input', 'keyevent', '123', ...Array(60).fill('67'));
  sleep(200);
}
clearField(emailNode.x, emailNode.y);
adb('shell', 'input', 'text', escapeAdb(email));
sleep(400);
clearField(passNode.x, passNode.y);
adb('shell', 'input', 'text', escapeAdb(pass));
sleep(400);
adb('shell', 'input', 'tap', '540', '400');
sleep(600);
rows = dump(tag + '-filled');
const login = rows.find((r) => r.d === 'Login' || r.t === 'Login');
if (!login) {
  console.log('NO_LOGIN', labels(rows).join(' | ').slice(0, 400));
  process.exit(1);
}
adb('shell', 'input', 'tap', String(login.x), String(login.y));
sleep(12000);
rows = dump(tag + '-after');
shot(tag + '-after');
const after = labels(rows).join(' | ');
console.log('AFTER', after.slice(0, 700));
