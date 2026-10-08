# Hotel Cancellation Policies — API Guide

**Environment:** Dev / Staging  
**Base URL:** `https://api-staging.travelvip.ai`  
**Query params:** `lang=en`, `currency=INR`

Cancellation policy is returned on **Hotel Search** and **Hotel Details**. There is **no separate** cancellation-policy endpoint.

---

## 1. Hotel Search (list screen)

**Endpoint:** `POST /v1/hotels/search`

Use these fields to show cancel info on the hotel card:

| Field | Type | Description |
|--------|------|-------------|
| `refundable` | boolean | `true` = cancellable / free-cancel window exists; `false` = non-refundable |
| `refundableNotes` | string[] | Human-readable text for UI (e.g. free-cancel deadline) |

### Example — free cancellation

```json
{
  "id": "2943014",
  "name": "Hotel Basera",
  "refundable": true,
  "refundableNotes": [
    "Free cancellation before 27-08-2026"
  ],
  "price": {
    "totalAmount": 3911.47,
    "currency": "INR"
  }
}
```

### Example — non-refundable

```json
{
  "id": "2688620",
  "name": "Rutugandh Heritage",
  "refundable": false,
  "refundableNotes": [],
  "price": {
    "totalAmount": 3820.51,
    "currency": "INR"
  }
}
```

### UI suggestion (search list)

- Show `refundableNotes[0]` when present.
- Otherwise, if `refundable === false`, show **Non-refundable**.

> **Note:** The full penalty timeline (`cancelPolicies`) is **not** on the city search card. It comes from **Hotel Details**.

---

## 2. Hotel Details (room selection screen)

**Endpoint:** `POST /v1/hotels/details`

Per room, use:

| Field | Type | Description |
|--------|------|-------------|
| `rooms[].refundable` | boolean | Room-level refundable flag |
| `rooms[].refundableNotes` | string[] | Free-cancel text for that room |
| `rooms[].cancelPolicies` | array | Timed cancellation charge ladder |
| `rooms[].benefitsIcon` | array | Ready-made UI label + icon URL |

### `cancelPolicies` object

| Field | Type | Description |
|--------|------|-------------|
| `fromDate` | string | Policy window start — format `DD-MM-YYYY HH:mm:ss` |
| `chargeType` | string | `"Percent"` — charge is % of booking amount |
| `cancellationCharge` | number | Percentage charged if cancelled on/after `fromDate` |

Policies are ordered by date. The **active** rule is the latest `fromDate` that is **≤ current date/time**.

### Example — free cancel, then partial, then full penalty

```json
{
  "name": ["Deluxe Double room (full double bed)", "non-smoking"],
  "refundable": true,
  "refundableNotes": [
    "Free cancellation before 27-08-2026"
  ],
  "cancelPolicies": [
    {
      "fromDate": "03-08-2026 00:00:00",
      "chargeType": "Percent",
      "cancellationCharge": 0
    },
    {
      "fromDate": "27-08-2026 00:00:00",
      "chargeType": "Percent",
      "cancellationCharge": 48.84
    },
    {
      "fromDate": "28-08-2026 00:00:00",
      "chargeType": "Percent",
      "cancellationCharge": 100
    }
  ],
  "benefitsIcon": [
    {
      "key": "Free cancellation before 27-08-2026",
      "value": "https://img.travelx.ai/Hotel_Amenities/Refundable.svg"
    }
  ]
}
```

**How to read this for the guest:**

| Window | Charge |
|--------|--------|
| From **03-Aug** until **27-Aug 00:00** | **0%** (free cancel) |
| From **27-Aug** | **48.84%** cancellation charge |
| From **28-Aug** | **100%** cancellation charge |

### Example — free cancel then 100%

```json
{
  "refundable": true,
  "refundableNotes": ["Free cancellation before 26-08-2026"],
  "cancelPolicies": [
    {
      "fromDate": "03-08-2026 00:00:00",
      "chargeType": "Percent",
      "cancellationCharge": 0
    },
    {
      "fromDate": "26-08-2026 00:00:00",
      "chargeType": "Percent",
      "cancellationCharge": 100
    }
  ],
  "benefitsIcon": [
    {
      "key": "Free cancellation before 26-08-2026",
      "value": "https://img.travelx.ai/Hotel_Amenities/Refundable.svg"
    }
  ]
}
```

### Example — non-refundable

```json
{
  "refundable": false,
  "refundableNotes": [],
  "cancelPolicies": [
    {
      "fromDate": "03-08-2026 00:00:00",
      "chargeType": "Percent",
      "cancellationCharge": 100
    }
  ],
  "benefitsIcon": [
    {
      "key": "Non-Refundable",
      "value": "https://img.travelx.ai/Hotel_Amenities/Refundable.svg"
    }
  ]
}
```

### UI suggestion (room card)

1. Show chip from `benefitsIcon` (`key` + icon `value`), **or**
2. Show `refundableNotes[0]`, **and**
3. Optionally show the full `cancelPolicies` timeline as a small table (From date → Charge %)

---

## 3. After booking / cancel execution

### Booking detail

**Endpoint:** `GET /v1/hotels/bookings/{bookingReference}`

Policy may appear under `roomDetails.cancelPolicies` (same shape as details).

### Cancel booking

**Endpoint:** `GET /v1/hotels/bookings/{bookingReference}/cancel`

This returns **actual money impact**, not the policy ladder:

| Field | Description |
|--------|-------------|
| `result.totalPrice` | Original booking amount |
| `result.totalCancellationCharge` | Charge applied |
| `result.totalRefund` | Refund amount |
| `result.currency` | e.g. `INR` |

---

## 4. Recommended client display logic

1. **Search list:** use `refundable` + `refundableNotes`
2. **Room select:** use `refundableNotes` / `benefitsIcon` + optional full `cancelPolicies` ladder
3. **Compute current penalty %:** latest policy where `fromDate ≤ now` → use `cancellationCharge`
4. **On cancel:** show values from cancel API (`totalCancellationCharge`, `totalRefund`)

---

## 5. Important notes for integration

- `chargeType` observed: **`Percent`** only (percentage of booking).
- `fromDate` format: **`DD-MM-YYYY HH:mm:ss`**.
- Charges can be **0**, **partial** (e.g. 48.84), or **100**.
- Search list is summary only; **details** has the full timeline.
- Policy text dates and `cancelPolicies` windows should be shown as returned by the API (do not invent deadlines).

---

## Document info

| Item | Value |
|------|--------|
| Prepared for | Client / partner integration |
| API environment | Dev / Staging |
| Base URL | `https://api-staging.travelvip.ai` |
| Last verified | 2026-08-03 |
