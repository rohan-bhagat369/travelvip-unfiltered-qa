# Nova vs Canary — Full Flight/Hotel/Cab payload compare

**When:** 2026-11-25T09:28:25.963Z
**Node:** https://dev-nova-api.travelvip.ai
**Canary:** https://canary-api.travelvip.ai
**Partner:** vgm · tier 10546901
**Auth:** Node session 200 (ok) · product auth: native
**ALLOW_BOOK:** false

**Counts:** PASS 38 · WARN 1 · DIFF 1 · SKIPPED 3 · total 43

| Domain | Method | Path | Canary | Node | Verdict | Notes |
|--------|--------|------|--------|------|---------|-------|
| Flight | GET | `/v1/flights/airports` | 200 | 200 | **PASS** | collection_sample |
| Flight | GET | `/v1/flights/airlines` | 200 | 200 | **PASS** | collection_sample |
| Flight | POST | `/v1/flights/search` | 200 | 200 | **PASS** | live_dates |
| Flight | POST | `/v1/flights/details` | 200 | 200 | **PASS** | chained_from_node_search |
| Flight | POST | `/v1/flights/fareRules` | 200 | 200 | **PASS** | chained_from_node_search |
| Flight | POST | `/v1/flights/pricing` | 200 | 200 | **PASS** | chained_from_node_search |
| Flight | GET | `/v1/flights/citySearch` | 200 | 200 | **PASS** | collection_sample |
| Flight | POST | `/v1/flights/ssr` | 200 | 200 | **PASS** | chained_priceId |
| Flight | POST | `/v1/flights/seatmap` | 400/INVALID_BOOKING_CONTEXT | 400/INVALID_BOOKING_CONTEXT | **PASS** | chained_requestReference |
| Flight | POST | `/v1/flights/booking/issue-ticket` | — | — | SKIP | destructive_book_skipped (set ALLOW_BOOK=1 to run) |
| Flight | GET | `/v1/flights/booking/BR1780899837641078/status` | 200 | 200 | **PASS** | collection_sample |
| Flight | GET | `/v1/flights/booking/BR1780899837641078` | 200 | 200 | **PASS** | collection_sample |
| Flight | POST | `/v1/flights/booking/BR1779781570337478/cancel` | 404/BOOKING_NOT_FOUND | 404/BOOKING_NOT_FOUND | **PASS** | collection_sample |
| Flight | GET | `/v1/flights/bookings/history` | 200 | 200 | **PASS** | collection_sample |
| Flight | GET | `/v1/flights/booking/BR1781704967867885/status` | 404/BOOKING_NOT_FOUND | 404/BOOKING_NOT_FOUND | **PASS** | collection_sample |
| Flight | POST | `/v1/flights/booking/BR1781704967867885/cancel` | 404/BOOKING_NOT_FOUND | 404/BOOKING_NOT_FOUND | **PASS** | collection_sample |
| Flight | POST | `/v1/flights/booking/BR1781610251217353/cancel` | 400/VALIDATION_ERROR | 400/VALIDATION_ERROR | **PASS** | collection_sample |
| Hotel | GET | `/v1/hotels/autocomplete` | 200 | 200 | **PASS** | page0_mumbai |
| Hotel | POST | `/v1/hotels/search` | 200 | 200 | **WARN** | live_city_mumbai; shapeDiffs=2 |
| Hotel | POST | `/v1/hotels/details` | 200 | 200 | **PASS** | collection_entity |
| Hotel | POST | `/v1/hotels/prebook` | 200 | 200 | **PASS** | stale_collection_prebook_ids |
| Hotel | POST | `/v1/hotels/finalize-booking` | — | — | SKIP | destructive_book_skipped (set ALLOW_BOOK=1 to run) |
| Hotel | GET | `/v1/hotels/bookings/BR1780927298861865/status` | 200 | 200 | **PASS** | collection_sample |
| Hotel | GET | `/v1/hotels/bookings/BR1780401783100852` | 200 | 200 | **PASS** | collection_sample |
| Hotel | GET | `/v1/hotels/bookings/history` | 200 | 500 | **DIFF** | collection_sample; shapeDiffs=6; status mismatch |
| Hotel | GET | `/v1/hotels/bookings/BR1786362382728480/cancel` | 404/BOOKING_NOT_FOUND | 404/BOOKING_NOT_FOUND | **PASS** | collection_sample |
| Cab | GET | `/v1/airportServices/cabs/locations` | 200 | 200 | **PASS** | collection_sample |
| Cab | POST | `/v1/airportServices/cabs/search` | 200 | 200 | **PASS** | live_rental |
| Cab | POST | `/v1/airportServices/cabs/fare` | 200 | 200 | **PASS** | chained_cab_searchId |
| Cab | POST | `/v1/airportServices/cabs/finalize-booking` | — | — | SKIP | destructive_book_skipped (set ALLOW_BOOK=1 to run) |
| Cab | GET | `/v1/airportServices/cabs/BR1784017077801203/status` | 404/BOOKING_NOT_FOUND | 404/BOOKING_NOT_FOUND | **PASS** | collection_sample |
| Cab | GET | `/v1/airportServices/cabs/booking/history` | 200 | 200 | **PASS** | collection_sample |
| Cab | GET | `/v1/airportServices/cabs/booking/BR1783685806152267` | 404/BOOKING_NOT_FOUND | 404/BOOKING_NOT_FOUND | **PASS** | collection_sample |
| Cab | GET | `/v1/airportServices/cabs/tracking/BR1783677028336676/location` | 404/BOOKING_NOT_FOUND | 404/BOOKING_NOT_FOUND | **PASS** | collection_sample |
| Cab | GET | `/v1/airportServices/cabs/bookings/BR1783955419703179/cancel` | 404/BOOKING_NOT_FOUND | 404/BOOKING_NOT_FOUND | **PASS** | collection_sample |
| Flight | POST | `/v1/flight/updateBooking` | 404/BOOKING_NOT_FOUND | 404/BOOKING_NOT_FOUND | **PASS** | callback_ops_sample |
| Hotel | POST | `/api/v1/hotels/updateHotelBooking` | 400/VALIDATION_ERROR | 400/VALIDATION_ERROR | **PASS** | callback_ops_sample |
| Cab | POST | `/v1/airportServices/cabs/update-booking` | 404/BOOKING_NOT_FOUND | 404/BOOKING_NOT_FOUND | **PASS** | callback_ops_sample |
| Cab | POST | `/v1/airportServices/cabs/partner-webhook` | 401/INVALID_WEBHOOK_CREDENTIALS | 401/INVALID_WEBHOOK_CREDENTIALS | **PASS** | collection_sample |
| Flight | POST | `/v1/flights/booking/request-action` | 401 | 401 | **PASS** | collection_sample |
| Flight | POST | `/v1/flights/booking/supplier-recovery` | 401 | 401 | **PASS** | collection_sample |
| Flight | POST | `/v1/flights/booking/protection-action` | 401 | 401 | **PASS** | collection_sample |
| Hotel | POST | `/v1/hotels/booking/request-action` | 401 | 401 | **PASS** | collection_sample |

