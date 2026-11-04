export function expectDefined(value) {
  expect(value).toBeDefined();
  expect(value).not.toBeNull();
}

export function expectString(value, { minLength = 1 } = {}) {
  expectDefined(value);
  expect(typeof value).toBe('string');
  expect(value.length).toBeGreaterThanOrEqual(minLength);
}

export function expectNumber(value, { min } = {}) {
  expectDefined(value);
  expect(typeof value).toBe('number');
  if (min !== undefined) expect(value).toBeGreaterThanOrEqual(min);
}

export function expectBoolean(value) {
  expectDefined(value);
  expect(typeof value).toBe('boolean');
}

export function expectArray(value, { minLength = 0 } = {}) {
  expectDefined(value);
  expect(Array.isArray(value)).toBe(true);
  expect(value.length).toBeGreaterThanOrEqual(minLength);
}

export function expectOneOf(value, allowed) {
  expectDefined(value);
  expect(allowed).toContain(value);
}

export function expectJwt(token) {
  expectString(token, { minLength: 20 });
  expect(token.split('.').length).toBe(3);
}

export function expectApiError(response, { statusMin = 400, code } = {}) {
  expect(response.ok).toBe(false);
  expect(response.status).toBeGreaterThanOrEqual(statusMin);
  const error = response.data?.error;
  if (error) {
    if (error.code) expectString(error.code);
    if (error.message) expectString(error.message);
    if (code) expect(error.code).toBe(code);
  }
}

export function expectSecurityEnforced(response, findingId) {
  if (response.ok) {
    throw new Error(`SECURITY GAP [${findingId}]: API accepted request that should be rejected (HTTP ${response.status})`);
  }
  expect(response.ok).toBe(false);
}

export function expectValidationEnforced(response, findingId) {
  if (response.ok) {
    throw new Error(`VALIDATION GAP [${findingId}]: API accepted invalid input (HTTP ${response.status})`);
  }
  expect(response.ok).toBe(false);
}
