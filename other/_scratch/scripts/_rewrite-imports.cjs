/**
 * Rewrite imports + spawn script paths after domain migration.
 * node other/_scratch/scripts/_rewrite-imports.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(js|cjs|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

function relTo(fromFile, targetAbs) {
  let r = path.relative(path.dirname(fromFile), targetAbs).replace(/\\/g, '/');
  if (!r.startsWith('.')) r = './' + r;
  return r;
}

const SHARED = {
  lib: path.join(ROOT, 'shared/lib'),
  config: path.join(ROOT, 'shared/config'),
  validators: path.join(ROOT, 'shared/validators'),
  cli: path.join(ROOT, 'shared/cli'),
  services: path.join(ROOT, 'shared/services'),
};

const PRODUCTS = {
  hotel: path.join(ROOT, 'travel-apis/hotel/src'),
  flight: path.join(ROOT, 'travel-apis/flight/src'),
  cab: path.join(ROOT, 'travel-apis/cab/src'),
  lounge: path.join(ROOT, 'inventory/lounge/src'),
  fasttrack: path.join(ROOT, 'inventory/fasttrack/src'),
};

const SCRIPT_ROOTS = {
  hotel: 'travel-apis/hotel/scripts',
  flight: 'travel-apis/flight/scripts',
  cab: 'travel-apis/cab/scripts',
  lounge: 'inventory/lounge/scripts',
  fasttrack: 'inventory/fasttrack/scripts',
  attractions: 'inventory/attractions/scripts',
  byufuel: 'byufuel/scripts',
  esim: 'other/esim/scripts',
  entertainer: 'other/entertainer/scripts',
  zenith: 'other/zenith/scripts',
  tracker: 'other/tracker/scripts',
  auth: 'travel-apis/flight/scripts', // probe-auth often with flight
};

function mapSpawnScript(scriptRel) {
  const base = scriptRel.replace(/^scripts\//, '');
  if (/hotel/i.test(base)) return `travel-apis/hotel/scripts/${base}`;
  if (/cab/i.test(base)) return `travel-apis/cab/scripts/${base}`;
  if (/lounge/i.test(base)) return `inventory/lounge/scripts/${base}`;
  if (/fasttrack/i.test(base)) return `inventory/fasttrack/scripts/${base}`;
  if (/globaltix|attraction/i.test(base)) return `inventory/attractions/scripts/${base}`;
  if (/byufuel/i.test(base)) return `byufuel/scripts/${base}`;
  if (/esim/i.test(base)) return `other/esim/scripts/${base}`;
  if (/entertainer/i.test(base)) return `other/entertainer/scripts/${base}`;
  if (/zenith/i.test(base)) return `other/zenith/scripts/${base}`;
  if (/tracker/i.test(base)) return `other/tracker/scripts/${base}`;
  // flight / auth / book / generic probes
  if (fs.existsSync(path.join(ROOT, 'travel-apis/flight/scripts', base))) {
    return `travel-apis/flight/scripts/${base}`;
  }
  if (fs.existsSync(path.join(ROOT, 'travel-apis/flight/scripts/_unsorted', base))) {
    return `travel-apis/flight/scripts/_unsorted/${base}`;
  }
  return `travel-apis/flight/scripts/${base}`;
}

function rewriteContent(file, text) {
  let next = text;
  const fromDir = path.dirname(file);

  // ../src/lib|config|hotel|flight|...
  next = next.replace(
    /((?:from|import|require\()\s*['"])(\.\.\/)+src\/(lib|config|validators|cli|services|hotel|flight|cab|lounge|fasttrack)(\/[^'"]*)(['"])/g,
    (m, pre, _dots, pkg, rest, post) => {
      let target;
      if (SHARED[pkg]) target = path.join(SHARED[pkg], rest.replace(/^\//, ''));
      else if (PRODUCTS[pkg]) target = path.join(PRODUCTS[pkg], rest.replace(/^\//, ''));
      else return m;
      // rest includes leading path after pkg — join carefully
      const sub = rest.startsWith('/') ? rest.slice(1) : rest;
      if (SHARED[pkg]) target = path.join(SHARED[pkg], sub);
      else target = path.join(PRODUCTS[pkg], sub);
      return pre + relTo(file, target) + post;
    },
  );

  // Bare ../lib/ ../config/ etc. (old src/hotel → src/lib style)
  // Only rewrite if resolved path would escape product into old shared locations.
  // Match from '.../lib/file' where path is only ../ repeats + lib|config|validators|cli|services
  next = next.replace(
    /((?:from|import|require\()\s*['"])((?:\.\.\/)+(?:lib|config|validators|cli|services))(\/[^'"]*)(['"])/g,
    (m, pre, modPath, rest, post) => {
      const pkg = modPath.split('/').filter(Boolean).pop();
      if (!SHARED[pkg]) return m;
      const sub = rest.startsWith('/') ? rest.slice(1) : rest;
      const target = path.join(SHARED[pkg], sub);
      // Avoid rewriting if this looks like a local lib folder inside product (none exist)
      return pre + relTo(file, target) + post;
    },
  );

  // spawnNode('travel-apis/flight/scripts/...')
  next = next.replace(
    /(spawnNode\(\s*['"])scripts\/([^'"]+)(['"])/g,
    (m, pre, script, post) => pre + mapSpawnScript(`scripts/${script}`) + post,
  );

  // path.join(root, 'scripts/...') or 'scripts/probe
  next = next.replace(
    /(['"])scripts\/(probe-[^'"]+|hotel-[^'"]+|flight-[^'"]+|book-[^'"]+|b2b-[^'"]+|render-[^'"]+|generate-[^'"]+|export-[^'"]+|check-[^'"]+)(['"])/g,
    (m, q1, script, q2) => {
      if (m.includes('travel-apis/') || m.includes('inventory/') || m.includes('byufuel/') || m.includes('other/')) {
        return m;
      }
      return q1 + mapSpawnScript(`scripts/${script}`) + q2;
    },
  );

  return next;
}

const files = walk(ROOT).filter((f) => {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  return (
    rel.startsWith('travel-apis/') ||
    rel.startsWith('inventory/') ||
    rel.startsWith('byufuel/') ||
    rel.startsWith('other/') ||
    rel.startsWith('shared/') ||
    rel.startsWith('mcp/') ||
    rel.startsWith('tests/') ||
    rel.startsWith('bin/')
  );
});

let changed = 0;
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const next = rewriteContent(file, text);
  if (next !== text) {
    fs.writeFileSync(file, next);
    changed += 1;
  }
}

console.log(`Rewrote ${changed} / ${files.length} files`);
