/**
 * Login Byufuel APK with special-char password via adb (no shell expansion).
 * Usage: node scripts/apk-login.cjs <emailOrPhone> <password> [tag]
 */
const { execFileSync } = require('child_process');
const path = require('path');

const ADB =
  process.env.ADB ||
  'C:\\Users\\Rohan Bhagat\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe\\platform-tools\\adb.exe';
const tap = path.join(__dirname, 'apk-tap.cjs');

function adb(...args) {
  return execFileSync(ADB, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function nodeTap(...args) {
  return execFileSync(process.execPath, [tap, ...args], { encoding: 'utf8' });
}
function escapeAdb(s) {
  // adb input text: escape spaces as %s; escape @ # $ etc with \
  return String(s)
    .replace(/([\\@#$%&*()=|{};:<>?/!'"])/g, '\\$1')
    .replace(/ /g, '%s');
}

const email = process.argv[2];
const pass = process.argv[3];
const tag = process.argv[4] || 'login';

adb('shell', 'pm', 'clear', 'com.byufuel.mobile');
adb('shell', 'am', 'start', '-n', 'com.byufuel.mobile/.MainActivity');
require('child_process').execFileSync('powershell', ['-Command', 'Start-Sleep -Seconds 5'], { stdio: 'ignore' });
try {
  console.log(nodeTap('tap-desc', 'Allow'));
} catch (_) {}
console.log(nodeTap('tap-desc', 'Email Address'));
adb('shell', 'input', 'text', escapeAdb(email));
require('child_process').execFileSync('powershell', ['-Command', 'Start-Sleep -Seconds 1'], { stdio: 'ignore' });
console.log(nodeTap('tap', '540', '1050'));
adb('shell', 'input', 'text', escapeAdb(pass));
require('child_process').execFileSync('powershell', ['-Command', 'Start-Sleep -Seconds 1'], { stdio: 'ignore' });
console.log(nodeTap('tap-desc', 'Login'));
require('child_process').execFileSync('powershell', ['-Command', 'Start-Sleep -Seconds 8'], { stdio: 'ignore' });
console.log(nodeTap('screenshot', `apk-${tag}.png`));
console.log(nodeTap('dump', `apk-${tag}`));
