# TravelVIP B2B API
## Flight cancellation — per-passenger charges
### Successful request & response pack (for client / docs)

| | |
|---|---|
| Guide | Flight cancellation — per-passenger charges: testing guide |
| Environment | `https://canary-api.travelvip.ai` |
| Partner | `vgm` |
| Endpoint | `POST /v1/flights/booking/{bookingReference}/cancel?lang=en&currency=INR` |
| Content | **Successful** PENALTY + CANCEL bodies only (live canary) |

## Guide → evidence map

| Guide case | Trip | Stops | Pax | Path | BR | Result |
|---|---|---|---|---|---|---|
| **R6 / D1 → D3** — Single-passenger booking · PENALTY then CANCEL (direct path) | **OW** | **Direct** | **1 ADT** | Direct (onlineCancellation=true, full PNR) | `BR1786561773208289` | Cancelled + wallet refund |
| **Formula · SSR withheld** — Ancillaries (meal/bag) withheld from refund on CANCEL | **OW** | **Direct** | **1 ADT** | Direct | `BR1786570315695002` | Cancelled; perPax.ssr / ssrCharge = 2420 not refunded |
| **R3 / R4** — Subset PENALTY + CANCEL — cancellationPaxList ["PAX1","PAX2"] on 3 ADT | **OW** | **Direct** | **3 ADT** | Request path (partial pax list) | `BR1786572156401139` | Cancellation Requested · penaltyBasis PER_PAX_POLICY · amounts present |
| **R5** — Sequential cancellations — PAX1 then PAX2 | **OW** | **Direct** | **2 ADT** | Request path (partial, sequential) | `BR1786570951120374` | Both steps Cancellation Requested with quotes |
| **R5 (remaining)** — After multi-list — cancel remaining PAX3 | **OW** | **Direct** | **3 ADT** | Request path (remaining partial) | `BR1786572156401139` | Cancellation Requested + quote |
| **D1 → D3 (×3 pax)** — Whole PNR CANCEL — 3 ADT (charges × passengers) | **OW** | **Direct** | **3 ADT** | Direct (full PNR) | `BR1786572337739872` | Cancelled · cancellationFee 350×3 = 1050 |
| **Full via list** — Cancel all pax using cancellationPaxList (scope FULL_PAX) | **OW** | **Direct** | **2 ADT** | Direct via full pax list | `BR1786572460100067` | Cancelled · paxScope FULL_PAX |
| **§8 RT regression** — Round trip — cancel return PNR only (onward untouched) | **RT** | **Direct** | **2 ADT** | Direct on return leg only | `BR1786568422897124` | Return Cancelled · onward PNR G122SA intact · booking Cancelled |

---

## R6 / D1 → D3
### Single-passenger booking · PENALTY then CANCEL (direct path)

| Field | Value |
|---|---|
| Trip type | **OW** |
| Stops | **Direct** |
| Passengers | **1 ADT** |
| Fare | NORMAL |
| Route | DEL-BOM |
| Airline | 6E |
| Pricing path | Direct (onlineCancellation=true, full PNR) |
| Booking reference | `BR1786561773208289` |
| PNR | `HVEW5Q` |
| onlineCancellation | true |
| Result | Cancelled + wallet refund |

### PENALTY request
```json
{
  "retryCount": 2,
  "action": "PENALTY",
  "pnr": "HVEW5Q",
  "cancellationReason": "guide R6/D1"
}
```

### PENALTY response — HTTP 200
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
  "cancellationReason": "guide D3"
}
```

### CANCEL response — HTTP 200
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

## Formula · SSR withheld
### Ancillaries (meal/bag) withheld from refund on CANCEL

| Field | Value |
|---|---|
| Trip type | **OW** |
| Stops | **Direct** |
| Passengers | **1 ADT** |
| Fare | NORMAL |
| Route | BOM-BLR |
| Airline | 6E |
| Pricing path | Direct |
| Booking reference | `BR1786570315695002` |
| PNR | `P2B8WN` |
| onlineCancellation | true |
| Result | Cancelled; perPax.ssr / ssrCharge = 2420 not refunded |
| Notes | SSR booked ₹2420 (meal 320 + bag 2100) |

### PENALTY request
```json
{
  "retryCount": 2,
  "action": "PENALTY",
  "pnr": "P2B8WN",
  "cancellationReason": "SSR withheld"
}
```

### PENALTY response — HTTP 200
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

### CANCEL response — HTTP 200
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

## R3 / R4
### Subset PENALTY + CANCEL — cancellationPaxList ["PAX1","PAX2"] on 3 ADT

| Field | Value |
|---|---|
| Trip type | **OW** |
| Stops | **Direct** |
| Passengers | **3 ADT** |
| Fare | CORPORATE |
| Route | DEL-BOM |
| Airline | 6E |
| Pricing path | Request path (partial pax list) |
| Booking reference | `BR1786572156401139` |
| PNR | `JZL8NQ` |
| onlineCancellation | true |
| Result | Cancellation Requested · penaltyBasis PER_PAX_POLICY · amounts present |

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
  "cancellationReason": "guide R4/R3"
}
```

