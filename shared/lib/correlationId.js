import crypto from 'crypto';

export function generateCorrelationId() {
  return crypto.randomUUID();
}
