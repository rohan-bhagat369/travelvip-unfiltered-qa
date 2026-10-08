# Per-pax cancel — partial quote gap (shareable for Dev / docs)

**Env:** `https://canary-api.travelvip.ai`  
**Partner:** `vgm`  
**Endpoint:** `POST /v1/flights/booking/{bookingReference}/cancel?lang=en&currency=INR`  
**Session:** canary per-pax cancel pack (Aug 2026)

---

## Issue summary

| Item | Detail |
|---|---|
| **Title** | NORMAL partial-pax cancel: `penaltyBasis: NONE` — no amounts / no `perPax` |
| **Severity** | Product bug vs per-pax cancel spec (quote required when `penaltyQuotable: true`) |
| **Not** | Auth fail · old “Penalty Not Available” refuse · wrong HTTP (still 200) |
| **Is** | Request path opens (`PARTIAL_PAX` + `Cancellation Requested`), but **money quote empty** |
| **Works on** | **CORPORATE** subset — same request shape returns `PER_PAX_POLICY` + amounts + `perPax` |
| **Fails on** | **NORMAL** subset / multi-pax list |

---

## Scenario matrix (what we ran)

| # | Case | Trip | Stops | Pax | Fare | BR | PNR | Airline | Cancel list | Quote | Result |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **S2** subset 1 of 2 | **OW** | **Direct** | **2 ADT** | **NORMAL** | `BR1786567137397135` | `DZH9YQ` | 6E | `["PAX1"]` | empty / `NONE` | **BUG** |
| 2 | Multi-list 2 of 3 | **OW** | **Direct** | **3 ADT** | **NORMAL** | `BR1786572110107889` | `ZNFCQB` | 6E | `["PAX1","PAX2"]` | empty / `NONE` | **BUG** |
| 3 | Subset 1 of 2 (contrast) | **OW** | **Direct** | **2 ADT** | **CORPORATE** | `BR1786567896898911` | `W45UMH` | 6E | `["PAX1"]` | `PER_PAX_POLICY` + amounts | **PASS** |
| 4 | Sequential PAX1→PAX2 | **OW** | **Direct** | **2 ADT** | **CORPORATE** | `BR1786570951120374` | `KSKZ2J` | 6E | `["PAX1"]` then `["PAX2"]` | quoted | **PASS** |
| 5 | Multi-list then remaining | **OW** | **Direct** | **3 ADT** | **CORPORATE** | `BR1786572156401139` | `JZL8NQ` | 6E | `["PAX1","PAX2"]` then `["PAX3"]` | quoted | **PASS** |

**Trip notes**
- All rows above are **ONE_WAY · Direct (`maxStops: 0`)** — not RT, not connecting.
- Routes: S2 / CORP subset → **DEL→BOM**; NORMAL multi-list → **BOM→HYD** (6E).

---

## 1) BUG — S2 NORMAL · OW Direct · 2 ADT · cancel PAX1 only

| Meta | Value |
|---|---|
| Booking type | **OW · Direct** |
| Pax | **2 ADT** (cancel 1) |
| Fare | NORMAL |
| Route | DEL → BOM |
| BR / PNR | `BR1786567137397135` / `DZH9YQ` |

### PENALTY — request
```http
POST /v1/flights/booking/BR1786567137397135/cancel?lang=en&currency=INR
```
```json
{
  "retryCount": 2,
  "action": "PENALTY",
  "pnr": "DZH9YQ",
  "cancellationPaxList": ["PAX1"],
  "cancellationReason": "P0 S2"
}
```

### PENALTY — response (HTTP 200)
```json
{
  "status": 0,
  "statusMessage": "Success",
  "data": {
    "bookingReference": "BR1786567137397135",
    "pnr": "DZH9YQ",
    "cancellationRequest": {
      "status": "Penalty Fetched",
      "message": "No estimated cancellation and refund amount available"
    },
    "paxScope": {
      "scope": "PARTIAL_PAX",
      "cancellationPaxList": ["PAX1"],
      "totalPaxOnPnr": 2,
      "cancelledPaxCount": 1,
      "prorated": true,
      "penaltyQuotable": true,
      "penaltyBasis": "NONE"
    }
  }
}
```

### CANCEL — request
```json
{
  "retryCount": 2,
  "action": "CANCEL",
  "pnr": "DZH9YQ",
  "cancellationPaxList": ["PAX1"],
  "cancellationReason": "P0 S2"
}
```

### CANCEL — response (HTTP 200)
```json
{
  "status": 0,
  "statusMessage": "Success",
  "data": {
    "bookingReference": "BR1786567137397135",
    "pnr": "DZH9YQ",
    "cancellationRequest": {
      "status": "Cancellation Requested",
      "message": "No estimated cancellation and refund amount available"
    },
    "paxScope": {
      "scope": "PARTIAL_PAX",
      "cancellationPaxList": ["PAX1"],
      "totalPaxOnPnr": 2,
      "cancelledPaxCount": 1,
      "prorated": true,
      "penaltyQuotable": true,
      "penaltyBasis": "NONE"
    }
  }
}
```

**Missing vs expected:** `totalAmount`, `estimatedCancellationCharge`, `estimatedRefund`, `totalPenalty`, `perPax`.

---

## 2) BUG — NORMAL multi-list · OW Direct · 3 ADT · cancel PAX1+PAX2

