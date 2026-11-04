import fs from 'fs';
import path from 'path';
import { flightReporter } from '../../travel-apis/flight/src/reporter.js';
import { TravelVipClient } from '../../shared/lib/TravelVipClient.js';

const SESSION_FILE = path.resolve('reports/flight/.session.json');

function loadSession() {
  if (!fs.existsSync(SESSION_FILE)) return;
  const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  const seen = new Set(flightReporter.testCases.map((t) => `${t.name}|${t.startedAt}`));
  for (const tc of data.testCases || []) {
    const key = `${tc.name}|${tc.startedAt}`;
    if (!seen.has(key)) {
      flightReporter.testCases.push(tc);
      seen.add(key);
    }
  }
  if (data.startedAt && !flightReporter.startedAt) {
    flightReporter.startedAt = data.startedAt;
  }
}

function persistSession() {
  fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  fs.writeFileSync(SESSION_FILE, JSON.stringify(flightReporter.toJSON(), null, 2));
}

TravelVipClient.setApiLogHook((entry) => flightReporter.logApi(entry));

beforeAll(() => {
  loadSession();
});

beforeEach(() => {
  flightReporter.startTest(expect.getState().currentTestName);
});

afterEach(() => {
  const state = expect.getState();
  flightReporter.endTest(state.testFailed ? 'FAILED' : 'PASSED', state.testError);
  persistSession();
});
