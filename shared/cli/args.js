import fs from 'fs';
import path from 'path';

function splitList(value) {
  if (!value) return [];
  return String(value)
    .split(/[,|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseBool(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const v = String(value).toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(v)) return true;
  if (['0', 'false', 'no', 'n'].includes(v)) return false;
  return defaultValue;
}

function nextValue(args, index, inlineValue) {
  if (inlineValue !== undefined) return { value: inlineValue, nextIndex: index };
  const value = args[index + 1];
  if (value === undefined || value.startsWith('-')) {
    throw new Error(`Missing value for ${args[index]}`);
  }
  return { value, nextIndex: index + 1 };
}

function normalizeScenario(raw = {}) {
  const search = raw.search || raw;
  const book = raw.book || {};
  const env = raw.env || {};
  return {
    name: raw.name || null,
    env,
    search: {
      journey: search.journey || search.trip || 'OW',
      origin: search.origin || search.o,
      destination: search.destination || search.dest || search.d,
      adults: Number(search.adults ?? search.adt ?? 1),
      children: Number(search.children ?? search.chd ?? 0),
      infants: Number(search.infants ?? search.inf ?? 0),
      airlines: search.airlines || (search.airline ? [search.airline] : []),
      fareType: search.fareType || search.fare || 'NORMAL',
      direct: parseBool(search.direct, false),
      connecting: parseBool(search.connecting, false),
      flexi: parseBool(search.flexi, false),
      daysFromNow: search.daysFromNow || search.days || null,
      returnOffsetDays: Number(search.returnOffsetDays ?? search.returnDays ?? 7),
      flightNumber: search.flightNumber || search.flight || null,
      excludeFlightNumber: search.excludeFlightNumber || search.excludeFlight || null,
      maxStops: search.maxStops,
    },
    book: {
      maxFare: book.maxFare ?? null,
      retryOnInprogress: parseBool(book.retryOnInprogress, true),
      uniqueNames: parseBool(book.uniqueNames, true),
      leadFirstName: book.leadFirstName || book.firstName || null,
      leadLastName: book.leadLastName || book.lastName || null,
      passport: parseBool(book.passport, null),
      after: book.after || [],
    },
    after: raw.after || book.after || [],
    out: raw.out || null,
  };
}

export function loadScenario(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  const raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
  return normalizeScenario(raw);
}

export function parseCli(argv = process.argv) {
  const args = argv.slice(2);
  const positional = [];
  const flags = {};
  const envOverrides = {};

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith('-')) {
      positional.push(token);
      continue;
    }

    const eq = token.match(/^(--[^=]+)=(.+)$/);
    const key = eq ? eq[1] : token;
    const inline = eq ? eq[2] : undefined;

    switch (key) {
      case '--origin':
      case '-o': {
        const { value, nextIndex } = nextValue(args, i, inline);
        flags.origin = value.toUpperCase();
        i = nextIndex;
        break;
      }
      case '--dest':
      case '--destination':
      case '-d': {
        const { value, nextIndex } = nextValue(args, i, inline);
        flags.destination = value.toUpperCase();
        i = nextIndex;
        break;
      }
      case '--journey':
      case '--trip': {
        const { value, nextIndex } = nextValue(args, i, inline);
        flags.journey = value.toUpperCase();
        i = nextIndex;
        break;
      }
      case '--adults':
      case '-a': {
        const { value, nextIndex } = nextValue(args, i, inline);
        flags.adults = Number(value);
        i = nextIndex;
        break;
      }
      case '--children':
      case '-c': {
        const { value, nextIndex } = nextValue(args, i, inline);
        flags.children = Number(value);
        i = nextIndex;
        break;
      }
      case '--infants':
      case '-i': {
        const { value, nextIndex } = nextValue(args, i, inline);
        flags.infants = Number(value);
        i = nextIndex;
        break;
      }
      case '--airline': {
        const { value, nextIndex } = nextValue(args, i, inline);
        flags.airlines = splitList(value).map((a) => a.toUpperCase());
        i = nextIndex;
        break;
      }
      case '--fare':
      case '--fare-type': {
        const { value, nextIndex } = nextValue(args, i, inline);
        flags.fareType = value.toUpperCase();
        i = nextIndex;
        break;
      }
      case '--days': {
        const { value, nextIndex } = nextValue(args, i, inline);
        flags.daysFromNow = splitList(value).map(Number);
        i = nextIndex;
        break;
      }
      case '--return-days':
      case '--return-offset': {
        const { value, nextIndex } = nextValue(args, i, inline);
        flags.returnOffsetDays = Number(value);
        i = nextIndex;
        break;
      }
      case '--max-fare': {
        const { value, nextIndex } = nextValue(args, i, inline);
        flags.maxFare = Number(value);
        i = nextIndex;
        break;
      }
      case '--flight':
      case '--flight-number': {
        const { value, nextIndex } = nextValue(args, i, inline);
        flags.flightNumber = value;
        i = nextIndex;
        break;
      }
      case '--exclude-flight': {
        const { value, nextIndex } = nextValue(args, i, inline);
        flags.excludeFlightNumber = value;
        i = nextIndex;
        break;
      }
      case '--names': {
        const { value, nextIndex } = nextValue(args, i, inline);
        const parts = splitList(value);
        flags.leadFirstName = parts[0] || null;
        flags.leadLastName = parts[1] || null;
        i = nextIndex;
        break;
      }
      case '--first-name': {
        const { value, nextIndex } = nextValue(args, i, inline);
        flags.leadFirstName = value;
        i = nextIndex;
        break;
      }
      case '--last-name': {
        const { value, nextIndex } = nextValue(args, i, inline);
        flags.leadLastName = value;
        i = nextIndex;
        break;
      }
      case '--after': {
        const { value, nextIndex } = nextValue(args, i, inline);
        flags.after = splitList(value).map((s) => s.toLowerCase());
        i = nextIndex;
        break;
      }
      case '--br':
      case '--booking-ref': {
        const { value, nextIndex } = nextValue(args, i, inline);
        flags.br = value;
        i = nextIndex;
        break;
      }
      case '--action': {
        const { value, nextIndex } = nextValue(args, i, inline);
        flags.action = value.toUpperCase();
        i = nextIndex;
        break;
      }
      case '--scenario': {
        const { value, nextIndex } = nextValue(args, i, inline);
        flags.scenario = value;
        i = nextIndex;
        break;
      }
      case '--out': {
        const { value, nextIndex } = nextValue(args, i, inline);
        flags.out = value;
        i = nextIndex;
        break;
      }
      case '--base-url': {
        const { value, nextIndex } = nextValue(args, i, inline);
        envOverrides.BASE_URL = value;
        i = nextIndex;
        break;
      }
      case '--pid': {
        const { value, nextIndex } = nextValue(args, i, inline);
        envOverrides.FLIGHT_ISSUE_PID = value;
        i = nextIndex;
        break;
      }
      case '--direct':
        flags.direct = true;
        break;
      case '--connecting':
        flags.connecting = true;
        break;
      case '--flexi':
        flags.flexi = true;
        break;
      case '--passport':
        flags.passport = true;
        break;
      case '--no-retry':
        flags.retryOnInprogress = false;
        break;
      case '--help':
      case '-h':
        flags.help = true;
        break;
      default:
        throw new Error(`Unknown flag: ${token}`);
    }
  }

  const [domain, command, ...restPos] = positional;
  return {
    domain,
    command,
    positional: restPos,
    flags,
    envOverrides,
  };
}

