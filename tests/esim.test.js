import { authenticate } from '../shared/lib/authService.js';
import { assertOk } from '../shared/lib/testUtils.js';

describe('eSIM API', () => {
  let client;
  let esimCountryId;

  beforeAll(async () => {
    const session = await authenticate();
    client = session.client;
  });

  test('esim search returns countries', async () => {
    const response = await client.request({
      method: 'GET',
      path: '/v1/esim/search',
      query: {
        lang: 'en',
        currency: 'INR',
        page: 1,
        perpage: 20,
        q: 'united states',
      },
      correlation: true,
    });

    assertOk(response, 'eSIM search');
    expect(response.data).toBeDefined();

    const results = response.data?.results || response.data?.data;
    if (Array.isArray(results) && results.length > 0) {
      esimCountryId = results[0].id || results[0].countryId || results[0].code;
    }
  });

  test('esim listing returns plans for country', async () => {
    const countryId = esimCountryId || 'at1k0ke8lq1o0w';
    const response = await client.request({
      method: 'GET',
      path: `/v1/esims/${countryId}`,
      query: {
        lang: 'en',
        currency: 'INR',
      },
      correlation: true,
    });

    assertOk(response, 'eSIM listing');
    expect(response.data).toBeDefined();
  });

  test('esim booking history returns list', async () => {
    const response = await client.request({
      method: 'GET',
      path: '/v1/esim/booking/history',
      query: {
        lang: 'en',
        currency: 'INR',
        page: 0,
        perpage: 10,
      },
    });

    assertOk(response, 'eSIM booking history');
    expect(response.data).toBeDefined();
  });
});
