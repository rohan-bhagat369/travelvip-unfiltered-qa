# Old-flow legacy key check — 23 Nov 2026

## Key that works

From canary/staging `.env` `PARTNER_SECRET=vgm_ojny1swtigd4as` → legacy query key:

```text
pid=vgm
key=ojny1swtigd4as
```

(Apidog also listed this as `ojny1swtigd4as` alongside SMT `palsgcvgscvvs`.)

| Candidate | Canary `/api/airportServices/offers` |
|---|---|
| `palsgcvgscvvs` | 403 `INVALID_PARTNER_KEY` |
| `vgm_ojny1swtigd4as` (full secret) | 403 `INVALID_PARTNER_KEY` |
| partner `access_token` | 403 `INVALID_PARTNER_KEY` |
| **`ojny1swtigd4as`** | **200** (empty offers `[]` OK) |

Staging: old `/api/airportServices/offers` → **404** (route not exposed the same way).

## L* with working key

| Case | Result | Notes |
|---|---|---|
| **L8** offers | **PASS** | key accepted |
| **L5** history | **PASS** | returned bookings |
| **L6** fetch status shape | **PASS** | 400 `bookingReferenceId is required` (route alive) |
| **L1** createBooking | **CHECK** | key OK; body `Lounge option not found in catalog` (old catalog vs new lounge option) |
| **L2 / L4 / L7** | NT | need successful L1 BR |
| **L3** webhook | NT | still needs webhook delivery |

## Ask Dev (only if closing L1)

Old `createBooking` does not resolve current v1 lounge `bookingReference` / option (“Lounge option not found in catalog”). Need either a valid **old-catalog** lounge option/context for canary, or confirm old L1 is out of scope when catalog_v1 is primary.
