/**
 * Preprod — Airport Search misspell / near-miss canary (like bangalor→Bangor BUG).
 * Catalog only. No book.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';

const OUT = path.join('reports', process.env.REPORT_OUT || 'airport-search-misspell-canary-preprod.json');

function hitsOf(data) {
  return Array.isArray(data?.result) ? data.result : [];
}

function brief(h) {
  return {
    airportCode: h.airportCode,
    city: h.city,
    airportName: h.airportName,
    country: h.country,
  };
}

function rankOf(hits, codes) {
  const want = (Array.isArray(codes) ? codes : [codes]).map((c) => String(c).toUpperCase());
  for (let i = 0; i < hits.length; i += 1) {
    const code = String(hits[i].airportCode || '').toUpperCase();
    if (want.includes(code)) return { rank: i + 1, code };
  }
  return { rank: null, code: null };
}

async function main() {
  console.log('=== Airport misspell canary PREPROD (no book) ===');
  if (!process.env.CORRELATION_ID) process.env.CORRELATION_ID = randomUUID();
  clearSession();
  const session = await authenticate(true);
  session.client.setCorrelationId(process.env.CORRELATION_ID);
  const flight = new FlightService(session.client);

  // Intentional near-miss / truncated / transposed / dropped-letter city names
  const cases = [
    // Bangalore / Bengaluru family (known bangalor BUG)
    { q: 'bangalor', expect: ['BLR'], city: /bengaluru|bangalore/i, note: 'known: may hit Bangor' },
    { q: 'banglor', expect: ['BLR'], city: /bengaluru|bangalore/i },
    { q: 'bangalore', expect: ['BLR'], city: /bengaluru|bangalore/i },
    { q: 'bengaluru', expect: ['BLR'], city: /bengaluru|bangalore/i },
    { q: 'bengaloor', expect: ['BLR'], city: /bengaluru|bangalore/i },
    { q: 'bengalur', expect: ['BLR'], city: /bengaluru|bangalore/i },
    { q: 'bangaluru', expect: ['BLR'], city: /bengaluru|bangalore/i },
    { q: 'bengaluruu', expect: ['BLR'], city: /bengaluru|bangalore/i },

    // Mumbai
    { q: 'mumbi', expect: ['BOM'], city: /mumbai/i },
    { q: 'bombay', expect: ['BOM'], city: /mumbai|bombay/i },
    { q: 'mumabai', expect: ['BOM'], city: /mumbai/i },
    { q: 'muumbai', expect: ['BOM'], city: /mumbai/i },

    // Delhi
    { q: 'dehli', expect: ['DEL'], city: /delhi/i },
    { q: 'delli', expect: ['DEL'], city: /delhi/i },
    { q: 'newdelh', expect: ['DEL'], city: /delhi/i },
    { q: 'new delh', expect: ['DEL'], city: /delhi/i },
    { q: 'newdlhi', expect: ['DEL'], city: /delhi/i },

    // Chennai / Madras
    { q: 'chenai', expect: ['MAA'], city: /chennai/i },
    { q: 'chennaii', expect: ['MAA'], city: /chennai/i },
    { q: 'madrass', expect: ['MAA'], city: /chennai|madras/i },
    { q: 'madras', expect: ['MAA'], city: /chennai|madras/i },

    // Hyderabad
    { q: 'hydrabd', expect: ['HYD'], city: /hyderabad/i },
    { q: 'hyderabd', expect: ['HYD'], city: /hyderabad/i },
    { q: 'hyderbad', expect: ['HYD'], city: /hyderabad/i },
    { q: 'hydrabad', expect: ['HYD'], city: /hyderabad/i },

    // Kolkata / Calcutta
    { q: 'kolkat', expect: ['CCU'], city: /kolkata|calcutta/i },
    { q: 'kolkataa', expect: ['CCU'], city: /kolkata/i },
    { q: 'calcuta', expect: ['CCU'], city: /kolkata|calcutta/i },
    { q: 'calcutta', expect: ['CCU'], city: /kolkata|calcutta/i },
    { q: 'kolkatta', expect: ['CCU'], city: /kolkata/i },

    // Ahmedabad
    { q: 'ahmedabd', expect: ['AMD'], city: /ahmedabad/i },
    { q: 'ahmdabad', expect: ['AMD'], city: /ahmedabad/i },
    { q: 'ahmedabaad', expect: ['AMD'], city: /ahmedabad/i },
    { q: 'amdavad', expect: ['AMD'], city: /ahmedabad|amdavad/i },

    // Amritsar
    { q: 'amritsa', expect: ['ATQ'], city: /amritsar/i },
    { q: 'amristsar', expect: ['ATQ'], city: /amritsar/i },
    { q: 'amritsar', expect: ['ATQ'], city: /amritsar/i },

    // Pune / Poona
    { q: 'pone', expect: ['PNQ'], city: /pune/i },
    { q: 'punne', expect: ['PNQ'], city: /pune/i },
    { q: 'poona', expect: ['PNQ'], city: /pune|poona/i },

    // Goa / Dabolim / Mopa
    { q: 'goa', expect: ['GOI', 'GOX'], city: /goa|dabolim|mopa/i },
    { q: 'goaa', expect: ['GOI', 'GOX'], city: /goa/i },
    { q: 'dabolim', expect: ['GOI'], city: /goa|dabolim/i },

    // Jaipur
    { q: 'jaipu', expect: ['JAI'], city: /jaipur/i },
    { q: 'jaipurr', expect: ['JAI'], city: /jaipur/i },
    { q: 'jaypur', expect: ['JAI'], city: /jaipur/i },

    // Lucknow
    { q: 'lucknw', expect: ['LKO'], city: /lucknow/i },
    { q: 'lakhnau', expect: ['LKO'], city: /lucknow|lakhnau/i },
    { q: 'lucknou', expect: ['LKO'], city: /lucknow/i },

    // Kochi / Cochin
    { q: 'kochi', expect: ['COK'], city: /kochi|cochin/i },
    { q: 'cochin', expect: ['COK'], city: /kochi|cochin/i },
    { q: 'cochinn', expect: ['COK'], city: /kochi|cochin/i },
    { q: 'kocchi', expect: ['COK'], city: /kochi|cochin/i },

    // Thiruvananthapuram / Trivandrum
    { q: 'trivandrum', expect: ['TRV'], city: /thiruvananthapuram|trivandrum/i },
    { q: 'trivandrm', expect: ['TRV'], city: /thiruvananthapuram|trivandrum/i },
    { q: 'thiruvananthapuram', expect: ['TRV'], city: /thiruvananthapuram|trivandrum/i },

    // Srinagar
    { q: 'srinagr', expect: ['SXR'], city: /srinagar/i },
    { q: 'srinagar', expect: ['SXR'], city: /srinagar/i },

    // Varanasi / Benares
    { q: 'varanasi', expect: ['VNS'], city: /varanasi/i },
    { q: 'varanasi', expect: ['VNS'], city: /varanasi/i },
    { q: 'benaras', expect: ['VNS'], city: /varanasi|benaras|banaras/i },
    { q: 'banaras', expect: ['VNS'], city: /varanasi|banaras/i },

    // Indore
    { q: 'indor', expect: ['IDR'], city: /indore/i },
    { q: 'indoor', expect: ['IDR'], city: /indore/i },

    // Nagpur
    { q: 'nagpr', expect: ['NAG'], city: /nagpur/i },
    { q: 'nagpur', expect: ['NAG'], city: /nagpur/i },

    // Chandigarh
    { q: 'chandigar', expect: ['IXC'], city: /chandigarh/i },
    { q: 'chandigrah', expect: ['IXC'], city: /chandigarh/i },

    // Guwahati
    { q: 'guwhati', expect: ['GAU'], city: /guwahati/i },
    { q: 'guwahati', expect: ['GAU'], city: /guwahati/i },
    { q: 'gauhati', expect: ['GAU'], city: /guwahati|gauhati/i },

    // International near-misses that often confuse fuzzy matchers
    { q: 'singapor', expect: ['SIN'], city: /singapore/i },
    { q: 'singpore', expect: ['SIN'], city: /singapore/i },
    { q: 'singapre', expect: ['SIN'], city: /singapore/i },
    { q: 'dubia', expect: ['DXB'], city: /dubai/i },
    { q: 'duabi', expect: ['DXB'], city: /dubai/i },
    { q: 'bangkock', expect: ['BKK', 'DMK'], city: /bangkok/i },
    { q: 'bankok', expect: ['BKK', 'DMK'], city: /bangkok/i },
    { q: 'londn', expect: ['LON', 'LHR', 'LGW', 'STN', 'LCY'], city: /london/i },
    { q: 'pariss', expect: ['PAR', 'CDG', 'ORY'], city: /paris/i },
    { q: 'tokoyo', expect: ['TYO', 'HND', 'NRT'], city: /tokyo/i },
    { q: 'newyrok', expect: ['NYC', 'JFK', 'EWR', 'LGA'], city: /new york|york/i },
  ];

  const rows = [];
  const counts = { PASS: 0, BUG: 0, NOT_TESTED: 0 };
  const bugs = [];

  let i = 0;
  for (const t of cases) {
    i += 1;
    const res = await flight.airportSearch(t.q);
    const hits = hitsOf(res.data).map(brief);
    const top = hits.slice(0, 5);
    const { rank, code } = rankOf(hits, t.expect);
    const top1 = top[0];
    const cityOk = !t.city || (rank != null && t.city.test(`${top.map((h) => `${h.city} ${h.airportName}`).join(' ')}`));

    let status = 'PASS';
    let actual = `HTTP ${res.status} n=${hits.length} expect@${rank || 'MISS'}(${code || '-'}) top=${top.map((h) => `${h.airportCode}:${h.city}`).join(' | ') || '(none)'}`;

    if (res.status >= 500) {
      status = 'BUG';
    } else if (res.status !== 200) {
      status = 'BUG';
    } else if (hits.length === 0) {
      status = 'BUG';
      actual += ' — empty (expected city miss)';
    } else if (rank == null || rank > 3) {
      status = 'BUG';
      actual += ` — wrong/miss; top1=${top1?.airportCode}:${top1?.city}`;
    } else if (!cityOk) {
      status = 'BUG';
    }

    // Extra signal: wrong city ranked #1 while expected missing/low
    const wrongTop =
      status === 'BUG' &&
      top1 &&
      !t.expect.map((c) => c.toUpperCase()).includes(String(top1.airportCode || '').toUpperCase());

    counts[status] += 1;
    const row = {
      id: i,
      query: t.q,
      expect: t.expect,
      note: t.note || null,
      status,
      actual,
      rank,
      matchedCode: code,
      wrongTop: wrongTop ? `${top1.airportCode}:${top1.city}` : null,
      top,
    };
    rows.push(row);
    if (status === 'BUG') bugs.push(row);
    console.log(`[${status}] ${i}. ${t.q} → ${actual}`);
  }

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: process.env.BASE_URL,
    tierId: process.env.TIER_ID,
    api: 'GET /v1/flights/airports',
    note: 'Misspell/near-miss canary after bangalor→Bangor. Catalog only, no book.',
    counts,
    bugCount: bugs.length,
    bugs: bugs.map((b) => ({
      id: b.id,
      query: b.query,
      expect: b.expect,
      wrongTop: b.wrongTop,
      rank: b.rank,
      top: b.top,
      actual: b.actual,
    })),
    rows,
  };

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== COUNTS ===', counts);
  console.log('BUGS', bugs.length);
  for (const b of bugs) {
    console.log(`  - ${b.query}: expect ${b.expect.join('|')} got top ${b.wrongTop || '(empty/low)'} rank=${b.rank}`);
  }
  console.log('Report', OUT);
  if (counts.BUG > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
