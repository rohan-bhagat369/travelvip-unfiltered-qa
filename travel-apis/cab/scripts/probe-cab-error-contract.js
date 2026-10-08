/**
 * CLI: run Cab Error Contract validations (catalog + full PDF matrix saved alongside).
 *
 *   npm run cab:regression:validate
 *   npm run cab:regression:validate:staging
 *   npm run cab:regression:validate:canary
 *   node scripts/probe-cab-error-contract.js --tags VALIDATE,FILTERS
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { runCabErrorContract } from '../src/regression/runErrorContract.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ENVS = {
  staging: 'https://api-staging.travelvip.ai',
  canary: 'https://canary-api.travelvip.ai',
};

function argValue(argv, name) {
  const i = argv.indexOf(name);
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  return null;
}

const argv = process.argv.slice(2);
const envName = (argValue(argv, '--env') || '').toLowerCase();
if (ENVS[envName]) {
  process.env.BASE_URL = ENVS[envName];
}

const tagsRaw = argValue(argv, '--tags');
const tags = tagsRaw
  ? tagsRaw.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean)
  : ['VALIDATE', 'FILTERS', 'LIVE'];

const outArg = argValue(argv, '--out');
const slug = envName || ((process.env.BASE_URL || '').includes('canary') ? 'canary' : 'staging');
const outPath = outArg || path.join(__dirname, '..', 'reports', `cab-error-contract-${slug}.json`);

const { counts } = await runCabErrorContract({ tags, outPath });
process.exit((counts.BUG || 0) > 0 ? 1 : 0);
