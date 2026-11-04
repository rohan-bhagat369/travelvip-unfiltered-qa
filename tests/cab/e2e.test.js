import { authenticate } from '../../shared/lib/authService.js';
import { CabService } from '../../travel-apis/cab/src/service.js';
import { runCabBookingE2e } from '../../travel-apis/cab/src/e2eFlow.js';

describe('Cab E2E Booking Flows', () => {
  let cab;

  beforeAll(async () => {
    const session = await authenticate();
    cab = new CabService(session.client);
  }, 120000);

  test.each([
    ['AIRPORT'],
    ['RENTAL'],
    ['OUTSTATION'],
  ])(
    'Cab %s: Auth → Search → Fare → Book → Status → Cancel',
    async (journeyType) => {
      const ctx = await runCabBookingE2e(cab, journeyType);

      expect(ctx.journeyType).toBe(journeyType);
      expect(ctx.bookingRefId).toMatch(/^BR/);
      expect(ctx.steps).toHaveLength(5);
      expect(ctx.steps.every((s) => s.ok)).toBe(true);
      expect(ctx.searchBody.journeyType).toBe(journeyType);

      const normalized = String(ctx.bookingStatus || '').toLowerCase();
      expect(['confirmed', 'pending', 'cancelled', 'canceled']).toContain(normalized);
    },
    300000,
  );
});
