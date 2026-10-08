/**
 * Full B2B pre-deploy pack: hotel then flight (no reschedule).
 *
 *   $env:BASE_URL='https://api-staging.travelvip.ai'
 *   $env:TIER_ID='10546901'
 *   npm run b2b:regression
 */
import { spawn } from 'child_process';

function run(script, extraArgs = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...extraArgs], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

async function main() {
  const rest = process.argv.slice(2);
  console.log('\n========== B2B HOTEL ==========');
  const hotel = await run('travel-apis/hotel/scripts/hotel-regression-suite.js', rest);
  console.log('\n========== B2B FLIGHT ==========');
  const flight = await run('travel-apis/flight/scripts/flight-regression-suite.js', rest);
  process.exitCode = hotel || flight ? 1 : 0;
  console.log('\n========== B2B DONE ==========');
  console.log('hotel exit', hotel, 'flight exit', flight);
}

main();
