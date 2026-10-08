import path from 'path';
import { fileURLToPath } from 'url';
import {
  generateFasttrackAvailabilityReport,
  writeFasttrackReportExcel,
} from '../src/availabilityReport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reportsDir = path.resolve(__dirname, '../reports/fasttrack');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputPath = path.join(reportsDir, `fasttrack-availability-report-${timestamp}.xlsx`);
const latestPath = path.join(reportsDir, 'latest-fasttrack-availability-report.xlsx');

async function main() {
  console.log('Starting fasttrack availability report...');

  const reportData = await generateFasttrackAvailabilityReport({
    onProgress: ({ current, total, iata }) => {
      if (current === 1 || current === total || current % 10 === 0) {
        console.log(`[${current}/${total}] Processing ${iata}`);
      }
    },
    ...(process.env.FASTTRACK_AIRPORT_LIMIT
      ? { airportLimit: Number(process.env.FASTTRACK_AIRPORT_LIMIT) }
      : {}),
  });

  writeFasttrackReportExcel(reportData, outputPath);
  writeFasttrackReportExcel(reportData, latestPath);

  const summary = reportData.summaryRows[0];
  console.log('\nReport generated successfully.');
  console.log(`File: ${outputPath}`);
  console.log(`Latest: ${latestPath}`);
  console.log('\nSummary:');
  console.log(`  Total fasttracks validated: ${summary['Total Sheet Fasttracks Validated']}`);
  console.log(`  PASS: ${summary.PASS}`);
  console.log(`  FAIL: ${summary.FAIL}`);
  console.log(`  Pass %: ${summary['Pass %']}`);
  console.log(`  Airports processed: ${summary['Unique Airports Processed']}`);
  console.log(`  API errors: ${summary['API Errors']}`);
}

main().catch((error) => {
  console.error('Failed to generate fasttrack availability report:', error.message);
  process.exit(1);
});
