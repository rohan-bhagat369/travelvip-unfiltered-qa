import { authenticate } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';
import { pollRoundTripSearch } from '../src/searchPicker.js';
import { buildRoundTripSearchBody } from '../src/helpers.js';

async function tryPrice(flight, origin, dest, days, label) {
  const body = buildRoundTripSearchBody(days, days + 7, { origin, destination: dest, fareType: 'NORMAL' });
  const rt = await pollRoundTripSearch(flight, body, { fareType: 'NORMAL' }, { maxPolls: 10 });
  const pair = rt.pairs?.[0];
  console.log(label, 'pairs', rt.pairs?.length || 0, pair?.searchIds, pair?.onward?.label, '+', pair?.ret?.label);
  if (!pair) return;
  const details = await flight.getDetails(pair.searchIds, 'ROUND_TRIP');
  const pricing = await flight.getPricing(pair.searchIds, 'ROUND_TRIP');
  console.log(label, 'details', details.status, details.data?.error?.code || 'ok', 'pricing', pricing.status, pricing.data?.error?.code || pricing.data?.priceId || 'no-priceId');
}

async function main() {
  process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
  const session = await authenticate(true);
  const flight = new FlightService(session.client);
  await tryPrice(flight, 'DEL', 'BOM', 28, 'DOM-UNFILTERED');
  await tryPrice(flight, 'BOM', 'DXB', 28, 'INTL-UNFILTERED');
}
main().catch((e) => { console.error(e); process.exit(1); });
