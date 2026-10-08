# TravelVIP B2B — QA Booking Flow Guide (Postman)

**For:** QA team · **Products:** Hotel, Flight, Cab  
**Base URL (staging):** `https://api-staging.travelvip.ai`  
**Postman collection:** `postman/TravelVIP-Dynamic-Flights-Hotels.postman_collection.json`  
**Environment:** `postman/B2B Dev.postman_environment.json`

---

## Before you start (one time)

1. Import **collection** + **environment** in Postman.
2. Fill environment variables:
   - `base_url`, `partner_id`, `partner_secret`, `signing_key`, `tier_id`
3. Run **Auth** folder in order:
   - **Partner Token** → saves `access_token`
   - **User Auth (Session)** → saves `auth_token`
4. Pin one **`correlation_id`** for the whole session (do not change mid-flow).

### Headers used everywhere

| Header | Value | When |
|--------|-------|------|
| `Authorization` | `Bearer {{auth_token}}` | All product APIs |
| `X-Partner-Key` | `{{access_token}}` | Hotel finalize, Flight issue-ticket, Cab finalize/cancel |
| `X-Correlation-ID` | `{{correlation_id}}` | All calls (same ID) |
| `X-Signature`, `X-Timestamp`, `X-Request-Id` | Auto from collection | POST bodies (signed) |

---

## Quick cheat sheet — what to copy where

```
HOTEL:   details.requestId + details.bookingCode → prebook → finalize → status(BR)
FLIGHT:  search.searchId → pricing → issue-ticket → status(BR)
CAB:     search.searchId → fare → finalize → status(BR)
```

---

# HOTEL booking flow

```
Auth → Search → Details → Prebook → Finalize → Status
```

## Step 0 — Auth (same for all products)

| Step | API | Save from response |
|------|-----|-------------------|
| 0a | `POST /auth/partner/token` | `access_token` |
| 0b | `POST /v1/auth/session` + header `X-Partner-Key: access_token` | `auth_token` |

---

## Step 1 — Search

**`POST /v1/hotels/search`** · Query: `pid=vgm`, `lang=en`, `currency=INR`

**Body (example):**
```json
{
  "checkin": "2026-09-23",
  "checkout": "2026-09-24",
  "entityId": "39627872",
  "nationality": "IN",
  "type": "HOTEL",
  "rooms": [{ "adults": 1, "children": 0, "childAges": [] }]
}
```

| Copy to next step | From response |
|-------------------|---------------|
| Same dates + entity + rooms | Use same values in **Details** and **Finalize** |
| *(optional)* `requestId` | May appear — **do not use for book**; use Details `requestId` instead |

**Test hotel:** Hilltop Mumbai · `entityId = 39627872`

---

## Step 2 — Details

**`POST /v1/hotels/details`** · Query: `pid=vgm`

**Body:** Same as Search **without** `"type"` field.

| Copy to next step | From response |
|-------------------|---------------|
| **`requestId`** | Top-level `requestId` → **Prebook** + **Finalize** |
| **`bookingCode`** | `results[0].rooms[0].bookingCode` → **Prebook** + **Finalize** |

> **Important:** Always use **Details** `requestId`, not Search `requestId`.

---

## Step 3 — Prebook

**`POST /v1/hotels/prebook`**

**Body:**
```json
{
  "bookingCode": "<from Details>",
  "requestId": "<from Details>"
}
```

| Copy to next step | From response |
|-------------------|---------------|
| **`bookingContext`** | `bookingContext` → **Finalize** |

---

## Step 4 — Finalize (BOOK — live)

**`POST /v1/hotels/finalize-booking`** · Query: `pid=vgm`  
**Extra header:** `X-Partner-Key: {{access_token}}`

**Body (key fields):**
```json
{
  "bookingContext": "<from Prebook>",
  "bookingCode": "<from Details>",
  "requestId": "<from Details>",
  "checkin": "<same as Search>",
  "checkout": "<same as Search>",
  "rooms": [{
    "guests": [{
      "title": "Mr", "firstName": "Rohan", "lastName": "Bhagat",
      "type": "Adult", "isLead": true, "gender": "Male"
    }]
  }],
  "contact": {
    "email": "qa.test@example.com",
    "mobile": "9876543210",
    "countryCode": "+91",
    "panCardNumber": "EUIPB1672M",
    "panCardName": "Rohan Bhagat"
  }
}
```

| Copy to next step | From response |
|-------------------|---------------|
| **`bookingRefId`** | `bookingRefId` or `bookingReferenceId` → **Status** |

---

## Step 5 — Booking status

**`GET /v1/hotels/bookings/{{bookingRefId}}/status`**

Poll until status = **Confirmed**, **Failed**, or **Inprogress** (do not stop on Pending).

---

# FLIGHT booking flow

```
Auth → Search (poll) → Details → Pricing → Issue-ticket → Status
```

## Step 1 — Search

**`POST /v1/flights/search`** · Query: `sortby=fare,asc`

**Body (OW example DEL→BOM):**
```json
{
  "itinerary": [{ "origin": "DEL", "destination": "BOM", "date": "2026-09-15" }],
  "travellers": { "adults": 1, "children": 0, "infants": 0 },
  "cabinClass": "ECONOMY",
  "journeyType": "ONE_WAY",
  "currency": "INR",
  "language": "en",
  "fareType": "CORPORATE"
}
```

**Poll** until search completes and options appear.

| Copy to next step | From response |
|-------------------|---------------|
| **`searchId`** | `results[ONWARD].options[0].searchId` → all next steps |

For **Round Trip:** copy **two** IDs (ONWARD + RETURN).

---

## Step 2 — Details

**`POST /v1/flights/details`**

