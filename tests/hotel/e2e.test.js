import { authenticate } from '../../shared/lib/authService.js';
import { HotelService } from '../../travel-apis/hotel/src/service.js';
import { hotelReporter } from '../../travel-apis/hotel/src/reporter.js';
import { runHotelBookingE2e } from '../../travel-apis/hotel/src/e2eFlow.js';

describe('Hotel E2E Booking Flow', () => {
  let hotel;

  beforeAll(async () => {
    hotelReporter.setSuite('Hotel E2E Booking');
    const session = await authenticate();
    hotel = new HotelService(session.client);
  }, 120000);

  test('Hotel: Autocomplete → Search → Details → Prebook → Finalize → Status → Detail → Cancel', async () => {
    const ctx = await runHotelBookingE2e(hotel);

    expect(ctx.bookingRefId).toMatch(/^BR/);
    expect(ctx.steps.length).toBeGreaterThanOrEqual(7);
    expect(ctx.bookingCode).toContain('rh-test_hotel_do_not_book');
    expect(ctx.requestId).toBeTruthy();
    expect(ctx.searchBody.checkin).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Staging/vendor can keep bookings in Pending for long time; the bookingRef should still be produced.
    const normalized = String(ctx.bookingStatus || '').toLowerCase();
    expect(['confirmed', 'pending']).toContain(normalized);
  }, 900000);
});
