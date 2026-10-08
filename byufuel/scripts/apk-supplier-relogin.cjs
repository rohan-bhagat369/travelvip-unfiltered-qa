const { execSync } = require('child_process');
const fs = require('fs');
const adb =
  'C:\\Users\\Rohan Bhagat\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe\\platform-tools\\adb.exe';
const serial = process.argv[2] || '00117648V003247';
const outDir = 'd:/Travel VIP API Automation/reports/byufuel-drive';
const email = process.argv[3] || 'qa.supplier.byufuel@yopmail.com';
const pass = process.argv[4] || 'H5oo#I5#';

function sh(cmd) {
  return execSync(`"${adb}" -s ${serial} ${cmd}`, { encoding: 'utf8' });
}
function dump(name) {
  sh('shell uiautomator dump /sdcard/ui.xml');
  sh(`pull /sdcard/ui.xml "${outDir}/${name}.xml"`);
  return fs.readFileSync(`${outDir}/${name}.xml`, 'utf8');
}
function tapDesc(xml, needle) {
  const re = /<node [^>]*>/g;
  let m;
  while ((m = re.exec(xml))) {
    const a = (n) => {
      const mm = m[0].match(new RegExp(n + '="([^"]*)"'));
      return mm ? mm[1] : '';
    };
    const d = (a('content-desc') || a('text') || '').replace(/&#10;/g, ' ');
    const b = a('bounds');
    if (new RegExp(needle, 'i').test(d) && b) {
      const mm = b.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
      if (mm) {
        const x = ((+mm[1] + +mm[3]) / 2) | 0;
        const y = ((+mm[2] + +mm[4]) / 2) | 0;
        sh(`shell input tap ${x} ${y}`);
        return { d, x, y };
      }
    }
  }
  return null;
}
function tapPasswordEdit(xml) {
  const re = /<node [^>]*>/g;
  let m;
  const edits = [];
  while ((m = re.exec(xml))) {
    const a = (n) => {
      const mm = m[0].match(new RegExp(n + '="([^"]*)"'));
      return mm ? mm[1] : '';
    };
    if (!/EditText/i.test(a('class'))) continue;
    const b = a('bounds');
    const mm = b && b.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (!mm) continue;
    edits.push({
      pwd: a('password') === 'true',
      x: ((+mm[1] + +mm[3]) / 2) | 0,
      y: ((+mm[2] + +mm[4]) / 2) | 0,
    });
  }
  const pwd = edits.find((e) => e.pwd) || edits[1] || edits[0];
  if (pwd) sh(`shell input tap ${pwd.x} ${pwd.y}`);
  return pwd;
}
function typeText(s) {
  // adb input text: escape spaces as %s; # ( ) < > | ; & * \\ need care
  const esc = s
    .replace(/\\/g, '\\\\')
    .replace(/ /g, '%s')
    .replace(/([ #@()<>|&;*'`])/g, '\\$1');
  sh(`shell input text "${esc}"`);
}

let xml = dump('apk-sup-relogin-start');
tapDesc(xml, 'Email Address or Phone Number|Email');
sh('shell input keyevent KEYCODE_MOVE_END');
// clear field roughly
for (let i = 0; i < 40; i++) sh('shell input keyevent KEYCODE_DEL');
typeText(email);
xml = dump('apk-sup-relogin-email');
tapPasswordEdit(xml);
typeText(pass);
xml = dump('apk-sup-relogin-pass');
tapDesc(xml, '^Login$');
setTimeout(() => {}, 0);
sh('shell sleep 5');
xml = dump('apk-sup-relogin-done');
const texts = [...xml.matchAll(/content-desc="([^"]+)"/g)].map((x) =>
  x[1].replace(/&#10;/g, ' | ').slice(0, 120)
);
console.log(texts.filter(Boolean).slice(0, 30).join('\n'));
