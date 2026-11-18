# Case K — Card / Stripe (web) regression

- Base: `https://theta-api.travelvip.ai`
- Partner available this run: **vgm** (prepaid wallet B2B)
- Verdict: **NOT TESTED / BLOCKED**

## Changelog expects

| Check | Expect |
|-------|--------|
| K1 | Card/Stripe (web) flight, hotel, cab books behave as before |
| K2 | Card-paid flight + no supplier answer → still **failure** (not PENDING wallet path) |
| K3 | Partners **without a wallet** unaffected |
| K4 | No Mattermost alert on normal successful book or successful refund |

## Why blocked

| Need | Status |
|------|--------|
| Web/shop Stripe book path (not B2B wallet finalize) | Not in this runner |
| Non-wallet partner (`PARTNER_ID_2` or card partner) | Missing in `.env` |
| Stripe test card / payment session | Not configured |
| B2B `vgm` finalize → Stripe | N/A — wallet only |

Changelog also lists Card/Stripe (web) under **Not changed** — out of wallet charge-first matrix for `vgm`.

## To unblock (any one)

1. Shop/web URL on theta + Stripe test card for flight/hotel/cab, **or**
2. Non-wallet partner credentials that book via card, **or**
3. Point to existing recent Stripe BRs on theta DB to spot-check regression (K1/K4 only; K2 needs a live `provider_no_response`-style card book)

## Optional DB spot-check (phpMyAdmin travelx)

Recent Stripe payments (not proof of Case K matrix, but sanity that card path still writes):

```sql
SELECT p.id, b.booking_reference, bi.service_type, p.provider, p.status, p.total_amount, p.created_at
FROM payment p
JOIN booking b ON b.id = p.booking_id
JOIN booking_item bi ON bi.booking_id = b.id
WHERE p.provider = 'stripe'
ORDER BY p.id DESC
LIMIT 20;
```

Partner webhook noise check for a successful Stripe BR (K4 — expect no critical wallet alerts; events may still exist):

```sql
SELECT id, partner, name, booking_id, booking_status, created_at
FROM webhook_events
WHERE booking_id = '<BR_FROM_ABOVE>'
ORDER BY id;
```

## Score

| Sub-check | Verdict |
|-----------|---------|
| K1 web books unchanged | **NOT TESTED** |
| K2 card-paid flight no-answer → failure | **NOT TESTED** |
| K3 non-wallet partners | **NOT TESTED** |
| K4 no alert on success book/refund | **NOT TESTED** |
| Overall Case K | **NOT TESTED** |
