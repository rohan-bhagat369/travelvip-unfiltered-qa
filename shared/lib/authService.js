import { config } from '../config/env.js';
import { TravelVipClient } from './TravelVipClient.js';
import { createRequestId } from './signature.js';

let cachedSession = null;

async function fetchPartnerToken() {
  const client = new TravelVipClient({ correlationId: process.env.CORRELATION_ID });
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

  if (!response.ok) {
    throw new Error(`Partner token failed (${response.status}): ${JSON.stringify(response.data)}`);
  }

  return response.data;
}

export async function refreshPartnerToken(refreshToken) {
  const client = new TravelVipClient({ correlationId: process.env.CORRELATION_ID });
  const response = await client.request({
    method: 'POST',
    path: '/auth/partner/refresh',
    body: { refresh_token: refreshToken },
    signed: false,
    auth: false,
    extraHeaders: { 'X-Request-Id': createRequestId() },
  });

  if (!response.ok) {
    throw new Error(`Partner refresh failed (${response.status}): ${JSON.stringify(response.data)}`);
  }

  return response.data;
}

async function fetchUserSession(accessToken) {
  const client = new TravelVipClient({ correlationId: process.env.CORRELATION_ID });
  const response = await client.request({
    method: 'POST',
    path: '/v1/auth/session',
    body: { tierId: config.tierId },
    signed: false,
    auth: false,
    partnerKey: accessToken,
    extraHeaders: { 'X-Request-Id': createRequestId() },
  });

  if (!response.ok) {
    throw new Error(`User session failed (${response.status}): ${JSON.stringify(response.data)}`);
  }

  return response.data;
}

export async function authenticate(force = false) {
  if (!force && cachedSession?.authToken) {
    return cachedSession;
  }

  const tokenResponse = await fetchPartnerToken();
  const sessionResponse = await fetchUserSession(tokenResponse.access_token);

  // X-Partner-Key must be the partner access_token from /auth/partner/token
  const client = new TravelVipClient({
    authToken: sessionResponse.auth_token,
    partnerKey: tokenResponse.access_token,
    correlationId: process.env.CORRELATION_ID,
  });

  cachedSession = {
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    authToken: sessionResponse.auth_token,
    client,
  };

  return cachedSession;
}

export function getAuthenticatedClient() {
  if (!cachedSession?.client) {
    throw new Error('Call authenticate() before using getAuthenticatedClient()');
  }
  return cachedSession.client;
}

export function clearSession() {
  cachedSession = null;
}
