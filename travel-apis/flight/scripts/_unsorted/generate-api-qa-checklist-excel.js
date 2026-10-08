/**
 * Generate generic high-level TravelVIP B2B API QA Checklist Excel.
 *   node scripts/generate-api-qa-checklist-excel.js
 */
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const wb = XLSX.utils.book_new();

function sheet(name, rows, cols) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  if (cols) ws['!cols'] = cols.map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws, name);
}

// ========== 1) Cover / Project Setup (cab-style) ==========
sheet('1. Project Setup', [
  ['TravelVIP B2B API — High-Level QA Testing Checklist'],
  ['Purpose', 'Generic API QA checklist for any new client onboarding / release. Use with Postman + API docs + webhook guide.'],
  ['Version', '1.0'],
  ['Created', '2026-08-04'],
  ['References', 'api-docs.travelvip.ai | TravelVIP-Webhooks-Integration-Guide-v1.pdf | Client API Testing Rules sheet | Postman export_b2b | Cab QA Requirement Analysis template'],
  [],
  ['Checkpoint', 'Value / Fill for Client', 'QA Validation / Notes', 'Dev Status', 'Comments', 'QA Status'],
  ['Sprint / Release Version', '', 'Confirm release tag / build', '', '', ''],
  ['Project Name', '', 'Verify branding / partner name in responses where applicable', '', '', ''],
  ['Partner ID (PID)', '', 'Correct partner_id + secret for target env', '', '', ''],
  ['Partner Name', '', 'Partner-specific config / wallet / tier', '', '', ''],
  ['ENV', 'DEV / Staging / Preprod / Prod', 'Never book on Prod unless explicitly approved; Prod = read-only by default', '', '', ''],
  ['Base URL', '', 'Staging: api-staging.travelvip.ai | Prod: api.travelvip.ai', '', '', ''],
  ['API Docs', 'https://api-docs.travelvip.ai', 'Validate against published OpenAPI behaviour', '', '', ''],
  ['Postman Collection', 'export_b2b + environment', 'Collection + env vars ready before execution', '', '', ''],
  ['Services Covered', 'Partner Auth, Flight, Hotel, Cab, eSIM, Lounge, FastTrack, Attractions, Porter', 'Confirm which services are in scope for THIS client', '', '', ''],
  ['Currency', 'INR / USD / AED / …', 'Run at least one multi-currency check if client uses non-INR', '', '', ''],
  ['Language', 'en', 'lang query param consistency', '', '', ''],
  ['Tier Config', 'Lite / Premium / Sapphire (as applicable)', 'Markup / discount / convenience fee vs tier', '', '', ''],
  ['Auth Model', 'Partner token + User session + HMAC signature', 'All signed endpoints; wallet endpoints need X-Partner-Key', '', '', ''],
  ['Payment / Wallet', 'Partner wallet debit', 'Insufficient balance, debit/refund, ledger', '', '', ''],
  ['Webhooks', 'Flight booking + wallet events (v1)', 'Payloads per TravelVIP Webhooks Integration Guide v1', '', '', ''],
  ['Idempotency', 'X-Idempotency-Key / X-Request-Id', 'Duplicate vs new booking behaviour', '', '', ''],
  ['Issue Reporting', '', 'Defect sheet / tracker link', '', '', ''],
  ['QA Signoff', '', 'Sign after all P0/P1 checklist items Pass or Waived', '', '', ''],
], [36, 55, 55, 14, 24, 12]);

// ========== 2) High-Level Checklist ==========
const hdr = ['ID', 'Category', 'Checkpoint (Must Cover)', 'QA Validation / How to Verify', 'Applicable Services', 'Priority', 'API / Doc Reference', 'Env', 'Dev Status', 'QA Status', 'Evidence / BR / Notes'];

