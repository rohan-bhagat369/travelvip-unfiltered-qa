# TravelVIP B2B — Flight per-passenger cancel
## Working cases (latest ~2 hours) — request & response

| | |
|---|---|
| Environment | `https://canary-api.travelvip.ai` |
| Partner | `vgm` |
| Endpoint | `POST /v1/flights/booking/{bookingReference}/cancel?lang=en&currency=INR` |
| Window | **2026-08-13 ≈ 03:00–03:45 IST** (latest pack only) |
| Scope | Verified **PASS** end-to-end working scenarios from this window |

## Index

| # | Ran (IST) | Scenario | Trip | Stops | Pax | BR |
|---|---|---|---|---|---|---|
| 1 | 2026-08-13 03:02 IST | Full cancel with SSR withheld (meal + baggage) | **OW** | **Direct** | **1 ADT** | `BR1786570315695002` |
| 2 | 2026-08-13 03:12 IST | Sequential partial cancel — PAX1 then PAX2 | **OW** | **Direct** | **2 ADT** | `BR1786570951120374` |
| 3 | 2026-08-13 03:17 IST | Full PNR cancel — 1 ADT (PENALTY → CANCEL) | **OW** | **Direct** | **1 ADT** | `BR1786561773208289` |
| 4 | 2026-08-13 03:22 IST | RT cancel return only — onward already cancelled | **RT** | **Direct** | **2 ADT** | `BR1786568422897124` |
| 5 | 2026-08-13 03:31–03:34 IST | Multi-pax list — cancel PAX1+PAX2 of 3 ADT | **OW** | **Direct** | **3 ADT** | `BR1786572156401139` |
| 6 | 2026-08-13 03:34 IST | Remaining pax after multi-list — PAX3 of 3 | **OW** | **Direct** | **3 ADT** | `BR1786572156401139` |
| 7 | 2026-08-13 03:35 IST | Full PNR cancel — 3 ADT | **OW** | **Direct** | **3 ADT** | `BR1786572337739872` |
| 8 | 2026-08-13 03:37 IST | Cancel all passengers via list — 2 ADT | **OW** | **Direct** | **2 ADT** | `BR1786572460100067` |

---

## Case 1. Full cancel with SSR withheld (meal + baggage)

| Field | Value |
|---|---|
| Ran at | 2026-08-13 03:02 IST |
| Trip type | **OW** |
| Stops | **Direct** |
| Passengers | **1 ADT** |
| Cancel scope | Full PNR (no cancellationPaxList) |
| Fare type | NORMAL |
| Route | BOM-BLR |
| Airline | 6E |
| Booking reference | `BR1786570315695002` |
| PNR | `P2B8WN` |
| onlineCancellation | true |
| Result | PASS — Cancelled; SSR ₹2420 in charge (not refunded) |
| SSR | Booked SSR ₹2420 (meal 320 + bag 2100) |

### PENALTY request
```json
{
  "retryCount": 2,
  "action": "PENALTY",
  "pnr": "P2B8WN",
  "cancellationReason": "SSR withheld"
}
```

### PENALTY response (HTTP 200)
```json
{
  "status": 0,
  "statusMessage": "Success",
  "data": {
    "bookingReference": "BR1786570315695002",
    "pnr": "P2B8WN",
    "cancellationRequest": {
      "status": "Penalty Fetched",
      "estimatedCancellationCharge": 3770,
      "estimatedRefund": 473,
      "totalAmount": 4243,
      "totalPenalty": 1350,
      "perPax": {
        "paxCount": 1,
        "chargedPax": 1,
        "amount": 1823,
        "convenienceFee": 0,
        "ssr": 2420,
        "flexiCancelFee": 0,
        "penalty": 1000,
        "cancellationFee": 350,
        "refund": 473,
        "penaltyBasis": "PROVIDER"
      },
      "createdAt": "2026-08-12T21:32:01Z"
    }
  }
}
```

### CANCEL request
```json
{
  "retryCount": 2,
  "action": "CANCEL",
  "pnr": "P2B8WN",
  "cancellationReason": "SSR withheld"
}
```

### CANCEL response (HTTP 200)
```json
{
  "status": 0,
  "statusMessage": "Success",
  "data": {
    "bookingReference": "BR1786570315695002",
    "pnr": "P2B8WN",
    "cancellationRequest": {
      "status": "Cancelled",
      "estimatedCancellationCharge": 3769,
      "estimatedRefund": 2894,
      "totalAmount": 6663,
      "totalPenalty": 1349,
      "perPax": {
        "paxCount": 1,
        "chargedPax": 1,
        "amount": 4243,
        "convenienceFee": 0,
        "ssr": 2420,
        "flexiCancelFee": 0,
        "penalty": 999,
        "cancellationFee": 350,
        "refund": 2894,
        "penaltyBasis": "PROVIDER"
      },
      "createdAt": "2026-08-12T21:32:02Z"
    },
    "refundSummary": {
      "amount": 2894,
      "cancellationCharge": 3769,
      "totalPenalty": 1349,
      "cancellationChargeBreakup": {
        "airlineCancellationFee": 999,
        "convenienceFee": 0,
        "serviceFee": 350,
        "flexicancelFee": 0,
        "ssrCharge": 2420
      }
    },
    "transaction": {
      "id": "615",
      "amount": 2894,
      "currency": "INR",
      "paymentMethod": "wallet",
      "type": "refund",
      "status": "success",
      "createdAt": "2026-08-12T21:32:09Z",
      "completedAt": "2026-08-12T21:32:09Z"
    }
  }
}
```

