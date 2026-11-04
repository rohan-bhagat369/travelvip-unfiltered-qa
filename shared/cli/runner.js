import { authenticate, clearSession } from '../lib/authService.js';
import { config } from '../config/env.js';
import { FlightService } from '../../travel-apis/flight/src/service.js';
import { bookFlight } from '../../travel-apis/flight/src/bookEngine.js';
import { printBookingStatus, runCancelFlow } from '../../travel-apis/flight/src/cancelEngine.js';
import {
  loadScenario,
  mergeBookOptions,
  parseCli,
  printHelp,
} from './args.js';

function applyEnvOverrides(overrides = {}) {
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined && value !== null) process.env[key] = String(value);
  }
}

function activeBaseUrl() {
  return process.env.BASE_URL || config.baseUrl;
}

async function withFlightSession(fn) {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('Environment:', activeBaseUrl());

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const flight = new FlightService(session.client);
  return fn(flight, session.client);
}

async function cmdFlightBook(flags, scenarioRaw = null) {
  const opts = mergeBookOptions({ flags }, scenarioRaw);
  const result = await withFlightSession((flight, client) => bookFlight(flight, client, opts));
  if (!result.ok) process.exit(1);
}

async function cmdFlightRun(flags) {
  if (!flags.scenario) {
    console.error('--scenario is required for flight run');
    process.exit(1);
  }
  const scenario = loadScenario(flags.scenario);
  applyEnvOverrides(scenario.env);
  const opts = mergeBookOptions({ flags }, scenario);
  const result = await withFlightSession((flight, client) => bookFlight(flight, client, opts));
  if (!result.ok) process.exit(1);
}

async function cmdFlightStatus(flags, positional) {
  const br = flags.br || positional[0];
  if (!br) {
    console.error('--br is required');
    process.exit(1);
  }
  await withFlightSession((flight) => printBookingStatus(flight, br));
}

async function cmdFlightCancel(flags, positional) {
  const br = flags.br || positional[0];
  const after = flags.after?.length
    ? flags.after
    : (flags.action === 'CANCEL' ? ['penalty', 'cancel'] : ['penalty']);

  await withFlightSession((flight, client) => runCancelFlow(flight, client, {
    br,
    action: flags.action || 'PENALTY',
    after,
  }));
}

async function main() {
  const cli = parseCli();

  if (cli.flags.help || !cli.domain || cli.domain === 'help') {
    printHelp();
    return;
  }

  applyEnvOverrides(cli.envOverrides);

  if (cli.domain === 'flight') {
    switch (cli.command) {
      case 'book':
        await cmdFlightBook(cli.flags);
        break;
      case 'run':
        await cmdFlightRun(cli.flags);
        break;
      case 'status':
      case 'check':
        await cmdFlightStatus(cli.flags, cli.positional);
        break;
      case 'cancel':
        await cmdFlightCancel(cli.flags, cli.positional);
        break;
      default:
        console.error(`Unknown flight command: ${cli.command || '(none)'}`);
        printHelp();
        process.exit(1);
    }
    return;
  }

  console.error(`Unknown domain: ${cli.domain}`);
  printHelp();
  process.exit(1);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
