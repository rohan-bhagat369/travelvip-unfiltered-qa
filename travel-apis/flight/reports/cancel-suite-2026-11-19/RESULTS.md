# Flight cancellation QA — results

**Suite:** Flight cancellation — QA test suite (19 Nov 2026)  
**API:** `https://ak-api.travelvip.ai` (staging/akshay-flight-bundle)  
**Nexus:** `https://dev-nexus.travelvip.ai`  
**Creds:** api-staging partner `vgm` / tier `10546901`  
**Ownership:** API = agent · Nexus UI / offline desk = agent + Rohan

## Pre-checks

| Check | Result |
|-------|--------|
| Nexus `entrypoints.json` not serving `app.4e051c6f.js` / `app.9ef267a5.js` | **PASS** — serves `app.e969971a.js` |
| Auth on ak-api with staging vgm | **PASS** |
| Auth on api-staging with same vgm | **PASS** |

## Fixture BRs

| Fixture | BR | Env | Notes |
|---------|----|-----|-------|
| OW Confirmed (Nexus C1) | `BR1795088345226462` | ak-api | PNQ→DEL · **leave for Nexus online cancel** |
| RT Confirmed (Nexus E) | `BR1795088348919454` | ak-api | PNQ↔DXB 2ADT · **leave for Nexus offline desk** |
| OW API-cancelled (Nexus A12) | `BR1795088373763911` | ak-api | PNQ→DEL · PNR `SIM-EM7EFI` · API Cancelled · refund ~3900.6 |
| OW (earlier) | `BR1795087352240506` | ak-api | API Cancelled earlier |
| RT (earlier / desk bug) | `BR1795087355209478` | ak-api | Nexus #97 settled; banner bug |
| Offline airline / Stripe | | | not booked |

Handoff for Rohan: `NEXUS-HANDOFF.md`

Detail URL: `https://dev-nexus.travelvip.ai/bookings/edit-flight/1610`  
Desk URL: `https://dev-nexus.travelvip.ai/cancellations/BR1795087355209478`

## Nexus UI results (A–F)

| ID | Status | Evidence |
|----|--------|----------|
| A2 | **SOFT** | Header shows **Fare · NORMAL** (suite expects **Fare · Regular** for no fare type) |
| A4 | **PASS** | Trip protection: Delay Care / Trip Concierge / BagAssure as separate rows; BagAssure only **Arvind Patil** (1 of 3); segment + price shown |
| A5 | **PASS** | BagAssure shows **Pending** + **Awaiting vendor** |
| A4 soft | note | Trip Concierge segment missing **Onward ·** prefix (suite known: “Trip Concierge rows are missing the Onward · prefix”) |
| A11 | PASS | Vendor cost · riya-flights-dev visible as superadmin |
| A6/A7 | PASS | Price panel original total; Paid-for-cancelled block + refund 25582 |
| A10 | **PASS** | Lead pax shows **Partly cancelled** |
| A12 | N/A yet | Header still **Confirmed** + Cancel booking (partial, not fully cancelled) |
| B1 | **PASS** | Header **Cancel booking** + note: whole journey online; fewer pax → offline |
| B2 | **PASS*** | Dialog opens; both pax ticked on `SIM-3CCB8B`. *Only one PNR shown (sim uses same PNR both legs) |
| B3 | **PASS** | Unticked Amit → button **Raise offline request** → landed desk request **#97** (PAX1 Rohan) |
| E1 | **PASS** | Airline penalty 0 / Cancellation fee 100 / Flexi 0 — each **Matches quote** |
| E2 | **PASS** | Convenience share ₹175 of ₹350 non-refundable shown |
| E3 | **PASS** | Settled as-quoted; refund **₹25,582.00** (25857 − 100 − 175); wallet |
| F1 | **PASS** (request) | Desk Money: **Adds up**; Refund 25582 + Kept 275 |
| F5 | **BUG?** | Warning: quoted fare ₹25,857 “looks high” vs even-split ₹12,928.50 across **4** sectors — but request is 1 pax × up to 2 legs (half booking). Review with Akshay |
| Desk copy after settle | **BUG** | Banner: *“All 2 passengers are cancelled and both requests are closed”* — **false**. Table: PAX1 Cancelled only on PNQ→RKT, still Confirmed on DXB→PNQ; **PAX2 Travelling** both legs. Header still **Confirmed**. Money still held ₹25,857 |

