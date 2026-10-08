const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ADB =
  'C:\\Users\\Rohan Bhagat\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe\\platform-tools\\adb.exe';
const SER = '00117648V003247';
const OUT = 'd:/Travel VIP API Automation/reports/byufuel-drive';

function adb(...args) {
  return execFileSync(ADB, ['-s', SER, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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
      t: attr('text').replace(/&#10;/g, ' | '),
      d: attr('content-desc').replace(/&#10;/g, ' | '),
      hint: attr('hint'),
      cls: attr('class'),
      pwd: attr('password'),
      click: attr('clickable'),
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
  const buf = execFileSync(ADB, ['-s', SER, 'exec-out', 'screencap', '-p']);
  fs.writeFileSync(path.join(OUT, name + '.png'), buf);
}
function find(rows, re) {
  return rows.find((r) => re.test(r.d) || re.test(r.t) || re.test(r.hint));
}
function tapNode(rows, re) {
  const n = find(rows, re);
  if (!n) return null;
  adb('shell', 'input', 'tap', String(n.x), String(n.y));
  return n;
}

const cmd = process.argv[2] || 'dump';
const arg = process.argv[3] || 'probe';
if (cmd === 'dump') {
  const rows = dump(arg);
  console.log(labels(rows).join('\n'));
} else if (cmd === 'tap') {
  const rows = dump('before-' + arg);
  const n = tapNode(rows, new RegExp(arg, 'i'));
  console.log(n ? 'TAPPED ' + (n.d || n.t) + ' ' + n.x + ',' + n.y : 'MISS ' + arg);
  sleep(2000);
  console.log('---');
  console.log(labels(dump('after-' + arg)).join('\n'));
} else if (cmd === 'shot') {
  shot(arg);
  console.log('shot', arg);
} else if (cmd === 'type') {
  const text = process.argv[3];
  const x = process.argv[4];
  const y = process.argv[5];
  if (x && y) {
    adb('shell', 'input', 'tap', x, y);
    sleep(400);
    adb('shell', 'input', 'keyevent', '123', ...Array(40).fill('67'));
    sleep(200);
  }
  const escaped = String(text)
    .replace(/([\\@#$%&*()=|{};:<>?/!'"])/g, '\\$1')
    .replace(/ /g, '%s');
  adb('shell', 'input', 'text', escaped);
  sleep(400);
  console.log('TYPED');
} else if (cmd === 'tapxy') {
  adb('shell', 'input', 'tap', process.argv[3], process.argv[4]);
  sleep(2000);
  console.log(labels(dump(arg || 'tapxy')).join('\n'));
} else if (cmd === 'back') {
  adb('shell', 'input', 'keyevent', '4');
  sleep(1200);
  console.log(labels(dump(arg || 'after-back')).join('\n'));
}