## Request payload keys checked

- `POST /v1/flights/search`: `itinerary`, `travellers`, `cabinClass`, `journeyType`, `currency`, `language`, `preferences`, `appliedFilters`, `selection`
- `POST /v1/flights/details`: `journeyType`, `selection`
- `POST /v1/flights/fareRules`: `journeyType`, `selection`
- `POST /v1/flights/pricing`: `journeyType`, `selection`
- `POST /v1/flights/ssr`: `priceId`
- `POST /v1/flights/seatmap`: `currency`, `requestReference`, `passengers`
- `POST /v1/flights/booking/issue-ticket`: `type`, `currency`, `language`, `bookingReference`, `searchIds`, `journeyType`, `timezone`, `data`
- `POST /v1/flights/booking/BR1779781570337478/cancel`: `action`, `retryCount`
- `POST /v1/flights/booking/BR1781704967867885/cancel`: `action`, `retryCount`
- `POST /v1/flights/booking/BR1781610251217353/cancel`: `action`, `retryCount`
- `POST /v1/hotels/search`: `checkin`, `checkout`, `entityId`, `nationality`, `type`, `rooms`
- `POST /v1/hotels/details`: `checkin`, `checkout`, `entityId`, `nationality`, `rooms`
- `POST /v1/hotels/prebook`: `bookingCode`, `requestId`
- `POST /v1/hotels/finalize-booking`: `bookingContext`, `checkin`, `checkout`, `requestId`, `rooms`, `contact`
- `POST /v1/airportServices/cabs/search`: `journeyType`, `travelType`, `pickup`, `drop`, `distanceKm`, `durationMin`, `pickupDatetime`
- `POST /v1/airportServices/cabs/fare`: `searchId`
- `POST /v1/airportServices/cabs/finalize-booking`: `bookingReference`, `priceId`, `passengers`, `contact`, `otherDetails`
- `POST /v1/flight/updateBooking`: `bookingRefId`, `status`, `pnr`, `onwardPNR`, `returnPNR`, `bookingId`
- `POST /api/v1/hotels/updateHotelBooking`: `status`, `ClientReferenceId`, `ConfirmationNumber`, `message`
- `POST /v1/airportServices/cabs/update-booking`: `bookingRefId`, `bookingId`, `status`, `otp`, `assignment`
- `POST /v1/airportServices/cabs/partner-webhook`: `eventName`, `bookingId`, `bookingInfo`
- `POST /v1/flights/booking/request-action`: `bookingRefId`, `action`, `refund`, `actorRef`, `remarks`
- `POST /v1/flights/booking/supplier-recovery`: `bookingRefId`, `provider`, `amount`, `providerReference`, `note`, `actorRef`
- `POST /v1/flights/booking/protection-action`: `bookingRefId`, `bookingItemId`, `action`, `reason`, `actorRef`
- `POST /v1/hotels/booking/request-action`: `bookingRefId`, `action`, `refund`, `actorRef`, `remarks`

## DIFF / WARN detail

### WARN — POST /v1/hotels/search
- Canary: 200  
- Node: 200  
- Shape: message:missing_in_node, filters:type_mismatch

### DIFF — GET /v1/hotels/bookings/history
- Canary: 200  
- Node: 500  
- Shape: totalCount:missing_in_node, page:missing_in_node, perPage:missing_in_node, bookings:missing_in_node, _meta:missing_in_node, info:extra_in_node
