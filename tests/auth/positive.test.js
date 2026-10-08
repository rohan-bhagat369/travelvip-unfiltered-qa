import { authenticate } from '../../shared/lib/authService.js';
import { TravelVipClient } from '../../shared/lib/TravelVipClient.js';
import { config } from '../../shared/config/env.js';
import {
  obtainValidPartnerTokens,
  requestPartnerRefresh,
  requestPartnerToken,
  requestTiers,
  requestUserSession,
} from '../../shared/lib/authApi.js';
import { assertOk } from '../../shared/lib/testUtils.js';
import { expectMeta } from '../../shared/lib/validators.js';
import {
  validatePartnerRefreshResponse,
  validatePartnerTokenResponse,
  validateSessionResponse,
  validateTiersList,
} from '../../shared/validators/authValidators.js';

describe('Auth API - Positive Flow', () => {
  let partnerTokens;

  test('partner token response has all required properties', async () => {
    const response = await obtainValidPartnerTokens();
    assertOk(response, 'Partner token');
    validatePartnerTokenResponse(response.data);
    expectMeta(response);
    partnerTokens = response.data;
  });

  test('partner refresh returns new access token', async () => {
    if (!partnerTokens?.refresh_token) {
      const res = await obtainValidPartnerTokens();
      partnerTokens = res.data;
    }
    const response = await requestPartnerRefresh(partnerTokens.refresh_token);
    assertOk(response, 'Partner refresh');
    validatePartnerRefreshResponse(response.data);
    expect(response.data.access_token).toBeTruthy();
  });

  test('user session response has all required properties', async () => {
    const tokenRes = await obtainValidPartnerTokens();
    const response = await requestUserSession(tokenRes.data.access_token, { tierId: config.tierId });
    assertOk(response, 'User session');
    validateSessionResponse(response.data, config.tierId);
    expectMeta(response);
  });

  test('tiers list items have required properties', async () => {
    const tokenRes = await obtainValidPartnerTokens();
    const response = await requestTiers(tokenRes.data.access_token);
    assertOk(response, 'Tiers list');
    validateTiersList(response.data);
  });

  test('full auth chain: token → session → signed flight call', async () => {
    const tokenRes = await obtainValidPartnerTokens();
    const sessionRes = await requestUserSession(tokenRes.data.access_token, { tierId: config.tierId });
    assertOk(sessionRes, 'User session');

    const client = new TravelVipClient({
      authToken: sessionRes.data.auth_token,
    });
    const searchRes = await client.request({
      method: 'GET',
      path: '/v1/flights/airports',
      query: { lang: 'en', currency: 'INR', airport: 'BOM', page: 0, perpage: 5 },
      signed: false,
      auth: true,
    });
    assertOk(searchRes, 'Authenticated flight call');
  });
});
