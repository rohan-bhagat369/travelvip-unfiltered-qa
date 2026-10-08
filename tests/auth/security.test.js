import { config } from '../../shared/config/env.js';
import { obtainValidPartnerTokens, requestUserSession } from '../../shared/lib/authApi.js';
import { TravelVipClient } from '../../shared/lib/TravelVipClient.js';
import { createSignature, createTimestamp } from '../../shared/lib/signature.js';
import { buildSearchBody, HOTEL_QUERY } from '../../travel-apis/hotel/src/helpers.js';
import { expectApiError, expectSecurityEnforced } from '../../shared/lib/validators.js';

async function getValidSession() {
  const tokenRes = await obtainValidPartnerTokens();
  const sessionRes = await requestUserSession(tokenRes.data.access_token, { tierId: config.tierId });
  return sessionRes.data.auth_token;
}

describe('Auth API - Security Tests', () => {
  test('hotel search rejects missing Authorization header', async () => {
    const client = new TravelVipClient();
    const body = buildSearchBody();
    const response = await client.request({
      method: 'POST',
      path: '/v1/hotels/search',
      query: { ...HOTEL_QUERY, page: 0, perpage: 5 },
      body,
      signed: true,
      auth: false,
      correlation: true,
    });
    expectApiError(response);
  });

  test('hotel search rejects tampered auth token', async () => {
    const authToken = await getValidSession();
    const tampered = `${authToken.slice(0, -1)}X`;
    const client = new TravelVipClient({ authToken: tampered });
    const response = await client.request({
      method: 'POST',
      path: '/v1/hotels/search',
      query: { ...HOTEL_QUERY, page: 0, perpage: 5 },
      body: buildSearchBody(),
      signed: true,
      auth: true,
      correlation: true,
    });
    expectApiError(response);
  });

  test('hotel search rejects partner access token used as Bearer', async () => {
    const tokenRes = await obtainValidPartnerTokens();
    const client = new TravelVipClient({ authToken: tokenRes.data.access_token });
    const response = await client.request({
      method: 'POST',
      path: '/v1/hotels/search',
      query: { ...HOTEL_QUERY, page: 0, perpage: 5 },
      body: buildSearchBody(),
      signed: true,
      auth: true,
      correlation: true,
    });
    expectApiError(response);
  });

  test('hotel search rejects invalid X-Signature', async () => {
    const authToken = await getValidSession();
    const client = new TravelVipClient({ authToken });
    const body = buildSearchBody();
    const bodyString = JSON.stringify(body);
    const timestamp = createTimestamp();
    const badSignature = 'deadbeef'.repeat(8);
    const response = await client.request({
      method: 'POST',
      path: '/v1/hotels/search',
      query: { ...HOTEL_QUERY, page: 0, perpage: 5 },
      body,
      signed: false,
      auth: true,
      correlation: true,
      extraHeaders: {
        'X-Timestamp': timestamp,
        'X-Signature': badSignature,
      },
    });
    expect(createSignature(bodyString, timestamp, config.signingKey)).not.toBe(badSignature);
    expectSecurityEnforced(response, 'AUTH-SEC-004');
  });

  test('hotel search rejects expired timestamp signature', async () => {
    const authToken = await getValidSession();
    const client = new TravelVipClient({ authToken });
    const body = buildSearchBody();
    const bodyString = JSON.stringify(body);
    const oldTimestamp = String(Math.floor(Date.now() / 1000) - 3600);
    const response = await client.request({
      method: 'POST',
      path: '/v1/hotels/search',
      query: { ...HOTEL_QUERY, page: 0, perpage: 5 },
      body,
      signed: false,
      auth: true,
      correlation: true,
      extraHeaders: {
        'X-Timestamp': oldTimestamp,
        'X-Signature': createSignature(bodyString, oldTimestamp, config.signingKey),
      },
    });
    expectSecurityEnforced(response, 'AUTH-SEC-005');
  });

  test('user session rejects partner secret in X-Partner-Key header', async () => {
    const response = await requestUserSession(config.partnerSecret, { tierId: config.tierId });
    expectApiError(response);
  });

  test('partner token does not expose signing key in response', async () => {
    const response = await obtainValidPartnerTokens();
    const serialized = JSON.stringify(response.data);
    expect(serialized).not.toContain(config.signingKey);
    expect(serialized).not.toContain(config.partnerSecret);
  });
});
