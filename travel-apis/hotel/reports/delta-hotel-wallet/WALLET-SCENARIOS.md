# delta-api hotel B2B wallet scenarios (2026-11-13)

**Base:** `https://delta-api.travelvip.ai` · partner **vgm** (staging creds)  
**Nexus:** `https://dev-nexus.travelvip.ai` · Partner Wallet **Vouchagram Partner**

| # | Scenario | Status | Evidence |
|---|---|---|---|
| 1 | Successful book | **PASS** | `BR1794553787773604` Pending → **Confirmed** (Hiltop). Nexus: hold ₹9,480.24 → **Committed −₹9,480.24** (once) |
| 2 | Provider reject / fail | **PASS** (live fail path) | `BR1794553763333185` Pending → **Failed**. Nexus: −₹9,480.24 then **Refund +₹9,480.24 Completed**; holds ₹0 |
| 2b | Invalid PAN format | **PASS** (API gate) | Finalize **HTTP 400** `VALIDATION_ERROR` — `'contact.panCardNumber' must be a valid PAN…` · **no BR** · no wallet row |
| 3 | Double finalize | **PASS** | Replay same body → `duplicate: true`, **same BR**, no second commit in Nexus |
| 4 | Cancel confirmed (free cancel) | **PASS** | Penalty charge **0** / refund **9480.24** → cancel **Cancelled**. Nexus: **Refund received +₹9,480.24** (12:40 pm · id 379). Balance back ~₹11,33,498 |

## Notes
- Format-invalid PAN never reaches vendor (expected API validation).
- First Failed BR used format-valid PAN `ABCDE1234F` and still Failed at provider — used as reject/fail wallet proof.
- Confirmed book used `EUIPB1672M`.
- Probe: `travel-apis/hotel/scripts/probe-delta-hotel-wallet-scenarios.js` · JSON: `latest.json`