## API results (H / G4)

| ID | Status | Evidence |
|----|--------|----------|
| H5 / G4 | **PASS** | OW `BR1795087352240506`: PENALTY → CANCEL v2 → status **Cancelled**; refund ~3900.6 · charge 933.4 · `api-ow-cancel.json` |
| H1 | PASS | RT book Confirmed `BR1795087355209478` |
| H2 | PARTIAL | Status shape OK; no fareType/actorRef in partner status (spot-check) |
| H3 | NOT TESTED | Need PENALTY before settle on a fresh RT |
| H4 | NEXT | PENALTY on remaining after #97 settle |
| H6–H9 | NOT TESTED | webhook / stuck |

## Bugs filed for channel

1. **Desk post-settle banner wrong** on `BR1795087355209478` / request #97 — claims all 2 pax cancelled; PAX2 still Travelling; PAX1 only one leg Cancelled.  
2. **F5 high-fare warning** may use wrong denominator (4 sectors vs request scope).  
3. **A2 label** `Fare · NORMAL` vs expected `Fare · Regular`.

## Nexus screenshot verify (Rohan 2026-11-19)

| BR | Role | UI check | Result |
|----|------|----------|--------|
| `BR1795088345226462` | OW Confirmed | Confirmed · Cancel booking · Fare NORMAL · Online cancel note | **Ready for C1** (B1 PASS) |
| `BR1795088348919454` | RT Confirmed | Confirmed · 2 pax · Cancel + offline note · Paid 51714 · same PNR both legs | **Ready for B3/E** (B1 PASS) |
| `BR1795088373763911` | API Cancelled | Header Cancelled · pax Cancelled · Request Success · Refund 3900.60 · Cancelled by USER | **A12 PASS** |
| same | Money A7 | Kept shows Convenience 350 **and** Other deductions 350 (extra line) | **A7 BUG** — should not have large Other deductions |

## Nexus desk settle — BR1795088348919454 request #99 (screenshot 65368894)

