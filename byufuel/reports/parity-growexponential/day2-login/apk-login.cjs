/**
 * Login Byufuel UAT APK via adb (resource-ids: login-identifier, login-password, login-submit)
 * Usage: node apk-login.cjs <package> <email> <password> <shot.png>
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const [pkg, email, password, shot] = process.argv.slice(2);
if (!pkg || !email || !password || !shot) {
  console.error('Usage: node apk-login.cjs <package> <email> <password> <shot.png>');
  process.exit(1);
}

const OUT = path.dirname(shot);
const UI = path.join(OUT, `${pkg.split('.').pop()}-ui.xml`);

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function dump() {
  sh('adb shell uiautomator dump /sdcard/ui.xml');
  sh(`adb pull /sdcard/ui.xml "${UI}"`);
  return fs.readFileSync(UI, 'utf8');
}

function center(node) {
  const b = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if (!b) return null;
  return { x: (Number(b[1]) + Number(b[3])) / 2, y: (Number(b[2]) + Number(b[4])) / 2 };
}

function findById(xml, id) {
  const re = new RegExp(`<node[^>]*resource-id="${id}"[^>]*>`, 'i');
  const m = xml.match(re);
  return m ? m[0] : null;
}

function tap(x, y) {
  sh(`adb shell input tap ${Math.round(x)} ${Math.round(y)}`);
}

function typeText(s) {
  // adb input text: space=%s, @ is ok, # needs escape on some devices
  const esc = String(s)
    .replace(/\\/g, '\\\\')
    .replace(/ /g, '%s')
    .replace(/&/g, '\\&')
    .replace(/</g, '\\<')
    .replace(/>/g, '\\>')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"');
  sh(`adb shell input text ${esc}`);
}

function clearField() {
  sh('adb shell input keyevent 123'); // move end
  for (let i = 0; i < 50; i += 1) sh('adb shell input keyevent 67');
}

function texts(xml) {
  return [...xml.matchAll(/text="([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
}

console.log('Launch', pkg);
sh(`adb shell am force-stop ${pkg}`);
sh(`adb shell monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`);
sh('adb shell sleep 3');

let xml = dump();
let after = texts(xml);
console.log('Initial:\n' + after.slice(0, 15).join('\n'));

if (/Hi |Upcoming|Sell Oil|Request Pickup|Prospect|Collected|Planned/i.test(after.join(' ')) && !/Welcome/i.test(after.join(' '))) {
  console.log('ALREADY_LOGGED_IN');
  sh(`adb exec-out screencap -p > "${shot}"`);
  process.exit(0);
}

const idField = findById(xml, 'login-identifier');
const pwField = findById(xml, 'login-password');
if (!idField || !pwField) {
  console.log('FAIL_NO_LOGIN_FIELDS');
  sh(`adb exec-out screencap -p > "${shot}"`);
  process.exit(1);
}

const idC = center(idField);
tap(idC.x, idC.y);
sh('adb shell sleep 0.5');
clearField();
typeText(email);

const pwC = center(pwField);
tap(pwC.x, pwC.y);
sh('adb shell sleep 0.5');
clearField();
typeText(password);

// hide keyboard
sh('adb shell input keyevent 111'); // ESC
sh('adb shell input keyevent 4'); // BACK (often hides kb)
sh('adb shell sleep 1');

xml = dump();
let submit = findById(xml, 'login-submit');
if (!submit) {
  // fallback: clickable Login content-desc
  const m = xml.match(/resource-id="login-submit"[^>]*>/) || xml.match(/content-desc="Login"[^>]*clickable="true"[^>]*>/);
  submit = m ? m[0] : null;
}
if (submit) {
  const c = center(submit);
  console.log('Tap login-submit', c);
  tap(c.x, c.y);
} else {
  console.log('FAIL_NO_SUBMIT');
  sh(`adb exec-out screencap -p > "${shot}"`);
  process.exit(1);
}

sh('adb shell sleep 6');
xml = dump();
after = texts(xml);
console.log('After:\n' + after.slice(0, 40).join('\n'));
sh(`adb exec-out screencap -p > "${shot}"`);

const blob = after.join(' ');
const ok = /Hi |Home|Upcoming|Sell Oil|Request Pickup|Prospect|Visit|Collected|Planned|Dashboard|Check in|My Requests|Record a Visit/i.test(blob);
const stillLoginForm = /Forgot Password/i.test(blob) && /Sign Up/i.test(blob);
const err = /Invalid|incorrect|failed|unable/i.test(blob);
console.log(ok && !stillLoginForm ? 'PASS' : stillLoginForm ? (err ? 'FAIL_AUTH' : 'FAIL_STILL_LOGIN') : 'CHECK');
