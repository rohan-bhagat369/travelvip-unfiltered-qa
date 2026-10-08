const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ADB =
  'C:\\Users\\Rohan Bhagat\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe\\platform-tools\\adb.exe';
const serial = '00117648V003247';
const OUT = 'd:/Travel VIP API Automation/reports/byufuel-drive';
execFileSync(ADB, ['-s', serial, 'shell', 'uiautomator', 'dump', '/sdcard/uidump.xml']);
execFileSync(ADB, ['-s', serial, 'pull', '/sdcard/uidump.xml', path.join(OUT, 'apk-tsm-now.xml')]);
const png = path.join(OUT, 'apk-tsm-now.png');
execFileSync(ADB, ['-s', serial, 'exec-out', 'screencap', '-p'], {
  stdio: ['ignore', fs.openSync(png, 'w'), 'pipe'],
});
const xml = fs.readFileSync(path.join(OUT, 'apk-tsm-now.xml'), 'utf8');
const ds = [...xml.matchAll(/content-desc="([^"]+)"/g)].map((m) => m[1]).filter(Boolean);
const ts = [...xml.matchAll(/text="([^"]+)"/g)].map((m) => m[1]).filter(Boolean);
console.log(ds.concat(ts).join('\n'));
