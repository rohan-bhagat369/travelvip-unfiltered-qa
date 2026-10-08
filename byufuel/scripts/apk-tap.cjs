/**
 * Simple APK UI helper via adb + uiautomator dump.
 * Usage: node scripts/apk-tap.cjs <dump|tap-desc|tap-bounds|screenshot> [args]
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ADB =
  process.env.ADB ||
  'C:\\Users\\Rohan Bhagat\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe\\platform-tools\\adb.exe';
const OUT = 'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25';

function adb(...args) {
  return execFileSync(ADB, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function dump(name = 'uidump') {
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
    const t = attr('text');
    const d = attr('content-desc');
    const id = attr('resource-id');
    const bounds = attr('bounds');
    const click = attr('clickable');
    if (t || d || id) rows.push({ t, d, id, click, bounds });
  }
  return { local, rows };
}

function center(bounds) {
  const m = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!m) return null;
  return {
    x: Math.floor((+m[1] + +m[3]) / 2),
    y: Math.floor((+m[2] + +m[4]) / 2),
  };
}

function tapDesc(substr) {
  const { rows } = dump('uidump-tap');
  const hit = rows.find((r) => (r.d + r.t).toLowerCase().includes(substr.toLowerCase()) && r.click === 'true');
  if (!hit) {
    console.log(JSON.stringify({ ok: false, reason: 'not found', substr, sample: rows.map((r) => r.d || r.t).filter(Boolean).slice(0, 30) }));
    return;
  }
  const c = center(hit.bounds);
  adb('shell', 'input', 'tap', String(c.x), String(c.y));
  console.log(JSON.stringify({ ok: true, tapped: hit.d || hit.t, ...c }));
}

function screenshot(name) {
  const p = path.join(OUT, name);
  execFileSync(ADB, ['exec-out', 'screencap', '-p'], { stdio: ['ignore', fs.openSync(p, 'w'), 'pipe'] });
  console.log(JSON.stringify({ ok: true, path: p, size: fs.statSync(p).size }));
}

const cmd = process.argv[2];
if (cmd === 'dump') {
  const name = process.argv[3] || 'uidump';
  const { rows } = dump(name);
  console.log(JSON.stringify(rows, null, 2));
} else if (cmd === 'tap-desc') {
  tapDesc(process.argv[3] || '');
} else if (cmd === 'screenshot') {
  screenshot(process.argv[3] || 'apk-screen.png');
} else if (cmd === 'tap') {
  adb('shell', 'input', 'tap', process.argv[3], process.argv[4]);
  console.log(JSON.stringify({ ok: true, x: process.argv[3], y: process.argv[4] }));
} else if (cmd === 'back') {
  adb('shell', 'input', 'keyevent', '4');
  console.log(JSON.stringify({ ok: true, key: 'BACK' }));
} else {
  console.error('usage: dump|tap-desc|tap|screenshot|back');
  process.exit(1);
}
