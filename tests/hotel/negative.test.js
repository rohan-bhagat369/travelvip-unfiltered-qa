import { authenticate } from '../../shared/lib/authService.js';
import { HotelService } from '../../travel-apis/hotel/src/service.js';
import { hotelReporter } from '../../travel-apis/hotel/src/reporter.js';
import { buildSearchBody, isHotelApiError } from '../../travel-apis/hotel/src/helpers.js';
import { expectValidationEnforced } from '../../shared/lib/validators.js';

describe('Hotel Booking - Negative & Validation Tests', () => {
  let hotel;
  let validRequestId;
  let validBookingCode;

  beforeAll(async () => {
    hotelReporter.setSuite('Hotel Negative Tests');
    const session = await authenticate();
    hotel = new HotelService(session.client);

    const { searchResponse, detailsResponse, requestId, bookingCodes } = await hotel.searchWithDetails();
    validRequestId = requestId;
    validBookingCode = bookingCodes[0];

    if (!searchResponse.ok || !detailsResponse?.ok || !validBookingCode) {
      throw new Error('Could not seed hotel negative tests — search/details unavailable');
    }
  }, 120000);

  describe('Search validations', () => {
    test('search with invalid entityId returns error or empty results', async () => {
      const body = buildSearchBody({ entityId: '0000000' });
      const response = await hotel.search(body);
      const rejected = isHotelApiError(response) || (response.data?.availableResults ?? 0) === 0;
      expect(rejected).toBe(true);
    });

    test('search with past check-in date should be rejected', async () => {
      const body = buildSearchBody();
      body.checkin = '2020-01-01';
      body.checkout = '2020-01-03';
      const response = await hotel.search(body);
      expectValidationEnforced(response, 'HOTEL-NEG-001');
    });

    test('search with checkout before checkin should be rejected', async () => {
      const body = buildSearchBody({ checkinDays: 30, nights: -2 });
      const response = await hotel.search(body);
      expectValidationEnforced(response, 'HOTEL-NEG-002');
    });

    test('search rejects missing rooms array', async () => {
      const body = buildSearchBody();
      delete body.rooms;
      const response = await hotel.search(body);
      expect(isHotelApiError(response)).toBe(true);
    });
  });

  describe('Prebook validations', () => {
    test('prebook rejects invalid bookingCode', async () => {
      const response = await hotel.prebook({
        bookingCode: 'invalid-booking-code',
        requestId: validRequestId,
      });
      expect(response.data?.bookingContext).toBeFalsy();
    });

    test('prebook rejects invalid requestId', async () => {
      const response = await hotel.prebook({
        bookingCode: validBookingCode,
        requestId: '00000000-0000-0000-0000-000000000000',
      });
      expect(response.data?.bookingContext).toBeFalsy();
    });
  });

  describe('Booking status validations', () => {
    test('status rejects invalid bookingRefId', async () => {
      const response = await hotel.getBookingStatus('BR0000000000000000');
      expect(isHotelApiError(response)).toBe(true);
      expect(response.data?.message || response.data?.status).toBeTruthy();
    });

    test('booking detail rejects invalid bookingRefId', async () => {
      const response = await hotel.getBookingDetail('BR0000000000000000');
      expect(isHotelApiError(response)).toBe(true);
      expect(response.data?.message || response.data?.status).toBeTruthy();
    });
  });
});
