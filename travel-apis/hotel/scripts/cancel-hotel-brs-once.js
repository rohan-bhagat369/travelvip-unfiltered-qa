/**
 * Cancel leftover hotel BRs — no polling.
 *   BASE_URL=https://api-staging.travelvip.ai node scripts/cancel-hotel-brs-once.js
 */
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';

process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';

const BRS = (process.env.HOTEL_BRS || [
  'BR1787585474994989',
  'BR1787585486114084',
  'BR1787585498477020',
  'BR1787585508437704',
].join(',')).split(',').map((s) => s.trim()).filter(Boolean);

async function main() {
  clearSession();
  const session = await authenticate(true);
  const hotel = new HotelService(session.client);
  console.log('BASE_URL=', process.env.BASE_URL);
  for (const br of BRS) {
    const cancel = await hotel.cancelBooking(br);
    console.log(JSON.stringify({
      br,
      http: cancel.status,
      ok: cancel.ok,
      code: cancel.data?.error?.code || null,
      status: cancel.data?.status || null,
      message: cancel.data?.error?.message || cancel.data?.message || null,
    }));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