```json
{
  "journeyType": "ONE_WAY",
  "selection": { "selectedSearchIds": ["<searchId>"] }
}
```

Same `searchId` reused — mainly for itinerary display. No new ID required for book.

---

## Step 3 — Pricing

**`POST /v1/flights/pricing`**

```json
{
  "journeyType": "ONE_WAY",
  "selection": { "selectedSearchIds": ["<searchId>"] }
}
```

| Copy to next step | From response |
|-------------------|---------------|
| **`priceId`** | `priceId` → **Issue-ticket** |
| **`bookingContext`** | `bookingContext` → **Issue-ticket** as `bookingReference` |

---

## Step 4 — Issue ticket (BOOK — live)

**`POST /api/v2/flights/booking/issue-ticket`**  
**Extra header:** `X-Partner-Key: {{access_token}}`

```json
{
  "type": "ticket",
  "currency": "INR",
  "language": "en",
  "timezone": "Asia/Calcutta",
  "journeyType": "ONE_WAY",
  "bookingReference": "<pricing.bookingContext>",
  "searchIds": ["<searchId>"],
  "data": {
    "priceId": "<pricing.priceId>",
    "passportType": "NONE",
    "includeGst": false,
    "contact": {
      "email": "qa.test@example.com",
      "mobile": "9876543210",
      "countryCode": "+91"
    },
    "passengers": [{
      "paxId": "1",
      "type": "ADULT",
      "isLead": true,
      "profile": {
        "title": "Mr", "firstName": "Rohan", "lastName": "Bhagat",
        "gender": "Male", "dateOfBirth": "1990-01-15", "nationality": "IN"
      },
      "city": { "cityCode": "DEL", "cityName": "New Delhi" },
      "passport": { "type": "NONE" }
    }]
  }
}
```

> Note: field name is **`bookingReference`** but value comes from **`pricing.bookingContext`**.

| Copy to next step | From response |
|-------------------|---------------|
| **`bookingReference`** | `bookingReference` or `bookingReferenceId` → **Status** |

---

## Step 5 — Booking status

**`GET /v1/flights/booking/{{bookingReference}}/status`**

Poll until **Confirmed**, **Inprogress**, **Failed**, or **Cancelled**.

---

# CAB booking flow

```
Auth → Search → Fare → Finalize → Status
```

## Step 1 — Search

**`POST /v1/airportServices/cabs/search`**

**AIRPORT departure example (DEL):**
```json
{
  "journeyType": "AIRPORT",
  "travelType": "DEPARTURE",
  "airportCode": "DEL",
  "pickupDatetime": "2026-09-20T10:00:00+05:30",
  "distanceKm": 25,
  "durationMin": 45,
  "pickup": { "latitude": 28.5562, "longitude": 77.1000, "address": "Home, Delhi" },
  "drop": { "latitude": 28.5562, "longitude": 77.1000, "address": "DEL Airport" }
}
```

| Copy to next step | From response |
|-------------------|---------------|
| **`searchId`** | Pick a cab with tag **RECOMMENDED** → `cabs[].searchId` → **Fare** |

---

## Step 2 — Fare

**`POST /v1/airportServices/cabs/fare`**

```json
{ "searchId": "<from Cab Search>" }
```

| Copy to next step | From response |
|-------------------|---------------|
| **`bookingReference`** | `bookingReference` → **Finalize** |
| **`priceId`** | `priceId` → **Finalize** |

---

## Step 3 — Finalize (BOOK — live)

**`POST /v1/airportServices/cabs/finalize-booking`**  
**Extra header:** `X-Partner-Key: {{access_token}}`

```json
{
  "bookingReference": "<from Fare>",
  "priceId": "<from Fare>",
  "passengers": [{
    "title": "Mr", "firstName": "Rohan", "lastName": "Bhagat",
    "email": "qa.test@example.com", "mobile": "9876543210", "isLead": true
  }],
  "contact": {
    "email": "qa.test@example.com",
    "mobile": "9876543210", "countryCode": "+91"
  },
  "otherDetails": { "flightNumber": "AI101", "remarks": "QA test" }
}
```

| Copy to next step | From response |
|-------------------|---------------|
| **`bookingRefId`** | `bookingRefId` → **Status** |

---

## Step 4 — Booking status

**`GET /v1/airportServices/cabs/{{bookingRefId}}/status`**

---

# One-page summary table

| Product | Step 1 → 2 | Step 2 → 3 | Step 3 → 4 (Book) | After book |
|---------|------------|------------|-------------------|------------|
| **Hotel** | Search → Details: same body | Details → Prebook: `requestId`, `bookingCode` | Prebook → Finalize: `bookingContext` | `bookingRefId` → status |
| **Flight** | Search → Pricing: `searchId` | Pricing → Issue: `priceId`, `bookingContext` | Issue-ticket (needs X-Partner-Key) | `bookingReference` → status |
| **Cab** | Search → Fare: `searchId` | Fare → Finalize: `bookingReference`, `priceId` | Finalize (needs X-Partner-Key) | `bookingRefId` → status |

---

# Postman tips for QA

1. **Run top to bottom** inside each scenario folder — collection scripts auto-save variables.
2. **Do not reuse** old `requestId` / `bookingCode` / `priceId` — they expire.
3. **Hotel:** if finalize stays Inprogress, that BR cannot be used for price/cancel tests.
4. **Flight:** issue-ticket books a **live ticket** on staging — use only when needed.
5. **Cab:** finalize books live — cancel after test if required.
6. **Secrets:** never commit `partner_secret` or `signing_key` to git.

---

*Generated for TravelVIP B2B QA · Staging default · Update dates/entityId for your test data.*
