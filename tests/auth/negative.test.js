import { config } from '../../shared/config/env.js';
import {
  requestPartnerRefresh,
  requestPartnerToken,
  requestTiers,
  requestUserSession,
} from '../../shared/lib/authApi.js';
import { expectApiError, expectSecurityEnforced, expectValidationEnforced } from '../../shared/lib/validators.js';

describe('Auth API - Negative Validation', () => {
  test('partner token rejects invalid partner_id', async () => {
    const response = await requestPartnerToken({
      partner_id: 'invalid_partner_id',
      partner_secret: config.partnerSecret,
    });
    expectApiError(response);
  });

  test('partner token rejects invalid partner_secret', async () => {
    const response = await requestPartnerToken({
      partner_id: config.partnerId,
      partner_secret: 'invalid_secret_value',
    });
    expectApiError(response);
  });

  test('partner token rejects empty body', async () => {
    const response = await requestPartnerToken({});
    expectApiError(response);
  });

  test('partner token rejects missing partner_secret', async () => {
    const response = await requestPartnerToken({ partner_id: config.partnerId });
    expectApiError(response);
  });

  test('partner refresh rejects invalid refresh_token', async () => {
    const response = await requestPartnerRefresh('gmr_rt_invalid_token_000');
    expectApiError(response);
  });

  test('partner refresh rejects empty refresh_token', async () => {
    const response = await requestPartnerRefresh('');
    expectApiError(response);
  });

  test('user session rejects missing X-Partner-Key', async () => {
    const response = await requestUserSession(undefined, { tierId: config.tierId });
    expectApiError(response);
  });

  test('user session rejects invalid partner access token', async () => {
    const response = await requestUserSession('gmr_at_invalid_access_token', { tierId: config.tierId });
    expectApiError(response);
  });

  test('user session rejects invalid tierId type', async () => {
    const tokenRes = await requestPartnerToken({
      partner_id: config.partnerId,
      partner_secret: config.partnerSecret,
    });
    if (!tokenRes.ok) return;

    const response = await requestUserSession(tokenRes.data.access_token, { tierId: 'not-a-number' });
    expectValidationEnforced(response, 'AUTH-NEG-009');
  });

  test('user session rejects nonexistent tierId', async () => {
    const tokenRes = await requestPartnerToken({
      partner_id: config.partnerId,
      partner_secret: config.partnerSecret,
    });
    if (!tokenRes.ok) return;

    const response = await requestUserSession(tokenRes.data.access_token, { tierId: 999999999 });
    expectValidationEnforced(response, 'AUTH-NEG-010');
  });

  test('tiers rejects invalid partner access token', async () => {
    const response = await requestTiers('gmr_at_invalid_access_token');
    expectApiError(response);
  });

  test('tiers rejects missing X-Partner-Key', async () => {
    const response = await requestTiers(undefined);
    expectApiError(response);
  });
});