export function mergeBookOptions(cli, scenario = null) {
  const base = scenario ? normalizeScenario(scenario) : normalizeScenario({});
  const s = base.search;
  const b = base.book;

  const airlines = cli.flags.airlines?.length ? cli.flags.airlines : s.airlines;
  const daysFromNow = cli.flags.daysFromNow?.length
    ? cli.flags.daysFromNow
    : (Array.isArray(s.daysFromNow) ? s.daysFromNow : null);

  let maxStops = s.maxStops;
  if (cli.flags.direct) maxStops = 0;
  if (cli.flags.connecting) maxStops = null;
  if (s.direct && maxStops === undefined) maxStops = 0;
  if (s.connecting && maxStops === undefined) maxStops = null;
  if (maxStops === undefined) maxStops = 0;

  const after = cli.flags.after?.length
    ? cli.flags.after
    : (base.after?.length ? base.after.map((x) => String(x).toLowerCase()) : []);

  return {
    name: base.name,
    journey: (cli.flags.journey || s.journey || 'OW').toUpperCase(),
    origin: cli.flags.origin || s.origin,
    destination: cli.flags.destination || s.destination,
    adults: cli.flags.adults ?? s.adults ?? 1,
    children: cli.flags.children ?? s.children ?? 0,
    infants: cli.flags.infants ?? s.infants ?? 0,
    airlines: airlines.map((a) => String(a).toUpperCase()),
    fareType: cli.flags.fareType || s.fareType || 'NORMAL',
    flexi: cli.flags.flexi ?? s.flexi ?? false,
    maxStops,
    daysFromNow: daysFromNow || [35, 40, 45, 50, 55, 60, 65],
    returnOffsetDays: cli.flags.returnOffsetDays ?? s.returnOffsetDays ?? 7,
    flightNumber: cli.flags.flightNumber || s.flightNumber || null,
    excludeFlightNumber: cli.flags.excludeFlightNumber || s.excludeFlightNumber || null,
    maxFare: cli.flags.maxFare ?? b.maxFare ?? (Number(process.env.MAX_FARE || 0) || null),
    retryOnInprogress: cli.flags.retryOnInprogress ?? b.retryOnInprogress ?? true,
    uniqueNames: b.uniqueNames ?? true,
    leadFirstName: cli.flags.leadFirstName || b.leadFirstName || null,
    leadLastName: cli.flags.leadLastName || b.leadLastName || null,
    passport: cli.flags.passport ?? b.passport ?? null,
    after,
    out: cli.flags.out || base.out || null,
    br: cli.flags.br || null,
    action: cli.flags.action || 'PENALTY',
  };
}

