import crypto from 'crypto';

export function createSignature(body, timestamp, signingKey) {
  const payload = `${body || ''}${timestamp}`;
  return crypto.createHmac('sha256', signingKey).update(payload).digest('hex');
}

export function createTimestamp() {
  return Math.floor(Date.now() / 1000).toString();
}

export function createRequestId() {
  return `req-${Date.now()}`;
}
