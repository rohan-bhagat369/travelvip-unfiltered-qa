import { authenticate } from '../shared/lib/authService.js';
import { assertOk } from '../shared/lib/testUtils.js';

describe('Lounge API', () => {
  let client;
  let airportId;

  beforeAll(async () => {
    const session = await authenticate();
    client = session.client;
  });

  test('airport search returns airports', async () => {
    const response = await client.request({
      method: 'GET',
      path: '/v1/airports/search',
      query: {
        lang: 'en',
        currency: 'INR',
        page: 0,
        perpage: 20,
        q: 'bom',
      },
      correlation: true,
    });

    assertOk(response, 'Lounge airport search');
    expect(response.data).toBeDefined();

    const results = response.data?.results;
    if (Array.isArray(results) && results.length > 0) {
      airportId = results[0].airportId;
    }
  });

  test('lounge list returns lounges for airport', async () => {
    const response = await client.request({
      method: 'GET',
      path: '/v1/lounges',
      query: {
        lang: 'en',
        currency: 'INR',
        page: 0,
        perpage: 2,
        airportId: airportId || 12,
        terminal: 'Terminal 1',
      },
      correlation: true,
    });

    assertOk(response, 'Lounge list');
    expect(response.data).toBeDefined();
  });

  test('lounge booking history returns list', async () => {
    const response = await client.request({
      method: 'GET',
      path: '/v1/airportServices/lounge/booking/history',
      query: {
        lang: 'en',
        currency: 'INR',
        page: 0,
        perpage: 10,
      },
    });

    assertOk(response, 'Lounge booking history');
    expect(response.data).toBeDefined();
  });
});
