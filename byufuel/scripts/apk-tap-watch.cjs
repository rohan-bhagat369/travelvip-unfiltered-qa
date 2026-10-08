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
adb('logcat', '-c');
adb('shell', 'input', 'tap', process.argv[2], process.argv[3]);
sleep(900);
const buf = execFileSync(ADB, ['-s', SER, 'exec-out', 'screencap', '-p']);
fs.writeFileSync(path.join(OUT, 'sup-forgot-toast.png'), buf);
const log = adb('logcat', '-d', '-t', '120');
const lines = log.split(/\n/).filter((l) => /flutter|byufuel|OTP|Exception|error|toast/i.test(l));
console.log(lines.slice(-40).join('\n') || 'NO_MATCH');
