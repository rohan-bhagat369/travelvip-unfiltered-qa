import { config } from '../config/env.js';
import { TravelVipClient } from './TravelVipClient.js';
import { createRequestId } from './signature.js';

function baseHeaders(extra = {}) {
  return { 'X-Request-Id': createRequestId(), ...extra };
}

export async function requestPartnerToken(body, options = {}) {
  const client = new TravelVipClient();
  return client.request({
    method: 'POST',
    path: '/auth/partner/token',
    body,
    signed: false,
    auth: false,
    extraHeaders: options.extraHeaders ?? baseHeaders(),
  });
}

export async function requestPartnerRefresh(refreshToken, options = {}) {
  const client = new TravelVipClient();
  return client.request({
    method: 'POST',
    path: '/auth/partner/refresh',
    body: { refresh_token: refreshToken },
    signed: false,
    auth: false,
    extraHeaders: options.extraHeaders ?? baseHeaders(),
  });
}

export async function requestUserSession(accessToken, body = { tierId: config.tierId }, options = {}) {
  const client = new TravelVipClient();
  return client.request({
    method: 'POST',
    path: '/v1/auth/session',
    body,
    signed: false,
    auth: false,
    partnerKey: accessToken,
    extraHeaders: options.extraHeaders ?? baseHeaders(),
  });
}

export async function requestTiers(accessToken, options = {}) {
  const client = new TravelVipClient();
  return client.request({
    method: 'GET',
    path: '/v1/tiers',
    query: { lang: 'en', currency: 'INR' },
    signed: false,
    auth: false,
    partnerKey: accessToken,
    extraHeaders: options.extraHeaders ?? baseHeaders(),
  });
}

export async function obtainValidPartnerTokens() {
  const response = await requestPartnerToken({
    partner_id: config.partnerId,
    partner_secret: config.partnerSecret,
  });
  return response;
}
