const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ADB =
  'C:\\Users\\Rohan Bhagat\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe\\platform-tools\\adb.exe';
const SER = 'ZD222HYKTS';
const OUT = 'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25';

function adb(...a) {
  return execFileSync(ADB, ['-s', SER, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

adb('shell', 'uiautomator', 'dump', '/sdcard/uidump.xml');
const xmlPath = path.join(OUT, 'apk-moto-driver-uidump.xml');
adb('pull', '/sdcard/uidump.xml', xmlPath);
adb('shell', 'screencap', '-p', '/sdcard/moto-driver.png');
adb('pull', '/sdcard/moto-driver.png', path.join(OUT, 'apk-moto-driver-screen.png'));

const xml = fs.readFileSync(xmlPath, 'utf8');
const out = [];
const re = /<node [^>]*>/g;
let m;
while ((m = re.exec(xml))) {
  const a = m[0];
  const g = (n) => {
    const x = a.match(new RegExp(n + '="([^"]*)"'));
    return x ? x[1] : '';
  };
  const t = g('text');
  const d = g('content-desc').replace(/&#10;/g, ' | ');
  if (!t && !d) continue;
  out.push({
    cls: g('class').split('.').pop(),
    t,
    d,
    click: g('clickable'),
    bounds: g('bounds'),
  });
}
console.log(JSON.stringify(out, null, 2));
fs.writeFileSync(path.join(OUT, 'apk-moto-driver-ui.json'), JSON.stringify({ serial: SER, model: 'motorola edge 40 neo', nodes: out }, null, 2));
