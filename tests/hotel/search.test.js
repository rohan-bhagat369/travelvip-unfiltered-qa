import { authenticate } from '../../shared/lib/authService.js';
import { HotelService } from '../../travel-apis/hotel/src/service.js';
import { hotelReporter } from '../../travel-apis/hotel/src/reporter.js';
import { analyzeHotelRooms, buildSearchBody, extractEntityId } from '../../travel-apis/hotel/src/helpers.js';
import { assertOk } from '../../shared/lib/testUtils.js';
import {
  validateAutocompleteResponse,
  validateDetailsResponse,
  validateSearchResponse,
} from '../../shared/validators/hotelValidators.js';

describe('Hotel Search & Lookup APIs', () => {
  let hotel;

  beforeAll(async () => {
    hotelReporter.setSuite('Hotel Search & Lookup');
    const session = await authenticate();
    hotel = new HotelService(session.client);
  });

  test('autocomplete returns hotel suggestions with entityId', async () => {
    const response = await hotel.autocomplete('taj');
    assertOk(response, 'Hotel autocomplete');
    validateAutocompleteResponse(response.data);
    const entityId = extractEntityId(response.data);
    expect(entityId).toBeTruthy();
  });

  test('hotel search returns availability for Taj Dubai', async () => {
    const searchBody = buildSearchBody();
    const response = await hotel.search(searchBody);
    assertOk(response, 'Hotel search');
    validateSearchResponse(response.data);
    expect(response.data.requestId).toBeTruthy();
    expect(response.data.availableResults).toBeGreaterThanOrEqual(1);
  });

  test('hotel details returns rooms with booking codes', async () => {
    const searchBody = buildSearchBody();
    const search = await hotel.search(searchBody);
    assertOk(search, 'Hotel search');

    const response = await hotel.getDetails(searchBody);
    assertOk(response, 'Hotel details');
    validateDetailsResponse(response.data);

    const analysis = analyzeHotelRooms(response.data);
    expect(analysis.availableRooms).toBeGreaterThan(0);
    expect(analysis.bookingCodes.length).toBeGreaterThan(0);
    expect(String(analysis.bookingCodes[0])).not.toMatch(/!TB!RIYA!TB!|\bRIYA\b/i);
  });

  test('hotel booking history returns list', async () => {
    const response = await hotel.bookingHistory();
    assertOk(response, 'Hotel booking history');
    expect(response.data).toBeDefined();
  });
});
