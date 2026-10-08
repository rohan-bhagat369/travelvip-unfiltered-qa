/**
 * Single-tab API QA Requirement Analysis — same format as Cab UI sheet.
 * Columns: Checkpoint | Value from PRD / API | QA Validation / Notes | Dev Status | Comments | QA Status
 *
 *   node scripts/generate-api-qa-requirement-analysis.js
 */
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const H = ['Checkpoint', 'Value from PRD / API', 'QA Validation / Notes', 'Dev Status', 'Comments', 'QA Status'];
const r = (checkpoint, value = '', qa = '', dev = '', comments = '', status = '') => [
  checkpoint, value, qa, dev, comments, status,
];

const rows = [
  H,
  r('Sprint/ Release Version', 'Phase 1 / Version- 1.0', 'Confirm release tag before signoff'),
  r('Project Name', 'Travel VIP B2B API', 'Verify partner/project naming in configs & docs'),
  r('PID', '', 'Confirm partner_id for target env'),
  r('Partner Name', '', 'Verify partner-specific wallet, tier, rate limits'),
  r('Partner Logo', '', 'N/A for pure API; verify if any branding fields returned'),
  r('Project Scope', 'B2B API integration (Flight, Hotel, Cab, eSIM, Lounge, FastTrack, Attractions, Porter)', 'Confirm in-scope services per client before execution'),
  r('ENV', 'DEV / Staging / Preprod / Prod', 'Prod = read-only by default (no book unless approved)'),
  r('Base URL', 'Staging: https://api-staging.travelvip.ai | Prod: https://api.travelvip.ai', 'Point Postman/env to correct base URL'),
  r('Project Owner Name', 'Travel VIP Product / Partner Success', 'Confirm owner for approvals & signoff'),
  r('Services Covered', 'Partner Auth, Flight, Hotel, Cabs, eSIM, Lounge, Fast Track, Attractions, Porter', 'Validate complete API lifecycle for each in-scope service'),
  r('Currency', 'INR (default); also USD / AED as required', 'Verify fare calculations, salesSummary currency & wallet debit currency'),
  r('Language', 'English (lang=en)', 'Confirm lang query param consistency'),
  r('Platform', 'API / Postman / Client backend integration', 'Validate request/response contracts (not UI)'),
  r('Requirements', 'API docs + Webhooks guide + Client API testing rules', 'Ensure all modules in scope are covered'),
  r('Acceptance Criteria', 'All mandatory API checklist items Pass or Waived with risk note', 'Verify against API docs & client rules'),
  r('Objective', 'Validate complete API booking lifecycle per service', 'Search → price/book → status → cancel/refund → webhooks/wallet'),
  r('Authentication', 'Partner token + User session + HMAC (X-Signature/X-Timestamp) + X-Partner-Key on wallet APIs', 'Verify token issue/refresh, session, signature, missing/invalid auth failures'),
  r('API Docs', 'https://api-docs.travelvip.ai', 'Validate against published request/response & error codes'),
  r('Webhooks Guide', 'TravelVIP-Webhooks-Integration-Guide-v1.pdf', 'Verify flight + wallet event payloads & reconciliation rules'),
  r('Postman Collection', 'export_b2b + environment', 'Collection & env vars ready before execution'),
  r('Test Cases', 'High-level API checklist (this sheet)', 'Cover positive, negative, security, multi-currency, cancel/refund'),
  r('API', 'TravelVIP B2B Partner APIs', 'Validate request/response, headers, error handling, idempotency'),
  r('To Be Automated', 'WIP', 'Map mandatory items to automation suite over time'),
  r('Issue Reporting', 'Sheet / tracker', 'Log defects with BR, correlation_id, request payload snippet'),
  r('Tier Config', 'Lite / Premium / Sapphire (as applicable)', 'Verify markup/discount/convenience fee in pricing & salesSummary'),
  r('Impacted Areas', 'Auth, Wallet, Flight, Hotel, Cab, Ancillary, Webhooks', 'Perform regression after each release'),
  r('Category Description', 'API integration QA (generic client checklist)', 'Reuse for any new client onboarding'),
  r('Terms & Conditions', '', 'Verify client T&Cs if linked to API booking product'),
  r('Privacy Policy', '', 'Verify before release if in scope'),
  r('How It Works', 'Service-wise API E2E flows', 'Validate end-to-end API journey per service'),
  r('Payment Type', 'Partner wallet debit (B2B)', 'Verify debit on book, reverse on fail, credit on cancel/refund'),
  r('DB Testing', 'Booking, Wallet ledger, Refund records (if accessible)', 'Validate data consistency vs API status/detail'),
  r('Webhooks / Logs', 'booking.pending/confirmed/failed/cancellation_*; wallet.low_balance; wallet.topup.success', 'Verify payloads, event order, saleSummary amounts'),
  r('Emails', 'As scoped for client (confirmation, cancel, refund)', 'Verify if email triggers are in API/client scope'),
  r('Mattermost Booking Alerts', '', 'Verify ops alerts if configured for client'),
  r('Customer Support', 'TBD', 'Verify ownership and escalation with BR + correlation_id'),
  r('Support Channel', 'Email / WhatsApp / Ops dashboard', 'Verify notifications and routing if in scope'),
  r('Dashboard', 'Travel VIP Operational Dashboard / Wallet ledger', 'Validate queues, reports, wallet ledger vs API amounts'),
  r('QA Signoff', '', 'Sign after all mandatory API checks Pass/Waived'),
  r(''),

  // Auth
  r('Auth — Partner token', 'POST /auth/partner/token', 'Valid partner_id/secret → access_token; invalid rejected'),
  r('Auth — Refresh token', 'POST /auth/partner/refresh', 'Refresh works; expired refresh rejected'),
  r('Auth — User session', 'POST /v1/auth/session', 'Valid tierId → auth_token (Bearer for APIs)'),
  r('Auth — Tiers', 'GET /v1/tiers', 'Expected tiers returned for partner'),
  r('Auth — Missing/invalid Bearer', 'Any protected API', 'Returns 401/403; no booking created'),
  r('Auth — HMAC signature', 'X-Signature + X-Timestamp on signed APIs', 'Valid accepted; tampered body/wrong key/skewed timestamp rejected'),
  r('Auth — Correlation headers', 'X-Request-Id + X-Correlation-ID', 'Echoed in _meta.correlation_id across flow'),
  r('Auth — X-Partner-Key (wallet APIs)', 'Flight issue-ticket + Hotel finalize-booking', 'Required; missing → MISSING_HEADER; invalid → INVALID_ACCESS_TOKEN'),
  r(''),

  // Common contract
  r('API Contract — Success schema', 'Per endpoint OpenAPI samples', 'Response matches docs; do not trust HTTP 200 alone (errors may be in body)'),
  r('API Contract — Error envelope', 'error.code / code / status + message', 'Stable codes for validation & business failures'),
  r('API Contract — currency & lang', 'Query currency + lang', 'Honored on search/pricing; amounts in requested currency at book time'),
  r('API Contract — Required fields', 'Missing/empty required body fields', 'VALIDATION_ERROR or clear status:400; not silent success'),
  r('API Contract — Invalid IDs', 'Invalid searchId/priceId/bookingCode/bookingContext', 'Rejected or fails safely (no wrong Confirmed booking)'),
  r('API Contract — Rate limit', 'HTTP 429', 'Documented behaviour; client retries with backoff'),
  r(''),

  // Security / idempotency
  r('Security — Exact payload retry', 'Same issue/finalize payload + idempotency', 'Returns duplicate / same BR; no second wallet debit'),
  r('Security — Invalid payload not masked as duplicate', 'Bad/invalid booking payload', 'Must return validation/business error — NOT only Duplicate payload message'),
  r('Security — Name-only change', 'Change only passenger/guest firstName', 'Must NOT create uncontrolled new booking (block or explicit new intent)'),
  r('Security — Same requestId different payload', 'Reuse requestId with changed body', 'Behaviour documented & consistent (reject / new BR / duplicate)'),
  r(''),

  // Wallet
  r('Wallet — Sufficient balance book', 'Issue ticket / finalize booking', 'Debits wallet; walletBalanceRemaining returned where documented'),
  r('Wallet — Insufficient balance', 'code WALLET_INSUFFICIENT_BALANCE', 'Returns available + required; no Confirmed booking'),
  r('Wallet — Failed booking reverse', 'booking.failed / status Failed', 'Debit reversed in full (API + webhook + ledger)'),
  r('Wallet — Cancel refund credit', 'Successful cancel', 'Wallet credited net refund = cancel API totalRefund'),
  r('Wallet — Webhooks', 'wallet.low_balance, wallet.topup.success', 'Payload matches Webhooks guide v1'),
  r(''),

  // Multi-currency
  r('Multi-currency — Book in USD (Flight)', 'search/pricing/issue with currency=USD', 'Pricing breakup in USD; booking Confirmed'),
  r('Multi-currency — Book in USD (Hotel)', 'search/details/prebook/finalize currency=USD', 'Price breakup in USD; booking Confirmed'),
  r('Multi-currency — Post-confirm integrity', 'GET status/detail ?currency=USD', 'salesSummary stays USD; wallet debit matches USD OR explicit FX fields (no silent INR swap)'),
  r(''),

  // Flight
  r('Flight — Airport/Airline/City lookup', 'GET airports / airlines / cities', 'Codes usable in search body'),
  r('Flight — OW search', 'POST /v1/flights/search (ONE_WAY)', 'Polls to COMPLETE; searchId present; airline/maxStops/fareType filters work'),
  r('Flight — RT search', 'POST /v1/flights/search (ROUND_TRIP)', 'Onward + return; selectedSearchIds flow works'),
  r('Flight — Fare type NORMAL/CORPORATE', 'fareType in search', 'Inventory returned where expected; empty corporate handled gracefully'),
  r('Flight — Pricing breakup', 'POST /v1/flights/pricing', 'baseFare + taxes + fees = totalAmount; currency correct'),
  r('Flight — GST breakup', 'pricing.gstBreakup', 'Codes like CGST07/SGST07 when provided; empty array OK if none'),
  r('Flight — Fare rules', 'POST /v1/flights/fareRules', 'Cancel/change text returned; vendor errors clear'),
  r('Flight — SSR meals/baggage', 'POST /v1/flights/ssr + issue-ticket', 'Catalog amounts selectable; confirmed salesSummary includes addons'),
  r('Flight — Seatmap + paid seat', 'POST /v1/flights/seatmap + issue', 'Seat price matches booking detail seatPrice'),
  r('Flight — Issue ticket OW', 'POST /v1/flights/booking/issue-ticket', 'BR created → poll → Confirmed; PNR present; X-Partner-Key set'),
  r('Flight — Issue ticket RT / multi-pax', 'RT searchIds + adults/child/infant', 'Passports when passportType FULL; all pax confirmed'),
  r('Flight — Issue error codes', 'Docs 400/401/403/409/422/429', 'Live body codes checked (VALIDATION_ERROR, MISSING_HEADER, INVALID_ACCESS_TOKEN, etc.)'),
  r('Flight — Booking status', 'GET /v1/flights/booking/{BR}/status', 'Pending/Inprogress → Confirmed/Failed/Cancelled'),
  r('Flight — Booking detail', 'GET /v1/flights/booking/{BR}', 'Itinerary, pax, SSR, salesSummary match priced/issued'),
  r('Flight — Cancel penalty', 'POST cancel action=PENALTY', 'TotalPenalty = Airline/Riya + Convenience + CancellationFee + FlexiCancelFee'),
  r('Flight — Online cancel', 'POST cancel action=CANCEL', 'Refundable fare → Cancelled; refund amount correct'),
  r('Flight — Offline cancel message', 'Non-online-cancellable PNR', 'Clear offline message; status remains Confirmed'),
  r('Flight — Booking history', 'Flight booking history API', 'Created bookings listed'),
  r('Flight — Webhooks', 'booking.pending/confirmed/failed/cancellation_*', 'Event order correct; saleSummary.totalAmount = charged amount'),
  r(''),

  // Hotel
  r('Hotel — Autocomplete', 'GET /v1/hotels/autocomplete', 'City/hotel entityId returned'),
  r('Hotel — Search list cancel summary', 'POST /v1/hotels/search', 'refundable + refundableNotes; no cancelPolicies ladder on city cards'),
  r('Hotel — Details cancelPolicies', 'POST /v1/hotels/details', 'rooms[].cancelPolicies {fromDate, chargeType, cancellationCharge}; benefitsIcon'),
  r('Hotel — Free-cancel room select', 'cancelPolicies current window 0%', 'Select room in free window; notes match policy dates'),
  r('Hotel — Non-refundable / % ladder', 'cancellationCharge 100 or partial', 'Applicable charge by fromDate <= now'),
  r('Hotel — Prebook', 'POST /v1/hotels/prebook', 'bookingCode + requestId → bookingContext; price locked'),
  r('Hotel — Finalize booking', 'POST /v1/hotels/finalize-booking', 'X-Partner-Key required; BR Pending→Confirmed; guests match occupancy (no phantom child)'),
  r('Hotel — PAN mandatory', 'isPANMandatory on prebook room', 'true → PAN required; false → optional'),
  r('Hotel — Status + detail', 'GET /v1/hotels/bookings/{BR}/status & /{BR}', 'Confirmed/Failed/Cancelled; salesSummary + roomDetails.cancelPolicies'),
  r('Hotel — Cancel free window', 'GET .../cancel within 0%', 'totalCancellationCharge=0; full refund; Cancelled'),
  r('Hotel — Cancel with penalty', 'Cancel outside free window', 'Charge matches active %; refund = total - charge'),
  r('Hotel — Failed booking handling', 'status Failed after finalize', 'No silent success; wallet reversed; error surfaced if available'),
  r('Hotel — History', 'Hotel booking history', 'Booking appears in history'),
  r('Hotel — Client free-cancel rule flow', 'Taj Dubai style API testing rule', 'autocomplete→search→details(0%)→prebook→finalize→cancel 0% (per client sheet)'),
  r(''),

  // Cab
  r('Cab — Places / locations', 'Cabs autocomplete/places APIs', 'Pickup/drop entities usable'),
  r('Cab — Search + fare', 'Airport / outstation / rental search + fare', 'Quote returned; fare fields consistent'),
  r('Cab — Finalize + status + cancel', 'Cab finalize-booking → status → cancel', 'Book Confirmed; cancel/refund per product rules'),
  r('Cab — Parity with UI QA sheet', 'Cab Booking Testing QA Requirement Analysis', 'API covers auth, fare, wallet/payment, webhooks, emails if in scope'),
  r(''),

  // Other
  r('eSIM — E2E', 'search/plans → finalize → status', 'BR + product fields; duplicate/security as scoped'),
  r('Lounge — E2E', 'availability → book → status', 'Terminal + product match'),
  r('Fast Track — E2E', 'availability → book → status', 'Same pattern as lounge'),
  r('Attractions — E2E', 'search → details → availability → finalize', 'Product + amount correct'),
  r('Porter — E2E', 'airports → porters → submit → finalize', 'Request + BR + status/details'),
  r(''),

  // Webhooks
  r('Webhooks — Envelope', 'version, event, timestamp, type, data', 'Route on event (not data.status); version=1'),
  r('Webhooks — Flight book events', 'pending → confirmed/failed', 'PNR on confirmed; failed reverses debit'),
  r('Webhooks — Flight cancel events', 'cancellation_requested / cancelled / cancellation_failed', 'Semantics match guide; cancelled credits refund'),
  r('Webhooks — saleSummary reconciliation', 'saleSummary.totalAmount / refund.amount', 'totalAmount=charged; refund.amount=credited; cancellationRequest is quote only'),
  r('Webhooks — Conventions', 'UTC Z timestamps; local segment times; major-unit amounts', 'Parse correctly; ignore unknown additive keys'),
  r(''),

  // Env
  r('Env — Staging full E2E', 'https://api-staging.travelvip.ai', 'Book+cancel allowed for scoped services'),
  r('Env — Prod safety', 'https://api.travelvip.ai', 'Search/details only unless written approval to book'),
  r('Env — Credential isolation', 'sk_test vs sk_live; staging vs prod secrets', 'Never mix credentials across envs'),
  r('Env — Postman readiness', 'base_url, partner_id, secret, signing_key, tier_id', 'Env populated before run'),
  r('Env — Regression pack', 'This checklist mandatory items', 'Re-run after each release / client config change'),
  r(''),

  // Support
  r('Support — BR traceability', 'bookingReference / bookingRefId', 'Usable in status, detail, cancel, history'),
  r('Support — Error debuggability', 'Failed bookings', 'Actionable code/message when supplier fails'),
  r('Support — Evidence capture', 'BR + correlation_id + request_id + JSON snippet', 'Attach on every Fail/Blocked item'),
  r(''),

  // Footer like cab sheet
  r('Dev Login URL-'),
  r('Mob Number-'),
  r('OTP-'),
  r('Preprod Login URL-'),
  r('Mob Number-'),
  r('OTP-'),
  r('Staging Base URL-', 'https://api-staging.travelvip.ai'),
  r('Prod Base URL-', 'https://api.travelvip.ai'),
  r('Partner ID-'),
  r('Signing Key env-', 'sk_test_* / sk_live_*'),
  r('QA Signoff Name / Date-'),
];

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet(rows);
ws['!cols'] = [
  { wch: 52 },
  { wch: 72 },
  { wch: 80 },
  { wch: 14 },
  { wch: 24 },
  { wch: 12 },
];
XLSX.utils.book_append_sheet(wb, ws, 'QA Requirement Analysis');

const outDir = path.resolve('docs');
fs.mkdirSync(outDir, { recursive: true });
const outXlsx = path.join(outDir, 'TravelVIP-B2B-API-QA-Requirement-Analysis.xlsx');
const outCsv = path.join(outDir, 'TravelVIP-B2B-API-QA-Requirement-Analysis.csv');
XLSX.writeFile(wb, outXlsx);

const csvLines = rows.map((row) => row.map((cell) => {
  const s = String(cell ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}).join(','));
fs.writeFileSync(outCsv, csvLines.join('\n'), 'utf8');

console.log('Wrote', outXlsx);
console.log('Wrote', outCsv);
console.log('Data rows:', rows.length - 1);
