# Sell Oil retest — SCH-000001814 (after rate fix)

**Env:** TravelVIP Grow `uat-byufuel.growexponential.app`  
**When:** 2026-11-03 ~18:29 IST  
**Supplier APK:** `com.byufuel.uat.supplier` · Rohan SupplierQA

## Request created

| Field | Value | Check |
|-------|-------|-------|
| SCH | **SCH-000001814** | PASS |
| Date | **03-Nov-26** (today) | PASS |
| Slot | **6 PM to 10 PM** (current evening window) | PASS |
| Type | Pickup | PASS |
| Weight / Grade | **10 kg · Grade A** | PASS |
| App bill | UCO **₹ 250.00** · Tax **₹ 45.00** · Total **₹ 295.00** | **PASS** (was ₹0 before fix) |
| Confirm dialog | Same ₹250 / ₹45 / ₹295 | PASS |
| Success | “Sell Request Submitted Successfully SCH-000001814” | PASS |
| KYC banner on home | Still “Please upload KYC documents.” | NOTE (does not block book) |

## Admin list (Manage Requests)

| Field | Value | Check |
|-------|-------|-------|
| Rate per unit | **25.00** | PASS (= ₹250 / 10 kg) |
| Estimated amount | **₹ 250.00** | PASS vs app base |
| Tax on list row | Not shown as separate column | NOTE — app shows tax ₹45; admin estimate is pre-tax base |
| Status after create | REQUEST PLACED | PASS |
| Supplier / est. / PIN | Rohan SupplierQA · Rohan QA Kitchen · 500084 | PASS |

## Prior miss (SCH-000001813)

First attempt showed **₹ 0.00** on APK — logged as miss. Retest after fix → priced correctly.

## Checklist going forward (do not skip)

On every Sell Oil / schedule step verify:
1. Date + slot match intent (today / current window if E2E same-day)
2. Weight + grade
3. **Price estimate ≠ ₹0** (base, tax, total)
4. Confirm dialog matches form totals
5. Success SCH id captured
6. Admin row: rate, estimated amount, status, OA, warehouse
7. Compare to Azure / prior evidence when values look wrong

## Evidence

- `selloil2-03-price-check.png` / `.xml`
- `selloil2-04-confirm-dialog.png`
- `selloil2-05-success.png`
- `selloil2-06-admin-sch1814.png`
