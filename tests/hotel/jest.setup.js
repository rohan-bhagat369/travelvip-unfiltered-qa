import fs from 'fs';
import path from 'path';
import { hotelReporter } from '../../travel-apis/hotel/src/reporter.js';
import { TravelVipClient } from '../../shared/lib/TravelVipClient.js';

const SESSION_FILE = path.resolve('reports/hotel/.session.json');

function loadSession() {
  if (!fs.existsSync(SESSION_FILE)) return;
  const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  const seen = new Set(hotelReporter.testCases.map((t) => `${t.name}|${t.startedAt}`));
  for (const tc of data.testCases || []) {
    const key = `${tc.name}|${tc.startedAt}`;
    if (!seen.has(key)) {
      hotelReporter.testCases.push(tc);
      seen.add(key);
    }
  }
  if (data.startedAt && !hotelReporter.startedAt) {
    hotelReporter.startedAt = data.startedAt;
  }
}

function persistSession() {
  fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  fs.writeFileSync(SESSION_FILE, JSON.stringify(hotelReporter.toJSON(), null, 2));
}

TravelVipClient.setApiLogHook((entry) => hotelReporter.logApi(entry));

beforeAll(() => {
  loadSession();
});

beforeEach(() => {
  hotelReporter.startTest(expect.getState().currentTestName);
});

afterEach(() => {
  const state = expect.getState();
  hotelReporter.endTest(state.testFailed ? 'FAILED' : 'PASSED', state.testError);
  persistSession();
});
