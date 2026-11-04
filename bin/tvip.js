#!/usr/bin/env node
/**
 * TravelVIP CLI — dynamic flight/hotel API automation from terminal.
 */
const argv = process.argv.slice(2);

for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  const inline = a.match(/^(--base-url)=(.+)$/);
  if (inline) process.env.BASE_URL = inline[2];
  else if (a === '--base-url' && argv[i + 1]) process.env.BASE_URL = argv[i + 1];
  else if (a === '--pid' && argv[i + 1]) process.env.FLIGHT_ISSUE_PID = argv[i + 1];
}

if (!argv.length || argv[0] === 'help' || argv.includes('--help') || argv.includes('-h')) {
  const { printHelp } = await import('../shared/cli/args.js');
  printHelp();
  process.exit(0);
}

await import('../shared/cli/runner.js');
