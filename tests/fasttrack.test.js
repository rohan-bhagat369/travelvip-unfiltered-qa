import { authenticate } from '../shared/lib/authService.js';
import { assertOk } from '../shared/lib/testUtils.js';

describe('Fast Track API', () => {
  let client;
  let airportId;

  beforeAll(async () => {
    const session = await authenticate();
    client = session.client;
  });

  test('fast track airport search returns airports', async () => {
    const response = await client.request({
      method: 'GET',
      path: '/v1/fasttracks/airports/search',
      query: {
        lang: 'en',
        currency: 'INR',
        page: 0,
        perpage: 20,
        q: 'dxb',
      },
      correlation: true,
    });

    assertOk(response, 'Fast track airport search');
    expect(response.data).toBeDefined();

    const results = response.data?.results;
    if (Array.isArray(results) && results.length > 0) {
      airportId = results[0].airportId || results[0].id;
    }
  });

  test('fast track list returns services', async () => {
    const response = await client.request({
      method: 'GET',
      path: '/v1/fasttracks',
      query: {
        lang: 'en',
        currency: 'INR',
        page: 0,
        perpage: 10,
        airportId: airportId || 3110,
        terminal: 'Terminal 2',
        terminalSide: 'Departure',
      },
      correlation: true,
    });

    assertOk(response, 'Fast track list');
    expect(response.data).toBeDefined();
  });

  test('fast track booking history returns list', async () => {
    const response = await client.request({
      method: 'GET',
      path: '/v1/airportServices/fasttrack/booking/history',
      query: {
        lang: 'en',
        currency: 'INR',
        page: 0,
        perpage: 10,
      },
    });

    assertOk(response, 'Fast track booking history');
    expect(response.data).toBeDefined();
  });
});