export function printHelp() {
  console.log(`
TravelVIP CLI — run flight/hotel API flows from the terminal

Usage:
  node bin/tvip.js flight book [options]
  node bin/tvip.js flight run --scenario scenarios/flight/my.json
  node bin/tvip.js flight status --br BR123...
  node bin/tvip.js flight cancel --br BR123... [--action PENALTY|CANCEL] [--after penalty,cancel]

Flight book options:
  --origin, -o          Origin airport (e.g. DEL)
  --dest, -d            Destination airport (e.g. BOM)
  --journey OW|RT       Journey type (default OW)
  --adults, -a          Adult count (default 1)
  --children, -c        Child count (default 0)
  --infants, -i         Infant count (default 0)
  --airline             Airline code(s), comma-separated (e.g. 6E or 6E,SG)
  --fare NORMAL|CORPORATE
  --flexi               Pick Flexi cancel fare from search results
  --direct              Non-stop only (default)
  --connecting          Allow connecting flights
  --days                Comma-separated days from now (e.g. 35,40,45)
  --return-days         RT return offset from onward date (default 7)
  --max-fare            Skip pricing above this amount
  --flight              Filter by flight number (e.g. 6045 or 6E6045)
  --exclude-flight      Skip a specific flight number
  --names               Lead passenger "First,Last"
  --after               Post-book steps: penalty,cancel,detail
  --passport            Force passport details (auto for intl routes)
  --no-retry            Do not retry on Inprogress/Pending
  --out                 Report JSON path
  --base-url            Override BASE_URL
  --pid                 Override FLIGHT_ISSUE_PID

Environment (from .env):
  BASE_URL, PARTNER_ID, PARTNER_SECRET, SIGNING_KEY, FLIGHT_ISSUE_PID, MAX_FARE

Examples:
  BASE_URL=https://api-staging.travelvip.ai FLIGHT_ISSUE_PID=vgm \\
    node bin/tvip.js flight book -o BOM -d DEL --airline 6E --adults 1 --direct

  node bin/tvip.js flight book -o DEL -d BOM --airline SG -a 1 -c 1 --after penalty

  node bin/tvip.js flight book -o DEL -d DXB --journey RT --adults 2 --connecting

  node bin/tvip.js flight book -o BLR -d SXV --airline 6E --fare CORPORATE --flexi

  node bin/tvip.js flight cancel --br BR1786583594742267 --after penalty,cancel
`);
}
