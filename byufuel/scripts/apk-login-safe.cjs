const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ADB =
  'C:\\Users\\Rohan Bhagat\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe\\platform-tools\\adb.exe';
const tap = path.join(__dirname, 'apk-tap.cjs');
const OUT = 'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25';

function adb(...args) {
  return execFileSync(ADB, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function nt(...args) {
  return execFileSync(process.execPath, [tap, ...args], { encoding: 'utf8' });
}
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const user = process.argv[2];
const passFile = process.argv[3];
const pass = passFile.startsWith('@')
  ? fs.readFileSync(passFile.slice(1), 'utf8').trim()
  : process.argv[3];
const tag = process.argv[4] || 'login';

adb('shell', 'pm', 'clear', 'com.byufuel.mobile');
adb('shell', 'am', 'start', '-n', 'com.byufuel.mobile/.MainActivity');
sleep(5000);
try {
  nt('tap-desc', 'Allow');
} catch (_) {}
console.log(nt('tap-desc', 'Email Address'));
sleep(400);
// digits-only or simple: no shell metachar issues
if (/^\d+$/.test(user)) adb('shell', 'input', 'text', user);
else adb('shell', `input text '${user.replace(/'/g, "'\\''")}'`);
sleep(500);
console.log(nt('tap', '540', '1050'));
sleep(400);
adb('shell', `input text '${pass.replace(/'/g, "'\\''")}'`);
sleep(500);
// hide IME via swipe only (no BACK)
adb('shell', 'input', 'swipe', '540', '1700', '540', '500', '200');
sleep(1000);
console.log(nt('tap-desc', 'Login'));
sleep(12000);
console.log(nt('screenshot', `apk-${tag}.png`));
console.log(nt('dump', `apk-${tag}`));