| Meta | Value |
|---|---|
| Booking type | **OW · Direct** |
| Pax | **3 ADT** (cancel 2) |
| Fare | NORMAL |
| Route | BOM → HYD |
| BR / PNR | `BR1786572110107889` / `ZNFCQB` |
| Airline | 6E |

### PENALTY — request
```json
{
  "retryCount": 2,
  "action": "PENALTY",
  "pnr": "ZNFCQB",
  "cancellationPaxList": ["PAX1", "PAX2"],
  "cancellationReason": "multipax-list"
}
```

### PENALTY — response (HTTP 200)
```json
{
  "status": 0,
  "statusMessage": "Success",
  "data": {
    "bookingReference": "BR1786572110107889",
    "pnr": "ZNFCQB",
    "cancellationRequest": {
      "status": "Penalty Fetched",
      "message": "No estimated cancellation and refund amount available",
      "createdAt": "2026-08-12T22:01:55Z"
    },
    "paxScope": {
      "scope": "PARTIAL_PAX",
      "cancellationPaxList": ["PAX1", "PAX2"],
      "totalPaxOnPnr": 3,
      "cancelledPaxCount": 2,
      "prorated": true,
      "penaltyQuotable": true,
      "penaltyBasis": "NONE"
    }
  }
}
```

### CANCEL — request
```json
{
  "retryCount": 2,
  "action": "CANCEL",
  "pnr": "ZNFCQB",
  "cancellationPaxList": ["PAX1", "PAX2"],
  "cancellationReason": "multipax-list"
}
```

### CANCEL — response (HTTP 200)
```json
{
  "status": 0,
  "statusMessage": "Success",
  "data": {
    "bookingReference": "BR1786572110107889",
    "pnr": "ZNFCQB",
    "cancellationRequest": {
      "status": "Cancellation Requested",
      "message": "No estimated cancellation and refund amount available",
      "createdAt": "2026-08-12T22:01:57Z"
    },
    "paxScope": {
      "scope": "PARTIAL_PAX",
      "cancellationPaxList": ["PAX1", "PAX2"],
      "totalPaxOnPnr": 3,
      "cancelledPaxCount": 2,
      "prorated": true,
      "penaltyQuotable": true,
      "penaltyBasis": "NONE"
    }
  }
}
```

---

## 3) PASS contrast — CORPORATE subset · OW Direct · 2 ADT · cancel PAX1

| Meta | Value |
|---|---|
| Booking type | **OW · Direct** |
| Pax | **2 ADT** (cancel 1) |
| Fare | CORPORATE |
| Route | DEL → BOM |
| BR / PNR | `BR1786567896898911` / `W45UMH` |
| Airline | 6E 353 |

### CANCEL — request
```json
{
  "retryCount": 2,
  "action": "CANCEL",
  "pnr": "W45UMH",
  "cancellationPaxList": ["PAX1"]
}
```

### CANCEL — response (HTTP 200) — quote present
```json
{
  "status": 0,
  "statusMessage": "Success",
  "data": {
    "bookingReference": "BR1786567896898911",
    "pnr": "W45UMH",
    "cancellationRequest": {
      "status": "Cancellation Requested",
      "estimatedCancellationCharge": 849,
      "estimatedRefund": 3127,
      "totalAmount": 3976,
      "totalPenalty": 849,
      "perPax": {
        "paxCount": 2,
        "chargedPax": 1,
        "amount": 3976,
        "convenienceFee": 0,
        "ssr": 0,
        "flexiCancelFee": 0,
        "penalty": 499,
        "cancellationFee": 350,
        "refund": 3127,
        "penaltyBasis": "PER_PAX_POLICY"
      },
      "createdAt": "2026-08-12T20:52:08Z"
    },
    "paxScope": {
      "scope": "PARTIAL_PAX",
      "cancellationPaxList": ["PAX1"],
      "totalPaxOnPnr": 2,
      "cancelledPaxCount": 1,
      "prorated": true,
      "penaltyQuotable": true,
      "penaltyBasis": "PER_PAX_POLICY",
      "penaltyPerPax": 499,
      "chargedPax": 1
    }
  }
}
```

*(PENALTY on same BR returned the same amounts with `status: "Penalty Fetched"`.)*

---

## Expected vs actual (for docs)

| Field | Expected on partial PENALTY/CANCEL | NORMAL (BUG) | CORPORATE (PASS) |
|---|---|---|---|
| HTTP | 200 | 200 | 200 |
| `paxScope.scope` | `PARTIAL_PAX` | yes | yes |
| `penaltyQuotable` | `true` | yes | yes |
| `penaltyBasis` | policy / provider (not `NONE`) | **`NONE`** | `PER_PAX_POLICY` |
| `totalAmount` / charge / refund | present | **missing** | present |
| `perPax` | present | **missing** | present |
| Cancel status | `Cancellation Requested` | yes | yes |

---

## Eng ask

On **NORMAL** fares with `cancellationPaxList` subset: when provider has no partial penalty, fall back to TravelVIP FIXED/PERCENT + fee × `cancelledPaxCount` (same as CORPORATE `PER_PAX_POLICY` path) so partners get a quote, not only `penaltyBasis: NONE` + message.

---

## Source reports
- `reports/cancel-perpax-p0-canary.json` (S2)
- `reports/cancel-perpax-multipax-list.json` (NORMAL 3ADT)
- `reports/cancel-perpax-corporate-subset.json` (CORPORATE PASS contrast)
