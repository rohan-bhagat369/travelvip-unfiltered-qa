import { spawnSync } from 'child_process';

const password = process.argv[2];
if (!password) {
  console.error('pass required');
  process.exit(2);
}
const r = spawnSync('adb', ['shell', `input text '${password}'`], { encoding: 'utf8' });
console.log('status', r.status);
console.log(r.stdout || '');
console.log(r.stderr || '');
