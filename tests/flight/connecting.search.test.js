import { authenticate } from '../../shared/lib/authService.js';
import { FlightService } from '../../travel-apis/flight/src/service.js';
import { flightReporter } from '../../travel-apis/flight/src/reporter.js';
import {
  analyzeFlightOptions,
  buildOneWaySearchBody,
  buildRoundTripSearchBody,
  hasConnectingOptions,
} from '../../travel-apis/flight/src/helpers.js';
import { assertOk, sleep } from '../../shared/lib/testUtils.js';

const OW_CONNECTING_ROUTES = [
  { origin: 'DEL', destination: 'BOM', label: 'domestic metro' },
  { origin: 'PAT', destination: 'BOM', label: 'tier-2 origin' },
  { origin: 'DEL', destination: 'DXB', label: 'international short' },
  { origin: 'BOM', destination: 'LHR', label: 'international long' },
];

/** Metro / hub pairs — both legs reliably return connecting options in staging */
const RT_CONNECTING_ROUTES = [
  { origin: 'DEL', destination: 'BOM', label: 'domestic metro' },
  { origin: 'BOM', destination: 'LHR', label: 'international long' },
  { origin: 'DEL', destination: 'DXB', label: 'international short' },
];

async function searchOwWithStops(flight, route, maxStops) {
  const body = buildOneWaySearchBody(45, {
    origin: route.origin,
    destination: route.destination,
    maxStops,
    fareType: 'NORMAL',
  });
  let response;
  for (let i = 0; i < 15; i += 1) {
    response = await flight.search(body);
    if (response.ok && response.data?.progress?.state === 'COMPLETE') break;
    if (response.ok && response.data?.results?.some((r) => r.options?.length)) break;
    await sleep(response.data?.progress?.pollAfterMs || 4000);
  }
  return response;
}

describe('Flight Connecting / Layover Search', () => {
  let flight;

  beforeAll(async () => {
    flightReporter.setSuite('Flight Connecting Search');
    const session = await authenticate();
    flight = new FlightService(session.client);
  }, 120000);

  describe('One-Way (OW)', () => {
    test.each(OW_CONNECTING_ROUTES)(
      'OW $origin→$destination returns connecting flights when maxStops allows layovers',
      async (route) => {
        const response = await searchOwWithStops(flight, route, null);
        assertOk(response, `OW search ${route.origin}→${route.destination}`);
        const analysis = analyzeFlightOptions(response.data, 'ONWARD');
        expect(analysis.total).toBeGreaterThan(0);
        expect(analysis.connectingCount).toBeGreaterThan(0);
        expect(analysis.connecting[0].segmentCount).toBeGreaterThanOrEqual(2);
        expect(analysis.connecting[0].legs.length).toBeGreaterThanOrEqual(2);
      },
      120000,
    );

    test('OW DEL→BOM with maxStops=0 returns only non-stop flights', async () => {
      const response = await searchOwWithStops(flight, { origin: 'DEL', destination: 'BOM' }, 0);
      assertOk(response, 'OW non-stop search');
      const analysis = analyzeFlightOptions(response.data, 'ONWARD');
      expect(analysis.connectingCount).toBe(0);
      expect(analysis.nonStopCount).toBeGreaterThan(0);
    }, 120000);

    test('OW DEL→BOM with maxStops=null includes more options than maxStops=0', async () => {
      const nonStopRes = await searchOwWithStops(flight, { origin: 'DEL', destination: 'BOM' }, 0);
      const allStopsRes = await searchOwWithStops(flight, { origin: 'DEL', destination: 'BOM' }, null);
      assertOk(nonStopRes, 'non-stop search');
      assertOk(allStopsRes, 'all stops search');
      const nonStop = analyzeFlightOptions(nonStopRes.data);
      const allStops = analyzeFlightOptions(allStopsRes.data);
      expect(allStops.connectingCount).toBeGreaterThan(nonStop.connectingCount);
    }, 180000);
  });

  describe('Round-Trip (RT)', () => {
    test.each(RT_CONNECTING_ROUTES)(
      'RT $origin↔$destination returns connecting flights on onward and return legs',
      async (route) => {
        const body = buildRoundTripSearchBody(30, 37, {
          origin: route.origin,
          destination: route.destination,
          maxStops: null,
          fareType: 'NORMAL',
        });

        const { response } = await flight.searchRoundTripUntilComplete(body);
        assertOk(response, `RT search ${route.origin}↔${route.destination}`);

        const onward = analyzeFlightOptions(response.data, 'ONWARD');
        const returnLeg = analyzeFlightOptions(response.data, 'RETURN');

        expect(onward.total).toBeGreaterThan(0);
        expect(returnLeg.total).toBeGreaterThan(0);
        expect(onward.connectingCount).toBeGreaterThan(0);
        expect(returnLeg.connectingCount).toBeGreaterThan(0);
        expect(hasConnectingOptions(response.data, 'ONWARD')).toBe(true);
        expect(hasConnectingOptions(response.data, 'RETURN')).toBe(true);
      },
      180000,
    );
  });
});
