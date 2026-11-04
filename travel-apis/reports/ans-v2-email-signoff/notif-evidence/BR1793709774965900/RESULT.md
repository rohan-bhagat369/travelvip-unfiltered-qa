# Entertainer · eSIM · BR1793709774965900

**Partner:** the ENTERTAINER Lifestyle (`lambda-ent.travelvip.ai`)  
**Page:** email-only (no UI session)  
**Verdict: PASS** — User/Admin/CS Confirmed; Entertainer subject + chrome; amounts/order aligned.

| Check | Result |
|-------|--------|
| User | PASS — `[DEV] the ENTERTAINER Lifestyle \| Your Esim Booking Confirmed \| BR1793709774965900` · 3 Nov 6:13 PM · to `rohan@travelvip.ai` |
| Admin | PASS — same Confirmed mail (customer = `rohan@travelvip.ai`) |
| CS (ANS V2) | PASS — `[DEV] CSV2 the ENTERTAINER Lifestyle \| Your Esim Booking \| BR1793709774965900` · through **Booking Confirmed** · Partner = the ENTERTAINER Lifestyle |
| Theme | PASS — Entertainer logo + “the ENTERTAINER Lifestyle eSim Confirmation” |
| Amount | Total **GBP 1.50** (Sub 1.67 · Savings −0.17 · Tax 0.00) = CS Total GBP 1.50 |
| Order | **6ae9d6e05aa83190301cd814** User = CS |
| Plan | Travel eSIM for Singapore · 1 Day · 500 MB |

## User ↔ CS Confirmed

| Field | User | CS Confirmed | Match |
|-------|------|--------------|-------|
| Booking ID | BR1793709774965900 | BR1793709774965900 | Yes |
| Order ID | 6ae9d6e05aa83190301cd814 | same | Yes |
| Partner | the ENTERTAINER Lifestyle | the ENTERTAINER Lifestyle | Yes |
| Plan | Travel eSIM for Singapore · 1 Day · 500 MB | same · Country Singapore | Yes |
| Guest | David Junior | David Junior | Yes |
| Total | GBP 1.50 | GBP 1.50 | Yes |
| Status | ✓ Confirmed | Booking Confirmed | Yes |

## Soft
- Subject/body casing mix: **Esim** / **eSim** / **ESim** / **eSIM** (same pattern as TC/TVS eSIM)
- Extra legacy CS thread also present: `[TravelVIP CSV2] eSIM Booking --DEV [BR1793709774965900]` · Partner **ent** / “Partner: ENT” (TravelVIP-branded duplicate alongside ANS V2 Entertainer CSV2)

## Evidence
- `email/user-confirmed.png` / `user-confirmed-lower.png`
- `email/cs-entertainer-confirmed.png`
- `email/cs-legacy-travelvip.png`