---

## Case 2. Sequential partial cancel — PAX1 then PAX2

| Field | Value |
|---|---|
| Ran at | 2026-08-13 03:12 IST |
| Trip type | **OW** |
| Stops | **Direct** |
| Passengers | **2 ADT** |
| Cancel scope | Step1 ["PAX1"] then Step2 ["PAX2"] |
| Fare type | CORPORATE |
| Route | DEL-BOM |
| Airline | 6E |
| Booking reference | `BR1786570951120374` |
| PNR | `KSKZ2J` |
| onlineCancellation | true |
| Result | PASS — both steps Cancellation Requested with quotes |

### Step 1 — cancel PAX1

**PENALTY request**
```json
{
  "retryCount": 2,
  "action": "PENALTY",
  "pnr": "KSKZ2J",
  "cancellationPaxList": [
    "PAX1"
  ],
  "cancellationReason": "seq PAX1"
}
```

**PENALTY response (HTTP 200)**
```json
{
  "status": 0,
  "statusMessage": "Success",
  "data": {
    "bookingReference": "BR1786570951120374",
    "pnr": "KSKZ2J",
    "cancellationRequest": {
      "status": "Penalty Fetched",
      "estimatedCancellationCharge": 849,
      "estimatedRefund": 3127,
      "totalAmount": 3976,
      "totalPenalty": 849,
      "penaltyBasis": "PER_PAX_POLICY",
      "amount": 3976,
      "convenienceFee": 0,
      "ssr": 0,
      "flexiCancelFee": 0,
      "penalty": 499,
      "cancellationFee": 350,
      "perPax": [
        {
          "paxId": "PAX1",
          "amount": 3976,
          "convenienceFee": 0,
          "ssr": 0,
          "flexiCancelFee": 0,
          "penalty": 499,
          "cancellationFee": 350,
          "totalPenalty": 849,
          "refund": 3127,
          "ssrPerPassenger": false
        }
      ],
      "createdAt": "2026-08-12T21:42:40Z"
    },
    "paxScope": {
      "scope": "PARTIAL_PAX",
      "cancellationPaxList": [
        "PAX1"
      ],
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

**CANCEL request**
```json
{
  "retryCount": 2,
  "action": "CANCEL",
  "pnr": "KSKZ2J",
  "cancellationPaxList": [
    "PAX1"
  ],
  "cancellationReason": "seq PAX1"
}
```

**CANCEL response (HTTP 200)**
```json
{
  "status": 0,
  "statusMessage": "Success",
  "data": {
    "bookingReference": "BR1786570951120374",
    "pnr": "KSKZ2J",
    "cancellationRequest": {
      "status": "Cancellation Requested",
      "estimatedCancellationCharge": 849,
      "estimatedRefund": 3127,
      "totalAmount": 3976,
      "totalPenalty": 849,
      "penaltyBasis": "PER_PAX_POLICY",
      "amount": 3976,
      "convenienceFee": 0,
      "ssr": 0,
      "flexiCancelFee": 0,
      "penalty": 499,
      "cancellationFee": 350,
      "perPax": [
        {
          "paxId": "PAX1",
          "amount": 3976,
          "convenienceFee": 0,
          "ssr": 0,
          "flexiCancelFee": 0,
          "penalty": 499,
          "cancellationFee": 350,
          "totalPenalty": 849,
          "refund": 3127,
          "ssrPerPassenger": false
        }
      ],
      "createdAt": "2026-08-12T21:42:41Z"
    },
    "paxScope": {
      "scope": "PARTIAL_PAX",
      "cancellationPaxList": [
        "PAX1"
      ],
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

### Step 2 — cancel PAX2

**PENALTY request**
```json
{
  "retryCount": 2,
  "action": "PENALTY",
  "pnr": "KSKZ2J",
  "cancellationPaxList": [
    "PAX2"
  ],
  "cancellationReason": "seq PAX2"
}
```

**PENALTY response (HTTP 200)**
```json
{
  "status": 0,
  "statusMessage": "Success",
  "data": {
    "bookingReference": "BR1786570951120374",
    "pnr": "KSKZ2J",
    "cancellationRequest": {
      "status": "Penalty Fetched",
      "estimatedCancellationCharge": 849,
      "estimatedRefund": 3127,
      "totalAmount": 3976,
      "totalPenalty": 849,
      "penaltyBasis": "PER_PAX_POLICY",
      "amount": 3976,
      "convenienceFee": 0,
      "ssr": 0,
      "flexiCancelFee": 0,
      "penalty": 499,
      "cancellationFee": 350,
      "perPax": [
        {
          "paxId": "PAX2",
          "amount": 3976,
          "convenienceFee": 0,
          "ssr": 0,
          "flexiCancelFee": 0,
          "penalty": 499,
          "cancellationFee": 350,
          "totalPenalty": 849,
          "refund": 3127,
          "ssrPerPassenger": false
        }
      ],
      "createdAt": "2026-08-12T21:42:44Z"
    },
    "paxScope": {
      "scope": "PARTIAL_PAX",
      "cancellationPaxList": [
        "PAX2"
      ],
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

**CANCEL request**
```json
{
  "retryCount": 2,
  "action": "CANCEL",
  "pnr": "KSKZ2J",
  "cancellationPaxList": [
    "PAX2"
  ],
  "cancellationReason": "seq PAX2"
}
```

**CANCEL response (HTTP 200)**
```json
{
  "status": 0,
  "statusMessage": "Success",
  "data": {
    "bookingReference": "BR1786570951120374",
    "pnr": "KSKZ2J",
    "cancellationRequest": {
      "status": "Cancellation Requested",
      "estimatedCancellationCharge": 849,
      "estimatedRefund": 3127,
      "totalAmount": 3976,
      "totalPenalty": 849,
      "penaltyBasis": "PER_PAX_POLICY",
      "amount": 3976,
      "convenienceFee": 0,
      "ssr": 0,
      "flexiCancelFee": 0,
      "penalty": 499,
      "cancellationFee": 350,
      "perPax": [
        {
          "paxId": "PAX2",
          "amount": 3976,
          "convenienceFee": 0,
          "ssr": 0,
          "flexiCancelFee": 0,
          "penalty": 499,
          "cancellationFee": 350,
          "totalPenalty": 849,
          "refund": 3127,
          "ssrPerPassenger": false
        }
      ],
      "createdAt": "2026-08-12T21:42:45Z"
    },
    "paxScope": {
      "scope": "PARTIAL_PAX",
      "cancellationPaxList": [
        "PAX2"
      ],
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

---

## Case 3. Full PNR cancel — 1 ADT (PENALTY → CANCEL)

| Field | Value |
|---|---|
| Ran at | 2026-08-13 03:17 IST |
| Trip type | **OW** |
| Stops | **Direct** |
| Passengers | **1 ADT** |
| Cancel scope | Full PNR (no cancellationPaxList) |
| Fare type | NORMAL |
| Route | DEL-BOM |
| Airline | 6E |
| Booking reference | `BR1786561773208289` |
| PNR | `HVEW5Q` |
| onlineCancellation | true |
| Result | PASS — Cancelled |

### PENALTY request
```json
{
  "retryCount": 2,
  "action": "PENALTY",
  "pnr": "HVEW5Q",
  "cancellationReason": "N1"
}
```

### PENALTY response (HTTP 200)
```json
{
  "status": 0,
  "statusMessage": "Success",
  "data": {
    "bookingReference": "BR1786561773208289",
    "pnr": "HVEW5Q",
    "cancellationRequest": {
      "status": "Penalty Fetched",
      "estimatedCancellationCharge": 1350,
      "estimatedRefund": 1317,
      "totalAmount": 2667,
      "totalPenalty": 1350,
      "penaltyBasis": "PROVIDER",
      "amount": 2667,
      "convenienceFee": 0,
      "ssr": 0,
      "flexiCancelFee": 0,
      "penalty": 1000,
      "cancellationFee": 350,
      "perPax": [
        {
          "paxId": "PAX1",
          "amount": 2667,
          "convenienceFee": 0,
          "ssr": 0,
          "flexiCancelFee": 0,
          "penalty": 1000,
          "cancellationFee": 350,
          "totalPenalty": 1350,
          "refund": 1317,
          "ssrPerPassenger": false
        }
      ],
      "createdAt": "2026-08-12T21:47:21Z"
    }
  }
}
```

### CANCEL request
```json
{
  "retryCount": 2,
  "action": "CANCEL",
  "pnr": "HVEW5Q",
  "cancellationReason": "N1"
}
```

### CANCEL response (HTTP 200)
```json
{
  "status": 0,
  "statusMessage": "Success",
  "data": {
    "bookingReference": "BR1786561773208289",
    "pnr": "HVEW5Q",
    "cancellationRequest": {
      "status": "Cancelled",
      "estimatedCancellationCharge": 1349,
      "estimatedRefund": 1318,
      "totalAmount": 2667,
      "totalPenalty": 1349,
      "penaltyBasis": "PROVIDER",
      "amount": 2667,
      "convenienceFee": 0,
      "ssr": 0,
      "flexiCancelFee": 0,
      "penalty": 999,
      "cancellationFee": 350,
      "perPax": [
        {
          "paxId": "PAX1",
          "amount": 2667,
          "convenienceFee": 0,
          "ssr": 0,
          "flexiCancelFee": 0,
          "penalty": 999,
          "cancellationFee": 350,
          "totalPenalty": 1349,
          "refund": 1318,
          "ssrPerPassenger": false
        }
      ],
      "createdAt": "2026-08-12T21:47:22Z"
    },
    "refundSummary": {
      "amount": 1318,
      "cancellationCharge": 1349,
      "totalPenalty": 1349,
      "cancellationChargeBreakup": {
        "airlineCancellationFee": 999,
        "convenienceFee": 0,
        "serviceFee": 350,
        "flexicancelFee": 0
      }
    },
    "transaction": {
      "id": "616",
      "amount": 1318,
      "currency": "INR",
      "paymentMethod": "wallet",
      "type": "refund",
      "status": "success",
      "createdAt": "2026-08-12T21:47:37Z",
      "completedAt": "2026-08-12T21:47:37Z"
    }
  }
}
```

---

## Case 4. RT cancel return only — onward already cancelled

| Field | Value |
|---|---|
| Ran at | 2026-08-13 03:22 IST |
| Trip type | **RT** |
| Stops | **Direct** |
| Passengers | **2 ADT** |
| Cancel scope | Return PNR only (FR71YC) |
| Fare type | CORPORATE |
| Route | DEL-BOM (round trip) |
| Airline | 6E |
| Booking reference | `BR1786568422897124` |
| PNR | `FR71YC` |
| Onward PNR | `G122SA` |
| onlineCancellation | true |
| Result | PASS — Cancelled |

### PENALTY request
```json
{
  "retryCount": 2,
  "action": "PENALTY",
  "pnr": "FR71YC",
  "cancellationReason": "S5-complete 6E return"
}
```

### PENALTY response (HTTP 200)
```json
{
  "status": 0,
  "statusMessage": "Success",
  "data": {
    "bookingReference": "BR1786568422897124",
    "pnr": "FR71YC",
    "cancellationRequest": {
      "status": "Penalty Fetched",
      "estimatedCancellationCharge": 1700,
      "estimatedRefund": 14268,
      "totalAmount": 15968,
      "totalPenalty": 1700,
      "penaltyBasis": "PROVIDER",
      "amount": 15968,
      "convenienceFee": 0,
      "ssr": 0,
      "flexiCancelFee": 0,
      "penalty": 1000,
      "cancellationFee": 700,
      "perPax": [
        {
          "paxId": "PAX1",
          "amount": 7984,
          "convenienceFee": 0,
          "ssr": 0,
          "flexiCancelFee": 0,
          "penalty": 500,
          "cancellationFee": 350,
          "totalPenalty": 850,
          "refund": 7134,
          "ssrPerPassenger": false
        },
        {
          "paxId": "PAX2",
          "amount": 7984,
          "convenienceFee": 0,
          "ssr": 0,
          "flexiCancelFee": 0,
          "penalty": 500,
          "cancellationFee": 350,
          "totalPenalty": 850,
          "refund": 7134,
          "ssrPerPassenger": false
        }
      ],
      "createdAt": "2026-08-12T21:51:01Z"
    }
  }
}
```

### CANCEL request
```json
{
  "retryCount": 2,
  "action": "CANCEL",
  "pnr": "FR71YC",
  "cancellationReason": "S5-complete 6E return"
}
```

### CANCEL response (HTTP 200)
```json
{
  "status": 0,
  "statusMessage": "Success",
  "data": {
    "bookingReference": "BR1786568422897124",
    "pnr": "FR71YC",
    "cancellationRequest": {
      "status": "Cancelled",
      "estimatedCancellationCharge": 2698,
      "estimatedRefund": 5318,
      "totalAmount": 8016,
      "totalPenalty": 2698,
      "penaltyBasis": "PROVIDER",
      "amount": 8016,
      "convenienceFee": 0,
      "ssr": 0,
      "flexiCancelFee": 0,
      "penalty": 1998,
      "cancellationFee": 700,
      "perPax": [
        {
          "paxId": "PAX1",
          "amount": 4008,
          "convenienceFee": 0,
          "ssr": 0,
          "flexiCancelFee": 0,
          "penalty": 999,
          "cancellationFee": 350,
          "totalPenalty": 1349,
          "refund": 2659,
          "ssrPerPassenger": false
        },
        {
          "paxId": "PAX2",
          "amount": 4008,
          "convenienceFee": 0,
          "ssr": 0,
          "flexiCancelFee": 0,
          "penalty": 999,
          "cancellationFee": 350,
          "totalPenalty": 1349,
          "refund": 2659,
          "ssrPerPassenger": false
        }
      ],
      "createdAt": "2026-08-12T21:51:03Z"
    },
    "refundSummary": {
      "amount": 5318,
      "cancellationCharge": 2698,
      "totalPenalty": 2698,
      "cancellationChargeBreakup": {
        "airlineCancellationFee": 1998,
        "convenienceFee": 0,
        "serviceFee": 700,
        "flexicancelFee": 0
      }
    },
    "transaction": {
      "id": "617",
      "amount": 5318,
      "currency": "INR",
      "paymentMethod": "wallet",
      "type": "refund",
      "status": "success",
      "createdAt": "2026-08-12T21:51:16Z",
      "completedAt": "2026-08-12T21:51:16Z"
    }
  }
}
```

---

## Case 5. Multi-pax list — cancel PAX1+PAX2 of 3 ADT

| Field | Value |
|---|---|
| Ran at | 2026-08-13 03:31–03:34 IST |
| Trip type | **OW** |
| Stops | **Direct** |
| Passengers | **3 ADT** |
| Cancel scope | cancellationPaxList: ["PAX1","PAX2"] |
| Fare type | CORPORATE |
| Route | DEL-BOM |
| Airline | 6E |
| Booking reference | `BR1786572156401139` |
| PNR | `JZL8NQ` |
| onlineCancellation | true |
| Result | PASS — Cancellation Requested + quote (PER_PAX_POLICY) |

### PENALTY request
```json
{
  "retryCount": 2,
  "action": "PENALTY",
  "pnr": "JZL8NQ",
  "cancellationPaxList": [
    "PAX1",
    "PAX2"
  ],
  "cancellationReason": "multipax-list CORP"
}
```

### PENALTY response (HTTP 200)
```json
{
  "status": 0,
  "statusMessage": "Success",
  "data": {
    "bookingReference": "BR1786572156401139",
    "pnr": "JZL8NQ",
    "cancellationRequest": {
      "status": "Penalty Fetched",
      "estimatedCancellationCharge": 1698,
      "estimatedRefund": 7852,
      "totalAmount": 9550,
      "totalPenalty": 1698,
      "penaltyBasis": "PER_PAX_POLICY",
      "amount": 9550,
      "convenienceFee": 0,
      "ssr": 0,
      "flexiCancelFee": 0,
      "penalty": 998,
      "cancellationFee": 700,
      "perPax": [
        {
          "paxId": "PAX1",
          "amount": 4775,
          "convenienceFee": 0,
          "ssr": 0,
          "flexiCancelFee": 0,
          "penalty": 499,
          "cancellationFee": 350,
          "totalPenalty": 849,
          "refund": 3926,
          "ssrPerPassenger": false
        },
        {
          "paxId": "PAX2",
          "amount": 4775,
          "convenienceFee": 0,
          "ssr": 0,
          "flexiCancelFee": 0,
          "penalty": 499,
          "cancellationFee": 350,
          "totalPenalty": 849,
          "refund": 3926,
          "ssrPerPassenger": false
        }
      ],
      "createdAt": "2026-08-12T22:02:44Z"
    },
    "paxScope": {
      "scope": "PARTIAL_PAX",
      "cancellationPaxList": [
        "PAX1",
        "PAX2"
      ],
      "totalPaxOnPnr": 3,
      "cancelledPaxCount": 2,
      "prorated": true,
      "penaltyQuotable": true,
      "penaltyBasis": "PER_PAX_POLICY",
      "penaltyPerPax": 499,
      "chargedPax": 2
    }
  }
}
```

### CANCEL request
```json
{
  "retryCount": 2,
  "action": "CANCEL",
  "pnr": "JZL8NQ",
  "cancellationPaxList": [
    "PAX1",
    "PAX2"
  ],
  "cancellationReason": "multipax-list CORP"
}
```

### CANCEL response (HTTP 200)
```json
{
  "status": 0,
  "statusMessage": "Success",
  "data": {
    "bookingReference": "BR1786572156401139",
    "pnr": "JZL8NQ",
    "cancellationRequest": {
      "status": "Cancellation Requested",
      "estimatedCancellationCharge": 1698,
      "estimatedRefund": 7852,
      "totalAmount": 9550,
      "totalPenalty": 1698,
      "penaltyBasis": "PER_PAX_POLICY",
      "amount": 9550,
      "convenienceFee": 0,
      "ssr": 0,
      "flexiCancelFee": 0,
      "penalty": 998,
      "cancellationFee": 700,
      "perPax": [
        {
          "paxId": "PAX1",
          "amount": 4775,
          "convenienceFee": 0,
          "ssr": 0,
          "flexiCancelFee": 0,
          "penalty": 499,
          "cancellationFee": 350,
          "totalPenalty": 849,
          "refund": 3926,
          "ssrPerPassenger": false
        },
        {
          "paxId": "PAX2",
          "amount": 4775,
          "convenienceFee": 0,
          "ssr": 0,
          "flexiCancelFee": 0,
          "penalty": 499,
          "cancellationFee": 350,
          "totalPenalty": 849,
          "refund": 3926,
          "ssrPerPassenger": false
        }
      ],
      "createdAt": "2026-08-12T22:02:46Z"
    },
    "paxScope": {
      "scope": "PARTIAL_PAX",
      "cancellationPaxList": [
        "PAX1",
        "PAX2"
      ],
      "totalPaxOnPnr": 3,
      "cancelledPaxCount": 2,
      "prorated": true,
      "penaltyQuotable": true,
      "penaltyBasis": "PER_PAX_POLICY",
      "penaltyPerPax": 499,
      "chargedPax": 2
    }
  }
}
```

---

## Case 6. Remaining pax after multi-list — PAX3 of 3

| Field | Value |
|---|---|
| Ran at | 2026-08-13 03:34 IST |
| Trip type | **OW** |
| Stops | **Direct** |
| Passengers | **3 ADT** |
| Cancel scope | cancellationPaxList: ["PAX3"] |
| Fare type | CORPORATE |
| Route | DEL-BOM |
| Airline | 6E |
| Booking reference | `BR1786572156401139` |
| PNR | `JZL8NQ` |
| onlineCancellation | true |
| Result | PASS — Cancellation Requested + quote |

### PENALTY request
```json
{
  "retryCount": 2,
  "action": "PENALTY",
  "pnr": "JZL8NQ",
  "cancellationPaxList": [
    "PAX3"
  ],
  "cancellationReason": "remaining PAX3"
}
```

### PENALTY response (HTTP 200)
```json
{
  "status": 0,
  "statusMessage": "Success",
  "data": {
    "bookingReference": "BR1786572156401139",
    "pnr": "JZL8NQ",
    "cancellationRequest": {
      "status": "Penalty Fetched",
      "estimatedCancellationCharge": 849,
      "estimatedRefund": 3926,
      "totalAmount": 4775,
      "totalPenalty": 849,
      "penaltyBasis": "PER_PAX_POLICY",
      "amount": 4775,
      "convenienceFee": 0,
      "ssr": 0,
      "flexiCancelFee": 0,
      "penalty": 499,
      "cancellationFee": 350,
      "perPax": [
        {
          "paxId": "PAX3",
          "amount": 4775,
          "convenienceFee": 0,
          "ssr": 0,
          "flexiCancelFee": 0,
          "penalty": 499,
          "cancellationFee": 350,
          "totalPenalty": 849,
          "refund": 3926,
          "ssrPerPassenger": false
        }
      ],
      "createdAt": "2026-08-12T22:04:07Z"
    },
    "paxScope": {
      "scope": "PARTIAL_PAX",
      "cancellationPaxList": [
        "PAX3"
      ],
      "totalPaxOnPnr": 3,
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

### CANCEL request
```json
{
  "retryCount": 2,
  "action": "CANCEL",
  "pnr": "JZL8NQ",
  "cancellationPaxList": [
    "PAX3"
  ],
  "cancellationReason": "remaining PAX3"
}
```

### CANCEL response (HTTP 200)
```json
{
  "status": 0,
  "statusMessage": "Success",
  "data": {
    "bookingReference": "BR1786572156401139",
    "pnr": "JZL8NQ",
    "cancellationRequest": {
      "status": "Cancellation Requested",
      "estimatedCancellationCharge": 849,
      "estimatedRefund": 3926,
      "totalAmount": 4775,
      "totalPenalty": 849,
      "penaltyBasis": "PER_PAX_POLICY",
      "amount": 4775,
      "convenienceFee": 0,
      "ssr": 0,
      "flexiCancelFee": 0,
      "penalty": 499,
      "cancellationFee": 350,
      "perPax": [
        {
          "paxId": "PAX3",
          "amount": 4775,
          "convenienceFee": 0,
          "ssr": 0,
          "flexiCancelFee": 0,
          "penalty": 499,
          "cancellationFee": 350,
          "totalPenalty": 849,
          "refund": 3926,
          "ssrPerPassenger": false
        }
      ],
      "createdAt": "2026-08-12T22:04:09Z"
    },
    "paxScope": {
      "scope": "PARTIAL_PAX",
      "cancellationPaxList": [
        "PAX3"
      ],
      "totalPaxOnPnr": 3,
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

---

## Case 7. Full PNR cancel — 3 ADT

| Field | Value |
|---|---|
| Ran at | 2026-08-13 03:35 IST |
| Trip type | **OW** |
| Stops | **Direct** |
| Passengers | **3 ADT** |
| Cancel scope | Full PNR (no cancellationPaxList) |
| Fare type | CORPORATE |
| Route | DEL-BOM |
| Airline | 6E |
| Booking reference | `BR1786572337739872` |
| PNR | `MUE5SW` |
| onlineCancellation | true |
| Result | PASS — Cancelled (fee × 3) |

### PENALTY request
```json
{
  "retryCount": 2,
  "action": "PENALTY",
  "pnr": "MUE5SW",
  "cancellationReason": "3ADT full"
}
```

### PENALTY response (HTTP 200)
```json
{
  "status": 0,
  "statusMessage": "Success",
  "data": {
    "bookingReference": "BR1786572337739872",
    "pnr": "MUE5SW",
    "cancellationRequest": {
      "status": "Penalty Fetched",
      "estimatedCancellationCharge": 2050,
      "estimatedRefund": 10130,
      "totalAmount": 12180,
      "totalPenalty": 2050,
      "penaltyBasis": "PROVIDER",
      "amount": 12180,
      "convenienceFee": 0,
      "ssr": 0,
      "flexiCancelFee": 0,
      "penalty": 1000,
      "cancellationFee": 1050,
      "perPax": [
        {
          "paxId": "PAX1",
          "amount": 4060,
          "convenienceFee": 0,
          "ssr": 0,
          "flexiCancelFee": 0,
          "penalty": 333.33,
          "cancellationFee": 350,
          "totalPenalty": 683.33,
          "refund": 3376.67,
          "ssrPerPassenger": false
        },
        {
          "paxId": "PAX2",
          "amount": 4060,
          "convenienceFee": 0,
          "ssr": 0,
          "flexiCancelFee": 0,
          "penalty": 333.33,
          "cancellationFee": 350,
          "totalPenalty": 683.33,
          "refund": 3376.67,
          "ssrPerPassenger": false
        },
        {
          "paxId": "PAX3",
          "amount": 4060,
          "convenienceFee": 0,
          "ssr": 0,
          "flexiCancelFee": 0,
          "penalty": 333.34,
          "cancellationFee": 350,
          "totalPenalty": 683.34,
          "refund": 3376.66,
          "ssrPerPassenger": false
        }
      ],
      "createdAt": "2026-08-12T22:05:43Z"
    }
  }
}
```

### CANCEL request
```json
{
  "retryCount": 2,
  "action": "CANCEL",
  "pnr": "MUE5SW",
  "cancellationReason": "3ADT full"
}
```

### CANCEL response (HTTP 200)
```json
{
  "status": 0,
  "statusMessage": "Success",
  "data": {
    "bookingReference": "BR1786572337739872",
    "pnr": "MUE5SW",
    "cancellationRequest": {
      "status": "Cancelled",
      "estimatedCancellationCharge": 4047,
      "estimatedRefund": 8133,
      "totalAmount": 12180,
      "totalPenalty": 4047,
      "penaltyBasis": "PROVIDER",
      "amount": 12180,
      "convenienceFee": 0,
      "ssr": 0,
      "flexiCancelFee": 0,
      "penalty": 2997,
      "cancellationFee": 1050,
      "perPax": [
        {
          "paxId": "PAX1",
          "amount": 4060,
          "convenienceFee": 0,
          "ssr": 0,
          "flexiCancelFee": 0,
          "penalty": 999,
          "cancellationFee": 350,
          "totalPenalty": 1349,
          "refund": 2711,
          "ssrPerPassenger": false
        },
        {
          "paxId": "PAX2",
          "amount": 4060,
          "convenienceFee": 0,
          "ssr": 0,
          "flexiCancelFee": 0,
          "penalty": 999,
          "cancellationFee": 350,
          "totalPenalty": 1349,
          "refund": 2711,
          "ssrPerPassenger": false
        },
        {
          "paxId": "PAX3",
          "amount": 4060,
          "convenienceFee": 0,
          "ssr": 0,
          "flexiCancelFee": 0,
          "penalty": 999,
          "cancellationFee": 350,
          "totalPenalty": 1349,
          "refund": 2711,
          "ssrPerPassenger": false
        }
      ],
      "createdAt": "2026-08-12T22:05:45Z"
    },
    "refundSummary": {
      "amount": 8133,
      "cancellationCharge": 4047,
      "totalPenalty": 4047,
      "cancellationChargeBreakup": {
        "airlineCancellationFee": 2997,
        "convenienceFee": 0,
        "serviceFee": 1050,
        "flexicancelFee": 0
      }
    },
    "transaction": {
      "id": "621",
      "amount": 8133,
      "currency": "INR",
      "paymentMethod": "wallet",
      "type": "refund",
      "status": "success",
      "createdAt": "2026-08-12T22:05:52Z",
      "completedAt": "2026-08-12T22:05:52Z"
    }
  }
}
```

---

## Case 8. Cancel all passengers via list — 2 ADT

| Field | Value |
|---|---|
| Ran at | 2026-08-13 03:37 IST |
| Trip type | **OW** |
| Stops | **Direct** |
| Passengers | **2 ADT** |
| Cancel scope | cancellationPaxList: ["PAX1","PAX2"] (all) → FULL_PAX |
| Fare type | CORPORATE |
| Route | DEL-BOM |
| Airline | 6E |
| Booking reference | `BR1786572460100067` |
| PNR | `H4LMSE` |
| onlineCancellation | true |
| Result | PASS — Cancelled / scope FULL_PAX |

### PENALTY request
```json
{
  "retryCount": 2,
  "action": "PENALTY",
  "pnr": "H4LMSE",
  "cancellationPaxList": [
    "PAX1",
    "PAX2"
  ],
  "cancellationReason": "all-via-list"
}
```

### PENALTY response (HTTP 200)
```json
{
  "status": 0,
  "statusMessage": "Success",
  "data": {
    "bookingReference": "BR1786572460100067",
    "pnr": "H4LMSE",
    "cancellationRequest": {
      "status": "Penalty Fetched",
      "estimatedCancellationCharge": 1700,
      "estimatedRefund": 6252,
      "totalAmount": 7952,
      "totalPenalty": 1700,
      "penaltyBasis": "PROVIDER",
      "amount": 7952,
      "convenienceFee": 0,
      "ssr": 0,
      "flexiCancelFee": 0,
      "penalty": 1000,
      "cancellationFee": 700,
      "perPax": [
        {
          "paxId": "PAX1",
          "amount": 3976,
          "convenienceFee": 0,
          "ssr": 0,
          "flexiCancelFee": 0,
          "penalty": 500,
          "cancellationFee": 350,
          "totalPenalty": 850,
          "refund": 3126,
          "ssrPerPassenger": false
        },
        {
          "paxId": "PAX2",
          "amount": 3976,
          "convenienceFee": 0,
          "ssr": 0,
          "flexiCancelFee": 0,
          "penalty": 500,
          "cancellationFee": 350,
          "totalPenalty": 850,
          "refund": 3126,
          "ssrPerPassenger": false
        }
      ],
      "createdAt": "2026-08-12T22:07:45Z"
    },
    "paxScope": {
      "scope": "FULL_PAX",
      "cancellationPaxList": [
        "PAX1",
        "PAX2"
      ],
      "totalPaxOnPnr": 2,
      "cancelledPaxCount": 2,
      "prorated": false
    }
  }
}
```

### CANCEL request
```json
{
  "retryCount": 2,
  "action": "CANCEL",
  "pnr": "H4LMSE",
  "cancellationPaxList": [
    "PAX1",
    "PAX2"
  ],
  "cancellationReason": "all-via-list"
}
```

### CANCEL response (HTTP 200)
```json
{
  "status": 0,
  "statusMessage": "Success",
  "data": {
    "bookingReference": "BR1786572460100067",
    "pnr": "H4LMSE",
    "cancellationRequest": {
      "status": "Cancelled",
      "estimatedCancellationCharge": 2698,
      "estimatedRefund": 5254,
      "totalAmount": 7952,
      "totalPenalty": 2698,
      "penaltyBasis": "PROVIDER",
      "amount": 7952,
      "convenienceFee": 0,
      "ssr": 0,
      "flexiCancelFee": 0,
      "penalty": 1998,
      "cancellationFee": 700,
      "perPax": [
        {
          "paxId": "PAX1",
          "amount": 3976,
          "convenienceFee": 0,
          "ssr": 0,
          "flexiCancelFee": 0,
          "penalty": 999,
          "cancellationFee": 350,
          "totalPenalty": 1349,
          "refund": 2627,
          "ssrPerPassenger": false
        },
        {
          "paxId": "PAX2",
          "amount": 3976,
          "convenienceFee": 0,
          "ssr": 0,
          "flexiCancelFee": 0,
          "penalty": 999,
          "cancellationFee": 350,
          "totalPenalty": 1349,
          "refund": 2627,
          "ssrPerPassenger": false
        }
      ],
      "createdAt": "2026-08-12T22:07:47Z"
    },
    "refundSummary": {
      "amount": 5254,
      "cancellationCharge": 2698,
      "totalPenalty": 2698,
      "cancellationChargeBreakup": {
        "airlineCancellationFee": 1998,
        "convenienceFee": 0,
        "serviceFee": 700,
        "flexicancelFee": 0
      }
    },
    "paxScope": {
      "scope": "FULL_PAX",
      "cancellationPaxList": [
        "PAX1",
        "PAX2"
      ],
      "totalPaxOnPnr": 2,
      "cancelledPaxCount": 2,
      "prorated": false
    },
    "transaction": {
      "id": "622",
      "amount": 5254,
      "currency": "INR",
      "paymentMethod": "wallet",
      "type": "refund",
      "status": "success",
      "createdAt": "2026-08-12T22:07:54Z",
      "completedAt": "2026-08-12T22:07:54Z"
    }
  }
}
```

---

*Generated from canary automation reports in the latest ~2 hour window — TravelVIP API QA.*
