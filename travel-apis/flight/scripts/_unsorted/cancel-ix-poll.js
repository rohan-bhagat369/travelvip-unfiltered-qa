import { authenticate } from '../../../../shared/lib/authService.js';
import { FlightService } from '../../src/service.js';
import { sleep } from '../../../../shared/lib/testUtils.js';

const br = 'BR1784553723771243';

async function main() {
  const session = await authenticate(true);
  const flight = new FlightService(session.client);

  for (let i = 1; i <= 12; i++) {
    const res = await flight.getBookingStatus(br);
    const status = res.data?.status;
    console.log(`[${i}] status=${status}`);

    if (String(status).toLowerCase().includes('cancel')) {
      console.log(JSON.stringify(res.data, null, 2));
      return;
    }

    if (i === 3 || i === 7) {
      console.log('  retrying cancel...');
      const cancel = await flight.cancelBooking(br);
      console.log(
        '  cancel:',
        cancel.data?.requestStatus,
        cancel.data?.errors?.[0]?.error || JSON.stringify(cancel.data?.data || {}),
      );
    }

    if (i < 12) await sleep(10000);
  }

  const final = await flight.getBookingStatus(br);
  console.log('\nFinal status still:', final.data?.status);
  console.log(JSON.stringify({
    status: final.data?.status,
    pnr: final.data?.bookingResponse?.itinerary?.[0]?.pnr,
    onlineCancellation: final.data?.bookingResponse?.onlineCancellation,
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