| Check | Result |
|-------|--------|
| E3 settle as quoted | **PASS** — refund ₹25,582 wallet · fees ₹275 · Unaccounted 0 |
| F1 Money Adds up | **PASS** — Refunded 25582 + Kept 275 + Still booked 25857 = 51714 |
| F2 statement | **PASS** — Refund #99 · PAX1 · PNQ→RKT · credited to wallet |
| PAX table | PAX1 Cancelled onward only · return Confirmed · PAX2 Travelling both |
| Desk banner | **BUG** — says “All 2 passengers are cancelled and both requests are closed” but PAX2 Travelling; only 1 request (#99) |

## Nexus C1 — BR1795088345226462 (screenshot after online cancel)

| Check | Result |
|-------|--------|
| C1 online cancel | **PASS** — Header **Cancelled** · Request #100 Full · Success / Provider Completed · Refund ₹3,900.60 · **Cancelled by ADMIN** |
| A12 | **PASS** — Cancelled · pax Cancelled · Payment Refunded (no Cancel CTA needed) |
| Timeline | PASS — ADMIN Confirmed → Refund Completed → Cancelled |
| A7 Money | **BUG** — Kept shows Convenience ₹350 **and** Other deductions ₹350 again |

## B7/B8 — BR1795091441315761 (2 PNRs DEL↔PNQ)

| Check | Result |
|-------|--------|
| Fixture | Confirmed · onward `SIM-93EUK6` · return `SIM-5RQG6F` |
| B7 (after #102 PAX2 return) | **PASS** — PAX2 return already cancelled; onward tickable |
| B8 (after #103 PAX2 onward) | **PASS** — PAX2 **already cancelled** on both PNRs; #102+#103 Completed · refund ₹4,520.50 each |
| Remaining | Rohan still Cancel-tickable on both legs · booking still Confirmed |

## B5 — BR1795091441315761 request #104

| Check | Result |
|-------|--------|
| Open offline request | **PASS** — booking shows **Review cancellation request** · #104 Refund pending |
| Review → desk | **PASS** — lands `/cancellations/BR1795091441315761` · Settle #104 Awaiting settlement |

## Desk suite on BR1795091441315761 (#104 → #105) — 19 Nov 2026

| ID | Status | Evidence |
|----|--------|----------|
| E5 | **PASS** | Adjust convenience → empty reason keeps Review disabled; with reason Review enables (adjustment cancelled before settle) |
| E4 | **PASS** | Airline penalty 0→100 · preview ₹4,420.50 · Settle #104 credited ₹4,420.50 (not old ₹4,520.50) · fees kept ₹287.50 |
| B6 | **PASS** | After #104 closed: booking has **Cancel booking** (Rohan return still flying) · **no Review** button |
| F6 | **PASS** | Desk statement #104 ⓘ **Quoted vs applied (differs from the quote)** · penalty 0→100 / total deducted 187.50→287.50 / refund 4520.50→4420.50 (amber) |
| F7 | **PASS** | Booking Money/Price cancellation #104 same Quoted vs applied table (amber differs) |
| A8 | **PASS** | Money totals: Refunded **₹13,461.50** (= 4520.50+#102 + 4520.50+#103 + 4420.50+#104) · Kept **₹662.50** · Refunded+Kept = **₹14,124** (= 3×₹4,708 cancelled shares) · still held ₹4,708 for Rohan return · Net ₹5,370.50 |
| E10 | **PASS*** | Raised #105 on Rohan PNQ→DEL · Refused + “Fare rules don't allow it” + ref `SIM-QA-E10-105` · Record refusal · timeline **ADMIN Rejected** · money unchanged (still 3 refunds / ₹13,461.50) · **Cancel booking** still available |

\*E10 note: booking card for #105 shows badge **Refund failed** (wording odd for a refuse; functionally rejected / ₹0 moved).

### Desk copy after #104 (same banner bug family)

Desk said *“All 2 passengers are cancelled and both requests are closed”* while Rohan return was still **Confirmed** — same class of bug as earlier RT desk banner.

## DB checks (phpMyAdmin) — 19 Nov 2026

**Correct schema:** `gtx-dev` · **`travelx_migration_testing`** (not `travelx`).  
**BR:** `BR1795091441315761` · booking **1523** · flight item **1615** · total **1883200** paise · partner vgm.

| ID | Status | Evidence |
|----|--------|----------|
| Locate | **PASS** | booking 1523 · item 1615 `flight`/`TICKET` · 1883200 |
| Cells / A10 | **PASS** | PAX1: ONWARD Cancelled · RETURN **Confirmed**; PAX2: both Cancelled · PNRs SIM-93EUK6 / SIM-5RQG6F |
| G2 | **PASS** | `estimated_breakdown` **json NULL** exists |
| G3 | **PASS** | #102–#105 all have `estimated_breakdown` JSON; #104 settle kept quote `estimated_refund_amount=452050` while paid `refund_amount=442050` |
| #102 settle | **PASS** | OFFLINE · confirmed · COMPLETED · ADMIN · `nexus:108:rohan@…` · refund **452050** · fees 10000+8750 · provider_penalty **0** |
| #103 settle | **PASS** | same · refund **452050** · SIM-93EUK6 |
| E4 / #104 | **PASS** | refund **442050** · `provider_penalty_amount` **10000** · `penalty_amount` **28750** · event `REFUND_ADJUSTED` + `amount_delta=-10000` · airline ref SIM-QA-E5-104 |
| E10 / #105 | **PASS** | `rejected` · `refund_status=FAILED` · refund NULL · no `refund_transaction` · event `REJECTED` · ref SIM-QA-E10-105 · Rohan return still Confirmed |
| refund_transaction | **PASS** | 3× APP_WALLET completed: 452050 / 452050 / 442050 · charges 18750 / 18750 / 28750 · **none** for #105 |
| payment_transaction | **PASS** | wallet CAPTURE 1883200 + REFUND×3 matching amounts |
| G8 | **PASS** | `tx_nexus.offline_cancellation_audits` ×8 (raise/settle/refuse) — see prior paste |

**Soft notes (not scored BUG unless product disagrees):**
- booking.`status` = `pending` while cells/Nexus show Confirmed / partial cancel.
- #102/#103 also have `REFUND_ADJUSTED` events even when refund = quote.
- E10 Nexus chip “Refund failed” matches DB `refund_status=FAILED`.

**Wrong DB reminder:** plain `travelx` on gtx-dev does **not** hold these rows — always use **`travelx_migration_testing`** for ak-api cancel suite.

## Retest — A7 / desk banner / F5 (19 Nov 2026 evening)

**Build:** `app.10d10b28.js` (via `/assets/entrypoints.json`)

| Bug | Cases checked | Verdict | Evidence |
|-----|---------------|---------|----------|
| **A7** Other deductions duplicates Convenience | `BR1795088373763911` edit-flight/1613 · `BR1795088345226462` edit-flight/1611 | **STILL BUG** | Both Money Cancellation blocks: **Convenience fee kept ₹350** **and** **Other deductions ₹350** · Kept total ₹1,283.40 (483.40+100+350+350) vs expected kept ≈ ₹933.40 |
| **Desk banner** after settle (pax still flying) | #97 `BR1795087355209478` · #99 `BR1795088348919454` · #104 `BR1795091441315761` | **FIXED** | #97/#99: *“No passenger is fully cancelled; all 2 are still travelling, and the only request is closed.”* · #104: *“1 of 2 passengers is cancelled; 1 is still travelling, and all 4 requests are closed.”* — no longer claims “All 2 passengers are cancelled…” |
| **F5** quoted fare high/low wrong split | Open desk #101 `BR1795090713905455` (Settle) | **STILL BUG** | Warning: quoted ₹25,857 “looks high” vs even-split ₹12,928.50 across **4 passenger-sectors still travelling** — request is **PAX1 · PNQ→RKT only** (not 4-sector scope). #106 open settle (₹4,520.50 / 1-of-4 share) had **no** warning |

### Channel one-liner

Banner **fixed** on #97/#99/#104. **A7** and **F5** still open on `app.10d10b28.js`.

## Akshay reply map + fresh retest (19 Nov ~21:00 IST)

Your 3 screenshots ↔ his reply ↔ our check:

| # | Your report | Dev reply | Retest |
|---|-------------|-----------|--------|
| **1** | Desk banner “all 2 passengers cancelled” after single-pax onward | Fixed + deployed | **FIXED** (earlier #97/#99/#104) |
| **2** | OW Money Convenience ₹350 + Other deductions ₹350 | Fixed + deployed | **FIXED** on fresh OW online cancel `BR1795102051513893` · #109 — Convenience ₹350 only · Kept **₹933.40** · **no Other deductions** · refund ₹4,250.60 |
| **3** | F5 quote “looks high” ÷4 vs ÷2 | Accepted for now (single-PNR multi-sector; warning until that case ships) | **ACCEPTED / hold** |
| **4** *(his find)* | Money card “2 pax cancelled” after refuse 1 + settle 1 | Fixed — reproduce | **PASS** on `BR1795102326635514` #108 |

### #4 repro steps + result

1. Booked DEL↔PNQ 2ADT Confirmed `BR1795102326635514` (ak-api · 2 PNRs).  
2. Raised offline **both pax on onward only** (Rohan+Amit · SIM-HEHG57) → desk **#108**.  
3. Settle: **Cancelled some** · PAX1 Cancelled · PAX2 Refused · refund ₹4,333.  
4. Post-settle desk: banner *“No passenger is fully cancelled; all 2 are still travelling…”* · Money Adds up Refunded 4333 / Still booked 14124 · **no “2 pax cancelled”**.  
   Soft: statement still labels line `Refund #108 PAX1, PAX2` / “Fare paid for PAX1, PAX2” (request scope) while only PAX1 settled — not the old false “2 cancelled” banner.

### Fresh fixtures this pass

| BR | Role |
|----|------|
| `BR1795102051513893` | OW online cancel → A7 FIXED |
| `BR1795102053842655` | RT same-PNR (Rohan offline #107 left open; 2nd pax online-only) |
| `BR1795102269207724` | OW 2ADT spare |
| `BR1795102326635514` | #4 refuse+settle PASS |

### Follow-up: “single pax one leg → two requests?” (19 Nov ~21:10)

| Check | Result |
|-------|--------|
| Clean fixture | `BR1795102726995850` — tick only Rohan onward → **1 CR `#112`** (PASS) |
| **Rohan SS** `BR1795102326635514` | **BUG** — see below |

#### BUG — raise 1 pax × 1 leg creates 2 CRs (`BR1795102326635514`)

After #108 (Cancelled some: Rohan settled / Amit refused on onward):

| SS | What |
|----|------|
| Dialog | Only **Amit · PNQ→DEL** (`SIM-PBCOUS`) ticked · Amit DEL→PNQ **unticked** · Rohan onward already cancelled |
| Desk after raise | **OPEN REQUESTS 2 to settle** · **#111** PAX2 `SIM-PBCOUS` · **#110** PAX2 `SIM-HEHG57` (same timestamp 09:06 pm) |
| Pax table | PAX2 **Cancellation Requested on both legs** |

**Expected:** 1 request (#111 return only).  
**Actual:** Extra **#110** on onward PNR that was not ticked.  
Likely tied to prior #108 Cancelled-some / refuse state on that PNR — clean book did not duplicate.

#### Bug #5 repro matrix (fresh `BR1795103244886728`)

| Pattern | Steps | Result |
|---------|-------|--------|
| A — first raise ever | 1 pax × 1 leg | **1 CR** (#112 style) PASS |
| B — after clean settle | Settle Rohan onward #113 → raise Amit return only | **1 CR #114** · OPEN REQUESTS **1** — **does not repro** |
| C — after Cancelled-some | Raise **both** pax same PNR → settle 1 / refuse 1 → later raise refused pax on **other** leg | **2 CRs** (#110+#111) — **BUG** |

**Repro for Akshay (pattern C):** 2ADT 2-PNR RT → offline both pax on onward → desk **Cancelled some** (settle PAX1, refuse PAX2) → cancel dialog tick **only PAX2 on return** → expect 1 CR, get 2 (return + ghost onward).

### Bug #5 re-repro on fresh book (20 Nov ~12:20) — **NOT REPRO**

| Step | BR `BR1795156611803979` (ak-api · edit-flight/1624 · SIM-U1IZO2 / SIM-JNV0T6) |
|------|---|
| 1 | Offline both pax onward only → **#117** |
| 2 | Desk **Cancelled some** · PAX1 Rohan Cancelled · PAX2 Amit Refused · refund ₹4,333 (#156) |
| 3 | Cancel dialog tick **only Amit · PNQ→DEL** (`SIM-JNV0T6`) → raise offline |
| **Result** | **OPEN REQUESTS 1** · only **#118** Amit return · **no ghost** onward CR · SS `bug5-fresh-patternC-NOT-REPRO.png` |

Same pattern C that produced #110+#111 on `…5514` now yields **1 CR**. Treat #5 as **NOT REPRO on fresh** (intermittent / already mitigated) unless it returns.

Also: user’s other fresh `BR1795156310451709` after settle #115 → raise Rohan return → **#116 only** (OPEN 1) — same non-dupe.

### Unblocked leftovers (20 Nov ~12:40) — H3 / H4 / C8

| ID | Status | Evidence |
|----|--------|----------|
| **H3** | **PASS** | RT `BR1795158581348894` · PENALTY onward `SIM-HTA53C` http 200 · estRefund **7732.6** / charge **1431.4** |
| **H4** | **PASS** (ak-api only) | After v2 CANCEL onward · PENALTY return `SIM-7Q023G` http 200 · estRefund **8501.2** (not shrunk vs first quote; paidTotal 18832). Full master↔staging JSON diff still **NOT TESTED** |
| **C8** | **PASS** | RT `BR1795158766189352` · cancel dialog open → API cancelled onward `SIM-7X04T2` in other session → submit → **HTTP 409** `This booking changed since the page was opened. Reload it and check which PNRs are still live before cancelling.` · outcome rejected |
| H6–H8 webhooks | **WAITING** | Need DB webhook paste — BRs below |
| H9 / D / C3–C7 / C9 | **NOT TESTED** | Still blocked (stuck seed / Stripe / vendor fail) |

**Webhook paste BRs (from DB):**
| Case | BR |
|------|-----|
| H6 online cancel | `BR1795102051513893` (#109) · alt `BR1795088345226462` (#100) · also today’s OW cancel `BR1795158589612801` |
| H7 offline settle + fee change | `BR1795091441315761` (#104 penalty override) |
| H8 Cancelled some | `BR1795156611803979` (#117) · alt `BR1795102326635514` (#108) |

Report JSON: `h3-h4-c8-probe.json`

## Next

1. Channel: #1+#2+#4 verified fixed; #3 hold per Akshay; **#5 NOT REPRO on fresh Pattern C**.  
2. Soft leftovers: A2 Fare NORMAL · E10 chip · statement “PAX1, PAX2” label on Cancelled-some.  
3. Paste webhook payloads for H6–H8 BRs above → score webhooks.
