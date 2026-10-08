# TravelVIP B2B — Dynamic Postman E2E

## Files (regenerate with `npm run postman:build`)

| File | Contents |
|---|---|
| **`TravelVIP-Dynamic-Flights-Hotels.postman_collection.json`** | Flights + Hotels + **Cabs** (recommended import) |
| **`TravelVIP-Hotel-Search-Filters-Chain-Brand.postman_collection.json`** | Hotel search filters: Chain / Brand / **Property Type** + meal-type details (search/details only) |
| `TravelVIP-Dynamic-Flights.postman_collection.json` | Flights only |
| `TravelVIP-Dynamic-Cabs.postman_collection.json` | Cabs only (AIRPORT / OUTSTATION / RENTAL) |
| `B2B Dev.postman_environment.json` or `TravelVIP-B2B-Dev.postman_environment.json` | Environment |

Builder: `travel-apis/flight/scripts/build-dynamic-flight-hotel-postman-collection.js` (`npm run postman:build`)

### Share / invalid signature
Collection alone often has empty `signing_key`. Recipients need the **environment** with staging `signing_key` set. Local share pack (gitignored): `postman/share/`. Formula: `HMAC-SHA256(body + timestamp, signing_key)`.

Legacy single-product collections (`TravelVIP-Flights-Hotels-Updated.postman_collection.json`, `Cab.postman_collection.json`) are superseded by the dynamic collections above.

## Setup

1. Import collection + environment
2. Fill env: `base_url`, `partner_id`, `partner_secret`, `signing_key`, `tier_id`
3. Run **Partner Api** (or **0. Auth** in cab-only collection):
   - 01 Access Token → saves `access_token` / `refresh_token`
   - 03 User Auth → saves `auth_token` (Bearer for product APIs)
4. Open a scenario folder → run requests top → bottom

## Auth rules

- **Bearer** = `auth_token` (User Auth)
- **X-Partner-Key** = `access_token` (Partner Access Token) on flight issue-ticket, hotel finalize, **cab finalize + cancel**

## Structure (Flights + Hotels + Cabs)

```
Partner Api / 0. Auth
1–4. Flight scenarios (OW/RT, connecting, SSR, paxwise cancel)
5. Hotels (search → details → prebook → finalize → cancel)
6. Cabs
   6.A Reference (locations, places autocomplete)
   6.B Scenarios
       AIRPORT DEPARTURE (DEL)
       AIRPORT ARRIVAL (DEL)
       OUTSTATION (Pune)
       RENTAL (Pune)
       each: search → fare → finalize → status → detail → history → tracking → cancel
```

## Cab collection variables (auto-saved by tests)

| Variable | Set by |
|---|---|
| `cab_search_id` | Cab Search |
| `cab_fare_booking_reference`, `cab_price_id` | Cab Fare |
| `cab_booking_reference`, `cab_booking_status` | Finalize / Status |
| `cab_contact_email` | Finalize pre-request (unique email) |

**Note:** Cab finalize books live on staging. Cancel currently returns HTTP 200 with body `status: 400` on staging (known product issue).