const rows = [
  hdr,

  // A. Auth & Security
  ['A01', 'Auth & Security', 'Partner token issue', 'POST /auth/partner/token with valid partner_id/secret → access_token + refresh_token', 'All', 'P0', 'Partner Api', 'All', '', '', ''],
  ['A02', 'Auth & Security', 'Partner token refresh', 'Refresh returns new tokens; expired refresh rejected', 'All', 'P1', 'POST /auth/partner/refresh', 'All', '', '', ''],
  ['A03', 'Auth & Security', 'User session create', 'POST /v1/auth/session with valid tierId → auth_token', 'All', 'P0', 'POST /v1/auth/session', 'All', '', '', ''],
  ['A04', 'Auth & Security', 'Invalid / missing Authorization', 'Missing/invalid Bearer → 401/403; no booking created', 'All', 'P0', 'Security negative', 'All', '', '', ''],
  ['A05', 'Auth & Security', 'HMAC signature validation', 'Valid X-Signature + X-Timestamp accepted; tampered body / wrong key / skewed timestamp rejected', 'All signed APIs', 'P0', 'X-Signature docs', 'All', '', '', ''],
  ['A06', 'Auth & Security', 'X-Request-Id & X-Correlation-ID', 'Present on requests; correlation echoed in _meta.correlation_id across flow', 'All', 'P1', 'Headers', 'All', '', '', ''],
  ['A07', 'Auth & Security', 'X-Partner-Key on wallet debit APIs', 'Required on flight issue-ticket + hotel finalize-booking; missing → MISSING_HEADER; invalid → INVALID_ACCESS_TOKEN', 'Flight, Hotel', 'P0', 'issueFlightTicket / finalizeHotelBooking', 'All', '', '', ''],
  ['A08', 'Auth & Security', 'Tier list / access', 'GET /v1/tiers returns expected tiers for partner', 'All', 'P1', 'GET /v1/tiers', 'All', '', '', ''],

  // B. Common API contract
  ['B01', 'Common Contract', 'Happy-path HTTP + body contract', 'Success paths return expected schema; do not rely only on HTTP 200 (errors may be in body)', 'All', 'P0', 'API docs Responses', 'All', '', '', ''],
  ['B02', 'Common Contract', 'Error code envelope', 'Validation/business errors expose stable code + message (error.code / code / status)', 'All', 'P0', 'Error responses', 'All', '', '', ''],
  ['B03', 'Common Contract', 'Query currency & lang', 'currency + lang honored on search/pricing; response amounts match requested currency at book time', 'All priced services', 'P0', 'Query params', 'All', '', '', ''],
  ['B04', 'Common Contract', 'Currency consistency after confirm', 'Status/detail salesSummary currency matches booked currency; wallet debit matches same currency OR explicit FX fields returned', 'Flight, Hotel, Cab, etc.', 'P0', 'Known bug theme: USD book → INR summary', 'Staging+', '', '', ''],
  ['B05', 'Common Contract', 'Required field validation', 'Missing/empty required fields → VALIDATION_ERROR (or clear status:400 message), not silent success', 'All write APIs', 'P0', 'Negative tests', 'All', '', '', ''],
  ['B06', 'Common Contract', 'Invalid IDs / expired tokens', 'Invalid searchId/priceId/bookingCode/bookingContext rejected or fail safely (no wrong confirm)', 'Flight, Hotel', 'P0', 'Negative', 'All', '', '', ''],
  ['B07', 'Common Contract', 'Rate limit / 429', 'Documented 429 behaviour understood; retries use backoff', 'All', 'P2', 'API docs 429', 'All', '', '', ''],
  ['B08', 'Common Contract', '_meta.correlation_id', 'Present on responses for support debugging', 'All', 'P2', '_meta', 'All', '', '', ''],

  // C. Idempotency / Duplicate / Security matrix
  ['C01', 'Idempotency & Duplicate', 'Exact same payload retry', 'Retry identical issue/finalize → duplicate message / same BR (no second charge)', 'Flight, Hotel, Cab, eSIM, Lounge, Attractions', 'P0', 'X-Idempotency-Key / security matrix', 'Staging', '', '', ''],
  ['C02', 'Idempotency & Duplicate', 'Invalid payload must NOT be masked as duplicate', 'Bad payload returns validation/business error; must not only say Duplicate payload', 'Flight, Hotel', 'P0', 'Known defect: duplicate masking', 'Staging', '', '', ''],
  ['C03', 'Idempotency & Duplicate', 'Passenger/guest name-only change', 'Changing only firstName must NOT create uncontrolled new booking (policy: block or explicit new intent)', 'Flight, Hotel', 'P0', 'Security Case C', 'Staging', '', '', ''],
  ['C04', 'Idempotency & Duplicate', 'Same requestId different payload', 'Behaviour documented and consistent (reject / new BR / duplicate)', 'Hotel, Flight', 'P1', 'Client security rules', 'Staging', '', '', ''],

  // D. Wallet
  ['D01', 'Wallet', 'Sufficient balance booking', 'Happy book debits wallet; remaining balance returned where documented (walletBalanceRemaining)', 'Flight, Hotel', 'P0', 'Finalize / issue', 'Staging', '', '', ''],
  ['D02', 'Wallet', 'Insufficient balance', 'Returns WALLET_INSUFFICIENT_BALANCE with available + required; no confirmed booking', 'Flight, Hotel', 'P0', 'code WALLET_INSUFFICIENT_BALANCE', 'Staging', '', '', ''],
  ['D03', 'Wallet', 'Failed booking wallet reverse', 'booking.failed / Failed status → debit reversed (webhook + ledger)', 'Flight, Hotel', 'P0', 'Webhooks guide booking.failed', 'Staging', '', '', ''],
  ['D04', 'Wallet', 'Cancel refund to wallet', 'Successful cancel credits net refund; matches cancel API totalRefund', 'Flight, Hotel', 'P0', 'Cancel + wallet ledger', 'Staging', '', '', ''],
  ['D05', 'Wallet', 'Wallet webhook events', 'wallet.low_balance and wallet.topup.success payloads match guide (version, event, data)', 'Wallet', 'P1', 'Webhooks guide §5', 'Staging', '', '', ''],

  // E. Flight
  ['E01', 'Flight', 'Airport / airline / city search', 'Lookup APIs return usable codes for search body', 'Flight', 'P1', 'GET airports/airlines/cities', 'All', '', '', ''],
  ['E02', 'Flight', 'OW search complete', 'Search polls to COMPLETE; searchId present; filters (airline, maxStops, fareType) applied', 'Flight', 'P0', 'POST /v1/flights/search', 'All', '', '', ''],
  ['E03', 'Flight', 'RT search + return selection', 'Round-trip returns onward+return; selectedSearchIds flow works', 'Flight', 'P0', 'RT search', 'All', '', '', ''],
  ['E04', 'Flight', 'Fare types NORMAL vs CORPORATE', 'Both fareTypes return inventory where expected; corporate empty handled gracefully', 'Flight', 'P1', 'fareType', 'All', '', '', ''],
  ['E05', 'Flight', 'Pricing breakup', 'pricing has baseFare, taxes, fees, totalAmount, currency; sum matches total', 'Flight', 'P0', 'POST /v1/flights/pricing', 'All', '', '', ''],
  ['E06', 'Flight', 'GST breakup', 'gstBreakup codes (e.g. CGST07/SGST07) when provided; empty array acceptable if airline has none', 'Flight', 'P1', 'pricing.gstBreakup', 'Staging', '', '', ''],
  ['E07', 'Flight', 'Fare rules', 'fareRules returns cancel/change text; vendor failures return clear error (not silent)', 'Flight', 'P1', 'POST /v1/flights/fareRules', 'All', '', '', ''],
  ['E08', 'Flight', 'SSR meals/baggage', 'SSR catalog amounts selectable; issue includes SSR; confirmed salesSummary includes addon totals', 'Flight', 'P0', 'SSR + issue-ticket', 'Staging', '', '', ''],
  ['E09', 'Flight', 'Seatmap + paid seat', 'Seatmap loads; selected seat price matches booking detail seatPrice', 'Flight', 'P0', 'seatmap + issue', 'Staging', '', '', ''],
  ['E10', 'Flight', 'Issue ticket OW', 'issue-ticket → BR → poll status → Confirmed; PNR present', 'Flight', 'P0', 'POST /v1/flights/booking/issue-ticket', 'Staging', '', '', ''],
  ['E11', 'Flight', 'Issue ticket RT / multi-pax', '2 searchIds; adults+child+infant as scoped; passports when passportType FULL', 'Flight', 'P0', 'issueFlightTicket docs', 'Staging', '', '', ''],
  ['E12', 'Flight', 'Issue ticket documented errors', 'Cover 400/401/403/409/422/429 meanings vs live body codes (VALIDATION_ERROR, MISSING_HEADER, etc.)', 'Flight', 'P1', 'API docs Responses', 'Staging', '', '', ''],
  ['E13', 'Flight', 'Booking status polling', 'Pending/Inprogress → Confirmed/Failed/Cancelled; poll until terminal', 'Flight', 'P0', 'GET .../status', 'Staging', '', '', ''],
  ['E14', 'Flight', 'Booking detail product parity', 'Itinerary, pax, SSR, salesSummary match what was priced/issued', 'Flight', 'P0', 'GET .../booking/{BR}', 'Staging', '', '', ''],
  ['E15', 'Flight', 'Cancel penalty formula', 'PENALTY response: TotalPenalty = Airline/Riya + Convenience + CancellationFee + FlexiCancelFee (per agreed formula)', 'Flight', 'P0', 'cancel action PENALTY', 'Staging', '', '', ''],
  ['E16', 'Flight', 'Online cancel success', 'Refundable fare cancels online; status Cancelled; refund amount correct', 'Flight', 'P0', 'cancel CANCEL', 'Staging', '', '', ''],
  ['E17', 'Flight', 'Offline cancel message', 'Non-online-cancellable returns clear offline message; status remains Confirmed', 'Flight', 'P1', 'Vendor offline cancel', 'Staging', '', '', ''],
  ['E18', 'Flight', 'Booking history', 'History lists created bookings for partner/user', 'Flight', 'P2', 'History API', 'Staging', '', '', ''],
  ['E19', 'Flight', 'Flight webhooks', 'Receive booking.pending → confirmed/failed; cancel flow events; saleSummary.totalAmount = charged amount', 'Flight', 'P0', 'Webhooks guide §3', 'Staging', '', '', ''],

  // F. Hotel
  ['F01', 'Hotel', 'Autocomplete', 'City/hotel entityId returned for query', 'Hotel', 'P0', 'GET /v1/hotels/autocomplete', 'All', '', '', ''],
  ['F02', 'Hotel', 'Search list cancel summary', 'refundable + refundableNotes shown; no cancelPolicies ladder on city cards', 'Hotel', 'P0', 'POST /v1/hotels/search', 'All', '', '', ''],
  ['F03', 'Hotel', 'Details structured cancelPolicies', 'rooms[].cancelPolicies[] = {fromDate, chargeType, cancellationCharge}; benefitsIcon for UI', 'Hotel', 'P0', 'POST /v1/hotels/details', 'All', '', '', ''],
  ['F04', 'Hotel', 'Free-cancel room selection', 'Select room with current window charge 0%; notes match policy dates', 'Hotel', 'P0', 'Client testing rules sheet', 'Staging', '', '', ''],
  ['F05', 'Hotel', 'Non-refundable / percent ladder', '100% or partial % policies parse correctly; applicable charge by fromDate <= now', 'Hotel', 'P0', 'cancelPolicies', 'Staging', '', '', ''],
  ['F06', 'Hotel', 'Prebook hold', 'prebook with bookingCode+requestId → bookingContext; price lock', 'Hotel', 'P0', 'POST /v1/hotels/prebook', 'Staging', '', '', ''],
  ['F07', 'Hotel', 'Finalize booking', 'finalize with X-Partner-Key → BR Pending→Confirmed; guests match occupancy (no phantom child)', 'Hotel', 'P0', 'POST /v1/hotels/finalize-booking', 'Staging', '', '', ''],
  ['F08', 'Hotel', 'PAN mandatory', 'When isPANMandatory true, missing PAN rejected; when false optional', 'Hotel', 'P1', 'finalize docs', 'Staging', '', '', ''],
  ['F09', 'Hotel', 'Status + detail', 'Status Confirmed/Failed/Cancelled; detail salesSummary + roomDetails.cancelPolicies', 'Hotel', 'P0', 'GET bookings status/detail', 'Staging', '', '', ''],
  ['F10', 'Hotel', 'Cancel free window', 'Cancel within 0% window → totalCancellationCharge 0, full refund, Cancelled', 'Hotel', 'P0', 'GET .../cancel', 'Staging', '', '', ''],
  ['F11', 'Hotel', 'Cancel with penalty', 'Outside free window charge matches policy %; refund = total - charge', 'Hotel', 'P0', 'Cancel API', 'Staging', '', '', ''],
  ['F12', 'Hotel', 'Failed booking handling', 'If status Failed after finalize, no silent success; wallet reversed; error surfaced if available', 'Hotel', 'P0', 'Status Failed', 'Staging', '', '', ''],
  ['F13', 'Hotel', 'History', 'Booking appears in hotel history', 'Hotel', 'P2', 'History', 'Staging', '', '', ''],

  // G. Cab
  ['G01', 'Cab', 'Locations / places autocomplete', 'Airport/city/place search usable for pickup/drop', 'Cab', 'P0', 'Cabs Postman', 'Staging', '', '', ''],
  ['G02', 'Cab', 'Search + fare', 'Airport / outstation / rental search returns cabs + fare', 'Cab', 'P0', 'Cab search/fare', 'Staging', '', '', ''],
  ['G03', 'Cab', 'Finalize + status + cancel', 'Book → Confirmed → cancel/refund path per product rules', 'Cab', 'P0', 'Cab booking APIs', 'Staging', '', '', ''],
  ['G04', 'Cab', 'UI checklist parity', 'API covers items mapped from Cab QA Requirement Analysis (auth, fare, payment/wallet, webhooks, emails if in scope)', 'Cab', 'P1', 'Cab Booking Testing CSV', 'All', '', '', ''],

  // H. Other services
  ['H01', 'eSIM', 'Search → finalize → status', 'E2E book + duplicate/security checks as scoped', 'eSIM', 'P1', 'Postman Esim', 'Staging', '', '', ''],
  ['H02', 'Lounge', 'Availability → book → status', 'Terminal availability; book; validations', 'Lounge', 'P1', 'Postman Lounge', 'Staging', '', '', ''],
  ['H03', 'Fast Track', 'Availability → book → status', 'Same as lounge pattern', 'Fast Track', 'P1', 'Postman Fast Track', 'Staging', '', '', ''],
  ['H04', 'Attractions', 'Search/list/details → book', 'Availability + finalize + status/history', 'Attractions', 'P2', 'Postman Attractions', 'Staging', '', '', ''],
  ['H05', 'Porter', 'Airports → request → finalize', 'Porter flow completes; status/details', 'Porter', 'P2', 'Postman Porter', 'Staging', '', '', ''],

  // I. Webhooks (cross)
  ['I01', 'Webhooks', 'Envelope contract', 'version, event, timestamp, type, data present; route on event not data.status', 'Flight, Wallet', 'P0', 'Webhooks guide §1', 'Staging', '', '', ''],
  ['I02', 'Webhooks', 'booking.pending / confirmed / failed', 'Fired in order; PNR on confirmed; failed reverses debit', 'Flight', 'P0', 'Guide §3.1–3.3', 'Staging', '', '', ''],
  ['I03', 'Webhooks', 'Cancel webhook trio', 'cancellation_requested / cancelled / cancellation_failed semantics', 'Flight', 'P0', 'Guide §3.4–3.6', 'Staging', '', '', ''],
  ['I04', 'Webhooks', 'saleSummary reconciliation', 'Treat saleSummary.totalAmount as charged; refund.amount as credited; cancellationRequest is quote only', 'Flight', 'P0', 'Guide reconciliation rule', 'Staging', '', '', ''],
  ['I05', 'Webhooks', 'Timestamps & amounts', 'Envelope UTC Z; segment times local; amounts major units + currency', 'Flight, Wallet', 'P1', 'Guide conventions', 'Staging', '', '', ''],

  // J. Multi-currency
  ['J01', 'Multi-currency', 'Book in USD (flight)', 'Pricing currency USD; issue with currency USD; confirm', 'Flight', 'P0', 'currency=USD', 'Staging', '', '', ''],
  ['J02', 'Multi-currency', 'Book in USD (hotel)', 'Search/details/prebook/finalize currency USD; confirm', 'Hotel', 'P0', 'currency=USD', 'Staging', '', '', ''],
  ['J03', 'Multi-currency', 'Post-confirm currency integrity', 'GET status/detail with currency=USD still shows USD salesSummary; wallet debit = USD (or explicit FX)', 'Flight, Hotel', 'P0', 'Known defect report', 'Staging', '', '', ''],

  // K. Env / Release hygiene
  ['K01', 'Env Hygiene', 'Staging full E2E', 'Book+cancel allowed on staging for scoped services', 'All in scope', 'P0', 'Env matrix', 'Staging', '', '', ''],
  ['K02', 'Env Hygiene', 'Prod read-only default', 'Prod: search/details only unless approved; no accidental finalize/issue', 'All', 'P0', 'Prod safety', 'Prod', '', '', ''],
  ['K03', 'Env Hygiene', 'Credentials isolation', 'sk_test vs sk_live; staging vs prod partner secrets never mixed', 'All', 'P0', 'Env config', 'All', '', '', ''],
  ['K04', 'Env Hygiene', 'Postman env readiness', 'base_url, partner_id, secret, signing_key, tier_id populated per env', 'All', 'P0', 'Postman environment', 'All', '', '', ''],
  ['K05', 'Env Hygiene', 'Regression pack', 'Re-run P0 checklist after each release / client config change', 'All', 'P0', 'This checklist', 'All', '', '', ''],

  // L. Observability / Support
  ['L01', 'Supportability', 'BR traceability', 'Every booking yields BR; usable in status/detail/cancel/history', 'Bookable services', 'P0', 'BR pattern', 'Staging', '', '', ''],
  ['L02', 'Supportability', 'Error debuggability', 'Failed bookings expose actionable message/code when supplier fails', 'Flight, Hotel', 'P1', 'Failed status', 'Staging', '', '', ''],
  ['L03', 'Supportability', 'Mattermost / ops alerts', 'If client has ops alerts, verify booking events reach channel', 'All', 'P2', 'Ops', 'Preprod/Prod', '', '', ''],
];

