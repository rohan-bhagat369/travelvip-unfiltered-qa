/**
 * Probe flight search with preferences.airlines = [""]
 * Run: node scripts/probe-flight-preferences-airline-empty.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  buildOneWaySearchBody,
  buildRoundTripSearchBody,
  extractFirstSearchId,
  isSearchProgressComplete,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = path.join('reports', 'flight-preferences-airline-empty-staging.json');

function ok(r) {
  return Boolean(r?.ok || (r?.status >= 200 && r?.status < 300));
}
function errCode(r) {
  return r?.data?.error?.code || r?.data?.code || null;
}
function optionCount(data) {
  let n = 0;
  for (const block of data?.results || []) {
    n += (block?.options || []).length;
  }
  return n;
}

async function pollSearch(flight, body, label, max = 8) {
  let last = null;
  for (let i = 0; i < max; i += 1) {
    last = await flight.search(body);
    const opts = optionCount(last.data);
    console.log(label, 'poll', i + 1, 'HTTP', last.status, errCode(last), 'options', opts, 'progress', last.data?.progress?.state);
    if (!ok(last) || errCode(last) === 'VALIDATION_ERROR') return last;
    if (opts > 0 || isSearchProgressComplete(last.data)) return last;
    await sleep(3000);
  }
  return last;
}

async function main() {
  console.log('Base:', config.baseUrl);
  const session = await authenticate(true);
  const flight = new FlightService(session.client);
  const cases = [];

  // OW airlines: [""]
  {
    const body = buildOneWaySearchBody(21, { origin: 'DEL', destination: 'BOM', fareType: 'NORMAL' });
    body.preferences = { airlines: [''], maxStops: null, refundableOnly: false };
    console.log('\n=== OW preferences.airlines=[""] ===');
    console.log(JSON.stringify(body.preferences));
    const res = await pollSearch(flight, body, 'OW-empty');
    const opts = optionCount(res.data);
    cases.push({
      id: 'OW1',
      title: 'ONE_WAY preferences.airlines=[""]',
      preferences: body.preferences,
      http: res.status,
      code: errCode(res),
      options: opts,
      progress: res.data?.progress,
      searchId: extractFirstSearchId(res.data),
      gettingResults: ok(res) && opts > 0,
      snippet: JSON.stringify(res.data).slice(0, 600),
    });
  }

  // OW airlines as empty string (wrong type)
  {
    const body = buildOneWaySearchBody(22, { origin: 'BOM', destination: 'DEL', fareType: 'NORMAL' });
    body.preferences = { airlines: '', maxStops: null, refundableOnly: false };
    console.log('\n=== OW preferences.airlines="" (string) ===');
    const res = await flight.search(body);
    const opts = optionCount(res.data);
    cases.push({
      id: 'OW2',
      title: 'ONE_WAY preferences.airlines="" string',
      preferences: body.preferences,
      http: res.status,
      code: errCode(res),
      options: opts,
      gettingResults: ok(res) && opts > 0,
      snippet: JSON.stringify(res.data).slice(0, 500),
    });
    console.log('HTTP', res.status, errCode(res), 'options', opts);
  }

  // Control: empty array
  {
    const body = buildOneWaySearchBody(23, { origin: 'DEL', destination: 'BOM', fareType: 'NORMAL' });
    body.preferences = { airlines: [], maxStops: null, refundableOnly: false };
    console.log('\n=== OW preferences.airlines=[] control ===');
    const res = await pollSearch(flight, body, 'OW-arr');
    const opts = optionCount(res.data);
    cases.push({
      id: 'OW3',
      title: 'ONE_WAY preferences.airlines=[] control',
      preferences: body.preferences,
      http: res.status,
      code: errCode(res),
      options: opts,
      progress: res.data?.progress,
      gettingResults: ok(res) && opts > 0,
    });
  }

  // RT airlines: [""]
  {
    const body = buildRoundTripSearchBody(20, 27, { origin: 'DEL', destination: 'BOM', fareType: 'NORMAL' });
    body.preferences = { airlines: [''], maxStops: null, refundableOnly: false };
    console.log('\n=== RT preferences.airlines=[""] ===');
    const res = await pollSearch(flight, body, 'RT-empty', 6);
    const opts = optionCount(res.data);
    cases.push({
      id: 'RT1',
      title: 'ROUND_TRIP preferences.airlines=[""]',
      preferences: body.preferences,
      http: res.status,
      code: errCode(res),
      options: opts,
      progress: res.data?.progress,
      gettingResults: ok(res) && opts > 0,
      snippet: JSON.stringify(res.data).slice(0, 600),
    });
  }

  // Also airline key singular if used
  {
    const body = buildOneWaySearchBody(24, { origin: 'DEL', destination: 'HYD', fareType: 'NORMAL' });
    body.preferences = { airline: '', maxStops: null, refundableOnly: false };
    console.log('\n=== OW preferences.airline="" (singular) ===');
    const res = await pollSearch(flight, body, 'OW-singular', 5);
    const opts = optionCount(res.data);
    cases.push({
      id: 'OW4',
      title: 'ONE_WAY preferences.airline="" singular',
      preferences: body.preferences,
      http: res.status,
      code: errCode(res),
      options: opts,
      gettingResults: ok(res) && opts > 0,
      snippet: JSON.stringify(res.data).slice(0, 500),
    });
  }

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ baseUrl: config.baseUrl, cases }, null, 2));
  console.log('\n=== SUMMARY ===');
  for (const c of cases) {
    console.log(
      `${c.id} ${c.title} => HTTP ${c.http} code=${c.code} options=${c.options} gettingResults=${c.gettingResults}`,
    );
  }
  console.log('Report:', OUT);
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exitCode = 1;
});
