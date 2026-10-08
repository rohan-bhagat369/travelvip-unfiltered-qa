const { execFileSync } = require('child_process');
const fs = require('fs');

const ADB =
  'C:\\Users\\Rohan Bhagat\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe\\platform-tools\\adb.exe';
const SER = '00117648V003247';
const pass = fs
  .readFileSync('reports/byufuel-drive/execution-2026-09-25/atul-pass.txt', 'utf8')
  .trim();

function adb(...args) {
  execFileSync(ADB, ['-s', SER, ...args], { stdio: 'ignore' });
}
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function typeAt(x, y, text) {
  adb('shell', 'input', 'tap', String(x), String(y));
  sleep(500);
  adb('shell', 'input', 'keyevent', '123', ...Array(60).fill('67'));
  sleep(200);
  const escaped = String(text)
    .replace(/([\\@#$%&*()=|{};:<>?/!'"])/g, '\\$1')
    .replace(/ /g, '%s');
  adb('shell', 'input', 'text', escaped);
  sleep(400);
}

typeAt(603, 848, 'atul@yopmail.com');
adb('shell', 'input', 'keyevent', '4');
sleep(600);
typeAt(540, 1013, pass);
adb('shell', 'input', 'keyevent', '4');
sleep(600);
adb('shell', 'input', 'tap', '540', '1433');
sleep(5000);
console.log('DRIVER_LOGIN_TAPPED');