sheet('2. High-Level API Checklist', rows, [8, 18, 42, 70, 28, 10, 36, 12, 12, 12, 28]);

// ========== 3) Service E2E Flows ==========
sheet('3. Service E2E Flows', [
  ['Service', 'Happy-path flow (high level)', 'Must-verify outputs', 'Cancel / Refund check', 'Priority'],
  ['Partner Auth', 'partner/token → session → tiers', 'access_token, auth_token, tiers list', 'N/A', 'P0'],
  ['Flight OW', 'search → pricing → (SSR/seat optional) → issue-ticket → status → detail', 'searchId, priceId, BR, Confirmed, PNR, salesSummary', 'PENALTY + CANCEL; formula + refund', 'P0'],
  ['Flight RT', 'search RT → select return → pricing → issue → status', '2 searchIds, both PNRs', 'RT cancel/penalty', 'P0'],
  ['Flight + Ancillaries', 'pricing → ssr/seatmap → issue with seat/meal/bag', 'Addon prices in confirmed salesSummary', 'Cancel with ancillaries per formula', 'P0'],
  ['Hotel free-cancel', 'autocomplete → search → details (0% policy) → prebook → finalize → status', 'BR Confirmed, cancelPolicies, salesSummary', 'Cancel in free window → charge 0', 'P0'],
  ['Hotel non-refundable / penalty', 'details room with 100% or timed ladder → book', 'Policy ladder structured', 'Cancel charge matches active %', 'P0'],
  ['Cab', 'places → search → fare → finalize → status', 'Fare quote vs booked amount', 'Cancel per cab rules', 'P0'],
  ['eSIM', 'search/plans → finalize → status', 'BR + activation fields', 'As scoped', 'P1'],
  ['Lounge / FastTrack', 'availability → book → status', 'Terminal + product match', 'As scoped', 'P1'],
  ['Attractions', 'search → details → availability → finalize', 'Product + amount', 'As scoped', 'P2'],
  ['Porter', 'airports → porters → submit → finalize', 'Request + BR', 'As scoped', 'P2'],
  ['Webhooks', 'Subscribe/receive during Flight book+cancel', 'event order + saleSummary amounts', 'cancelled / cancellation_failed', 'P0'],
  ['Multi-currency', 'Repeat Flight+Hotel book in USD', 'USD at price AND after confirm + wallet', 'Refund currency consistency', 'P0'],
], [22, 70, 50, 40, 10]);

