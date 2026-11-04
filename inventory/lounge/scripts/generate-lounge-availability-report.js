import path from 'path';
import { fileURLToPath } from 'url';
import {
  generateLoungeAvailabilityReport,
  writeLoungeReportExcel,
} from '../src/availabilityReport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reportsDir = path.resolve(__dirname, '../reports/lounge');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputPath = path.join(reportsDir, `lounge-availability-report-${timestamp}.xlsx`);
const latestPath = path.join(reportsDir, 'latest-lounge-availability-report.xlsx');

async function main() {
  console.log('Starting lounge availability report...');

  const reportData = await generateLoungeAvailabilityReport({
    onProgress: ({ current, total, iata }) => {
      if (current === 1 || current === total || current % 25 === 0) {
        console.log(`[${current}/${total}] Processing ${iata}`);
      }
    },
    ...(process.env.LOUNGE_AIRPORT_LIMIT
      ? { airportLimit: Number(process.env.LOUNGE_AIRPORT_LIMIT) }
      : {}),
  });

  writeLoungeReportExcel(reportData, outputPath);
  writeLoungeReportExcel(reportData, latestPath);

  const summary = reportData.summaryRows[0];
  console.log('\nReport generated successfully.');
  console.log(`File: ${outputPath}`);
  console.log(`Latest: ${latestPath}`);
  console.log('\nSummary:');
  console.log(`  Total lounges validated: ${summary['Total Sheet Lounges Validated']}`);
  console.log(`  PASS: ${summary.PASS}`);
  console.log(`  FAIL: ${summary.FAIL}`);
  console.log(`  Pass %: ${summary['Pass %']}`);
  console.log(`  Airports processed: ${summary['Unique Airports Processed']}`);
  console.log(`  API errors: ${summary['API Errors']}`);
}

main().catch((error) => {
  console.error('Failed to generate lounge availability report:', error.message);
  process.exit(1);
});
