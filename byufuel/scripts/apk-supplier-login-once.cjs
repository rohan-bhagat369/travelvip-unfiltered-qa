const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ADB =
  'C:\\Users\\Rohan Bhagat\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe\\platform-tools\\adb.exe';
const tap = path.join(__dirname, 'apk-tap.cjs');
const OUT = 'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25';

function adb(...args) {
  console.log('adb', args.join(' '));
  return execFileSync(ADB, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function nt(...args) {
  return execFileSync(process.execPath, [tap, ...args], { encoding: 'utf8' });
}
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const user = '9876501001';
const pass = fs.readFileSync(path.join(OUT, 'sup-pass.txt'), 'utf8').trim();

adb('shell', 'pm', 'clear', 'com.byufuel.mobile');
adb('shell', 'am', 'start', '-n', 'com.byufuel.mobile/.MainActivity');
sleep(5000);
try {
  console.log(nt('tap-desc', 'Allow'));
} catch (_) {}
console.log(nt('tap-desc', 'Email Address'));
sleep(500);
adb('shell', `input text ${user}`);
sleep(600);
console.log(nt('tap', '540', '1050'));
sleep(500);
// Quote so device shell keeps $
adb('shell', `input text '${pass}'`);
sleep(600);
// Dismiss keyboard without leaving app: tap Welcome header
console.log(nt('tap', '540', '660'));
sleep(800);
console.log(nt('screenshot', 'apk-sup-before-login.png'));
console.log(nt('dump', 'apk-sup-before-login'));
console.log(nt('tap-desc', 'Login'));
sleep(12000);
console.log(nt('screenshot', 'apk-sup-after-login.png'));
console.log(nt('dump', 'apk-sup-after-login'));