// ========== 4) Priority legend / How to use ==========
sheet('4. How to Use', [
  ['How QA should use this checklist'],
  [],
  ['1', 'For each new client: copy this workbook, fill Sheet 1 (Project Setup).'],
  ['2', 'Mark Applicable Services on Sheet 1; hide/skip out-of-scope rows on Sheet 2 if needed (do not delete P0 Auth/Wallet/Currency/Idempotency).'],
  ['3', 'Execute Sheet 2 items by Priority: all P0 before signoff; P1 before go-live; P2 as capacity allows.'],
  ['4', 'Use Sheet 3 as smoke E2E scripts order in Postman / automation.'],
  ['5', 'Record Evidence: BR, request_id, correlation_id, screenshot/JSON path in Evidence column.'],
  ['6', 'QA Status values: Pass | Fail | Blocked | Waived | N/A'],
  ['7', 'Prod: default read-only. Book only with written approval.'],
  [],
  ['Priority', 'Meaning'],
  ['P0', 'Must pass for any client go-live / release signoff'],
  ['P1', 'Should pass before production traffic; can waive with risk note'],
  ['P2', 'Nice-to-have / regression depth'],
  [],
  ['Sources used to build this checklist'],
  ['Cab Booking Testing - QA Requirement Analysis.csv', 'Template structure (checkpoints, QA validation, statuses)'],
  ['https://api-docs.travelvip.ai', 'Flight issue-ticket / hotel finalize documented responses & headers'],
  ['TravelVIP-Webhooks-Integration-Guide-v1.pdf', 'Flight + wallet webhook catalogue and reconciliation rules'],
  ['Client Google Sheet – API Testing Rule tabs', 'Hotel free-cancel flow + product/API mapping'],
  ['Postman export_b2b', 'Services: Partner, Flight, Hotel, eSIM, Lounge, FastTrack, Attractions, Cabs, Porter'],
  ['Internal staging probes (Aug 2026)', 'Duplicate masking, name-change new BR, USD→INR salesSummary, WALLET_INSUFFICIENT_BALANCE, hotel cancelPolicies, flight GST breakup'],
], [12, 100]);

const out = path.resolve('docs/TravelVIP-B2B-API-High-Level-QA-Checklist.xlsx');
fs.mkdirSync(path.dirname(out), { recursive: true });
XLSX.writeFile(wb, out);
console.log('Wrote', out);
console.log('Sheets:', wb.SheetNames.join(' | '));
console.log('Checklist rows:', rows.length - 1);
