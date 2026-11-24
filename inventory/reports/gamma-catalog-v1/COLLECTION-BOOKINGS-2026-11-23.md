# Gamma collection bookings — 2026-11-24T07:58:17.997Z

**Base:** https://gamma-api.travelvip.ai

| Case | Product | Status | BR / notes |
|---|---|---|---|
| INV | lounge | PASS |   collection-product Marhaba Lounge (F3,F4) |
| W1_finalize | lounge | PASS | BR1795506790511647  {"status":"Pending","statusCode":200,"bookingRefId":"BR1795506790511647","bookin |
| W1_status | lounge | PASS | BR1795506790511647  Pending |
| C1_create | lounge | PASS | BR1795507084160278  {"bookingReference":"BR1795507084160278","paymentData":{"provider":"stripe","cus |
| Stripe | lounge | FAIL |   You cannot confirm this PaymentIntent because it has already succeeded after bei |
| INV | fasttrack | PASS |   collection-env-product HaiKou MeiLan International Airport(T1) |
| W1_finalize | fasttrack | PASS | BR1795506792886180  {"status":"Pending","statusCode":200,"bookingReference":"BR1795506792886180","pr |
| W1_status | fasttrack | PASS | BR1795506792886180  Pending |
| C1_create | fasttrack | PASS | BR1795507102172771  {"bookingReference":"BR1795507102172771","paymentData":{"provider":"stripe","cus |
| Stripe | fasttrack | PASS |   succeeded |
| C2_booking | fasttrack | PASS | BR1795507102172771  {"status":200,"bookingReferenceId":"BR1795507102172771","bookingStatus":"pending |
| C2_status | fasttrack | PASS | BR1795507102172771  Pending |
