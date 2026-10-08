/**
 * Backward-compatible entry — delegates to the saved Error Contract pack.
 * Prefer: npm run cab:regression:validate:canary
 */
process.argv.push('--env', 'canary');
await import('./probe-cab-error-contract.js');
