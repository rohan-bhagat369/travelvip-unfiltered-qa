export function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

export function futureDate(daysFromNow = 30) {
  return formatDate(addDays(new Date(), daysFromNow));
}

export function assertOk(response, label) {
  if (!response.ok) {
    throw new Error(`${label} failed (${response.status}): ${JSON.stringify(response.data)}`);
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollUntil(fn, predicate, { maxAttempts = 20, intervalMs = 4000, label = 'operation' } = {}) {
  let lastResult;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    lastResult = await fn();
    if (predicate(lastResult)) return lastResult;
    const waitMs = lastResult?.data?.progress?.pollAfterMs || intervalMs;
    await sleep(waitMs);
  }
  throw new Error(`${label} did not complete after ${maxAttempts} attempts`);
}

export function randomSuffix() {
  return Date.now().toString().slice(-6);
}