### PENALTY response — HTTP 200
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
  "cancellationReason": "guide R3"
}
```

### CANCEL response — HTTP 200
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

## R5
### Sequential cancellations — PAX1 then PAX2

| Field | Value |
|---|---|
| Trip type | **OW** |
| Stops | **Direct** |
| Passengers | **2 ADT** |
| Fare | CORPORATE |
| Route | DEL-BOM |
| Airline | 6E |
| Pricing path | Request path (partial, sequential) |
| Booking reference | `BR1786570951120374` |
| PNR | `KSKZ2J` |
| onlineCancellation | true |
| Result | Both steps Cancellation Requested with quotes |

### R5 step 1 — ["PAX1"]

**PENALTY request**
```json
{
  "retryCount": 2,
  "action": "PENALTY",
  "pnr": "KSKZ2J",
  "cancellationPaxList": [
    "PAX1"
  ],
  "cancellationReason": "guide R5 step1"
}
```

**PENALTY response — HTTP 200**
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
  "cancellationReason": "guide R5 step1"
}
```

**CANCEL response — HTTP 200**
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

### R5 step 2 — ["PAX2"]

**PENALTY request**
```json
{
  "retryCount": 2,
  "action": "PENALTY",
  "pnr": "KSKZ2J",
  "cancellationPaxList": [
    "PAX2"
  ],
  "cancellationReason": "guide R5 step2"
}
```

**PENALTY response — HTTP 200**
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
  "cancellationReason": "guide R5 step2"
}
```

**CANCEL response — HTTP 200**
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

## R5 (remaining)
### After multi-list — cancel remaining PAX3

| Field | Value |
|---|---|
| Trip type | **OW** |
| Stops | **Direct** |
| Passengers | **3 ADT** |
| Fare | CORPORATE |
| Route | DEL-BOM |
| Airline | 6E |
| Pricing path | Request path (remaining partial) |
| Booking reference | `BR1786572156401139` |
| PNR | `JZL8NQ` |
| onlineCancellation | true |
| Result | Cancellation Requested + quote |

### PENALTY request
```json
{
  "retryCount": 2,
  "action": "PENALTY",
  "pnr": "JZL8NQ",
  "cancellationPaxList": [
    "PAX3"
  ],
  "cancellationReason": "guide R5 remaining"
}
```

### PENALTY response — HTTP 200
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
  "cancellationReason": "guide R5 remaining"
}
```

### CANCEL response — HTTP 200
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

## D1 → D3 (×3 pax)
### Whole PNR CANCEL — 3 ADT (charges × passengers)

| Field | Value |
|---|---|
| Trip type | **OW** |
| Stops | **Direct** |
| Passengers | **3 ADT** |
| Fare | CORPORATE |
| Route | DEL-BOM |
| Airline | 6E |
| Pricing path | Direct (full PNR) |
| Booking reference | `BR1786572337739872` |
| PNR | `MUE5SW` |
| onlineCancellation | true |
| Result | Cancelled · cancellationFee 350×3 = 1050 |

### PENALTY request
```json
{
  "retryCount": 2,
  "action": "PENALTY",
  "pnr": "MUE5SW",
  "cancellationReason": "guide D1 3ADT"
}
```

### PENALTY response — HTTP 200
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
  "cancellationReason": "guide D3 3ADT"
}
```

### CANCEL response — HTTP 200
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

## Full via list
### Cancel all pax using cancellationPaxList (scope FULL_PAX)

| Field | Value |
|---|---|
| Trip type | **OW** |
| Stops | **Direct** |
| Passengers | **2 ADT** |
| Fare | CORPORATE |
| Route | DEL-BOM |
| Airline | 6E |
| Pricing path | Direct via full pax list |
| Booking reference | `BR1786572460100067` |
| PNR | `H4LMSE` |
| onlineCancellation | true |
| Result | Cancelled · paxScope FULL_PAX |

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
  "cancellationReason": "guide all-via-list"
}
```

### PENALTY response — HTTP 200
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
  "cancellationReason": "guide all-via-list"
}
```

### CANCEL response — HTTP 200
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

## §8 RT regression
### Round trip — cancel return PNR only (onward untouched)

| Field | Value |
|---|---|
| Trip type | **RT** |
| Stops | **Direct** |
| Passengers | **2 ADT** |
| Fare | CORPORATE |
| Route | DEL-BOM (round trip) |
| Airline | 6E |
| Pricing path | Direct on return leg only |
| Booking reference | `BR1786568422897124` |
| PNR | `FR71YC` |
| Other PNR | `G122SA` (intact) |
| onlineCancellation | true |
| Result | Return Cancelled · onward PNR G122SA intact · booking Cancelled |

### PENALTY request
```json
{
  "retryCount": 2,
  "action": "PENALTY",
  "pnr": "FR71YC",
  "cancellationReason": "guide RT return"
}
```

### PENALTY response — HTTP 200
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
  "cancellationReason": "guide RT return"
}
```

### CANCEL response — HTTP 200
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

## Notes

1. `PENALTY` = quote only; `CANCEL` = perform cancel / open request.
2. Partial pax → expect `paxScope.scope: PARTIAL_PAX` and usually `Cancellation Requested`.
3. Full online PNR → expect `Cancelled` when provider succeeds.
4. SSR appears under `perPax.ssr` / `refundSummary.cancellationChargeBreakup.ssrCharge` and is not refunded.
5. Seed-only guide cases (R7 PERCENT, R8 no-policy, offline `onlineCancellation=false`) are not in this pack.

*TravelVIP API QA — canary success evidence against per-passenger cancel testing guide.*
