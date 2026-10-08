import { config } from '../config/env.js';
import { createRequestId, createSignature, createTimestamp } from './signature.js';
import { generateCorrelationId } from './correlationId.js';
import { createApiLogEntry } from '../../travel-apis/flight/src/reporter.js';

let apiLogHook = null;

export class TravelVipClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || config.baseUrl;
    this.signingKey = options.signingKey || config.signingKey;
    this.authToken = options.authToken || null;
    this.partnerKey = options.partnerKey || null;
    this.correlationId = options.correlationId
      || process.env.CORRELATION_ID
      || generateCorrelationId();
  }

  static setApiLogHook(hook) {
    apiLogHook = hook;
  }

  setAuthToken(token) {
    this.authToken = token;
  }

  setPartnerKey(partnerKey) {
    this.partnerKey = partnerKey;
  }

  setCorrelationId(id) {
    this.correlationId = id;
  }

  updateCorrelationFromResponse(data) {
    // Keep the session correlation ID we send. Do not replace it from the response.
    if (!this.correlationId && data?._meta?.correlation_id) {
      this.correlationId = data._meta.correlation_id;
    }
  }

  buildUrl(path, query = {}) {
    const url = new URL(path.startsWith('http') ? path : `${this.baseUrl}${path}`);
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    });
    return url;
  }

  async request({
    method = 'GET',
    path,
    query,
    body,
    rawBody,
    signed = true,
    auth = true,
    correlation = true,
    partnerKey = null,
    omitPartnerKey = false,
    extraHeaders = {},
  }) {
    const bodyString = rawBody !== undefined
      ? String(rawBody)
      : (body === undefined ? '' : JSON.stringify(body));
    const timestamp = createTimestamp();
    const requestId = createRequestId();

    const headers = {
      'Content-Type': 'application/json',
      'X-Request-Id': requestId,
      ...extraHeaders,
    };

    if (signed) {
      headers['X-Timestamp'] = timestamp;
      headers['X-Signature'] = createSignature(bodyString, timestamp, this.signingKey);
    }

    if (auth && this.authToken) {
      headers.Authorization = `Bearer ${this.authToken}`;
    }

    // Prefer explicit arg; else client default (from /auth/partner/token access_token)
    const resolvedPartnerKey = omitPartnerKey ? null : (partnerKey || this.partnerKey);
    if (resolvedPartnerKey) {
      headers['X-Partner-Key'] = resolvedPartnerKey;
    }

    if (correlation && this.correlationId) {
      headers['X-Correlation-ID'] = this.correlationId;
    }

    const url = this.buildUrl(path, query);
    const response = await fetch(url, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : bodyString,
    });

    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    this.updateCorrelationFromResponse(data);

    const result = {
      status: response.status,
      ok: response.ok,
      data,
      headers: response.headers,
      sentCorrelationId: headers['X-Correlation-ID'] || null,
    };

    if (apiLogHook) {
      apiLogHook(createApiLogEntry({
        method,
        path,
        query,
        body: body === undefined ? undefined : body,
        headers,
        status: result.status,
        ok: result.ok,
        data: result.data,
        url: url.toString(),
      }));
    }

    return result;
  }
}
