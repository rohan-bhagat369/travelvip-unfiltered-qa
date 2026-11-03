#!/usr/bin/env node
/**
 * Desktop + mobile screen recording for Disagree retest cases.
 *
 * Desktop (ffmpeg gdigrab):
 *   node byufuel/scripts/disagree-record.cjs start ADM-01
 *   node byufuel/scripts/disagree-record.cjs stop
 *
 * Mobile (adb screenrecord → pull into case folder):
 *   node byufuel/scripts/disagree-record.cjs mobile-start DRV-03
 *   node byufuel/scripts/disagree-record.cjs mobile-stop
 *
 *   node byufuel/scripts/disagree-record.cjs status
 */
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync, execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../reports/disagree-retest');
const PID_FILE = path.join(ROOT, '.recording.pid');
const META_FILE = path.join(ROOT, '.recording.json');
const MOBILE_META = path.join(ROOT, '.mobile-recording.json');
const DEVICE_TMP = '/sdcard/Download/byufuel_disagree_rec.mp4';

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function caseDir(caseId) {
  const dir = path.join(ROOT, caseId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function outPath(caseId, kind) {
  const prefix = kind === 'mobile' ? `${caseId}_mobile` : caseId;
  return path.join(caseDir(caseId), `${prefix}_${stamp()}.mp4`);
}

function adb(args, opts = {}) {
  return spawnSync('adb', args, { encoding: 'utf8', windowsHide: true, ...opts });
}

function start(caseId) {
  if (!caseId) throw new Error('case id required');
  if (fs.existsSync(PID_FILE)) {
    const prev = JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
    throw new Error(`Already recording ${prev.caseId} (pid ${prev.pid}). Stop first.`);
  }
  const file = outPath(caseId, 'desktop');
  const args = [
    '-y', '-f', 'gdigrab', '-framerate', '12', '-i', 'desktop',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', file,
  ];
  const child = spawn('ffmpeg', args, {
    detached: true,
    stdio: ['ignore', 'ignore', fs.openSync(path.join(ROOT, `${caseId}.ffmpeg.log`), 'a')],
    windowsHide: true,
  });
  child.unref();
  const meta = { kind: 'desktop', caseId, pid: child.pid, file, startedAt: new Date().toISOString() };
  fs.writeFileSync(PID_FILE, String(child.pid));
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2));
  console.log(JSON.stringify({ ok: true, action: 'start', ...meta }, null, 2));
}

function stop() {
  if (!fs.existsSync(PID_FILE)) {
    console.log(JSON.stringify({ ok: false, error: 'no active desktop recording' }));
    return;
  }
  const meta = JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
  const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
  try {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
  } catch (_) {}
  // brief wait for flush
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
  try { fs.unlinkSync(PID_FILE); } catch (_) {}
  try { fs.unlinkSync(META_FILE); } catch (_) {}
  const exists = fs.existsSync(meta.file);
  const size = exists ? fs.statSync(meta.file).size : 0;
  console.log(JSON.stringify({ ok: true, action: 'stop', ...meta, exists, size }, null, 2));
}

function mobileStart(caseId, timeLimitSec = 180) {
  if (!caseId) throw new Error('case id required');
  if (fs.existsSync(MOBILE_META)) {
    throw new Error(`Mobile already recording ${JSON.parse(fs.readFileSync(MOBILE_META, 'utf8')).caseId}`);
  }
  const devices = adb(['devices']);
  if (!/device\s*$/m.test(devices.stdout.replace('List of devices attached', ''))) {
    throw new Error('No adb device connected');
  }
  // clear previous tmp
  adb(['shell', 'rm', '-f', DEVICE_TMP]);
  const limit = Math.min(Math.max(Number(timeLimitSec) || 180, 10), 180);
  // detached adb shell screenrecord
  const child = spawn('adb', ['shell', 'screenrecord', `--time-limit=${limit}`, DEVICE_TMP], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  const meta = {
    kind: 'mobile',
    caseId,
    pid: child.pid,
    deviceFile: DEVICE_TMP,
    timeLimitSec: limit,
    localFile: outPath(caseId, 'mobile'),
    startedAt: new Date().toISOString(),
  };
  // rewrite localFile after outPath created stamp once
  meta.localFile = outPath(caseId, 'mobile');
  fs.writeFileSync(MOBILE_META, JSON.stringify(meta, null, 2));
  console.log(JSON.stringify({ ok: true, action: 'mobile-start', ...meta }, null, 2));
}

function mobileStop() {
  if (!fs.existsSync(MOBILE_META)) {
    console.log(JSON.stringify({ ok: false, error: 'no active mobile recording' }));
    return;
  }
  const meta = JSON.parse(fs.readFileSync(MOBILE_META, 'utf8'));
  // SIGINT screenrecord via pkill
  adb(['shell', 'pkill', '-INT', 'screenrecord']);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
  // ensure process gone
  adb(['shell', 'pkill', '-9', 'screenrecord']);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);

  const local = meta.localFile || outPath(meta.caseId, 'mobile');
  const pull = adb(['pull', meta.deviceFile, local]);
  const exists = fs.existsSync(local);
  const size = exists ? fs.statSync(local).size : 0;
  adb(['shell', 'rm', '-f', meta.deviceFile]);
  try { fs.unlinkSync(MOBILE_META); } catch (_) {}
  console.log(JSON.stringify({
    ok: exists && size > 0,
    action: 'mobile-stop',
    ...meta,
    localFile: local,
    exists,
    size,
    pullStdout: (pull.stdout || '').trim(),
    pullStderr: (pull.stderr || '').trim(),
  }, null, 2));
}

function status() {
  const desktop = fs.existsSync(META_FILE)
    ? { recording: true, ...JSON.parse(fs.readFileSync(META_FILE, 'utf8')) }
    : { recording: false };
  const mobile = fs.existsSync(MOBILE_META)
    ? { recording: true, ...JSON.parse(fs.readFileSync(MOBILE_META, 'utf8')) }
    : { recording: false };
  console.log(JSON.stringify({ desktop, mobile }, null, 2));
}

const [cmd, caseId, maybeLimit] = process.argv.slice(2);
try {
  if (cmd === 'start') start(caseId);
  else if (cmd === 'stop') stop();
  else if (cmd === 'mobile-start') mobileStart(caseId, maybeLimit);
  else if (cmd === 'mobile-stop') mobileStop();
  else if (cmd === 'status') status();
  else {
    console.error('Usage: disagree-record.cjs start|stop|mobile-start|mobile-stop|status [CASE_ID] [timeLimitSec]');
    process.exit(1);
  }
} catch (e) {
  console.error(JSON.stringify({ ok: false, error: String(e.message || e) }));
  process.exit(1);
}
