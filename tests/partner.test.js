import { authenticate } from '../shared/lib/authService.js';
import { TravelVipClient } from '../shared/lib/TravelVipClient.js';
import { config } from '../shared/config/env.js';
import { createRequestId } from '../shared/lib/signature.js';
import { assertOk } from '../shared/lib/testUtils.js';

describe('Partner API', () => {
  test('partner token returns access and refresh tokens', async () => {
    const client = new TravelVipClient();
    const response = await client.request({
      method: 'POST',
      path: '/auth/partner/token',
      body: {
        partner_id: config.partnerId,
        partner_secret: config.partnerSecret,
      },
      signed: false,
      auth: false,
      extraHeaders: { 'X-Request-Id': createRequestId() },
    });

    assertOk(response, 'Partner token');
    expect(response.data.access_token).toBeTruthy();
    expect(response.data.refresh_token).toBeTruthy();
    expect(response.data.expires_in).toBeGreaterThan(0);
  });

  test('user session returns auth token for tier', async () => {
    const session = await authenticate(true);
    expect(session.authToken).toBeTruthy();
    expect(session.accessToken).toBeTruthy();
  });

  test('tiers list returns available tiers', async () => {
    const session = await authenticate();
    const response = await session.client.request({
      method: 'GET',
      path: '/v1/tiers',
      query: { lang: 'en', currency: 'INR' },
      signed: false,
      auth: false,
      partnerKey: session.accessToken,
      extraHeaders: { 'X-Request-Id': createRequestId() },
    });

    assertOk(response, 'Tiers list');
    expect(Array.isArray(response.data)).toBe(true);
    expect(response.data.length).toBeGreaterThan(0);
  });
});
