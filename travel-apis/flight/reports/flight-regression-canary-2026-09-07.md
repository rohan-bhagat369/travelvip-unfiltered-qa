# Flight B2B regression — https://canary-api.travelvip.ai

**For:** Partner B2B APIs (pre-deploy)
**QA:** TravelVIP API Automation
**Ran at:** 2026-09-07T13:58:19.961Z
**Tags:** AUTH, VALIDATE, SMOKE, CORR

## Score

| PASS | BUG | NOT TESTED | Total |
|-----:|----:|-----------:|------:|
| 113 | 9 | 0 | 122 |

| Tag | PASS | BUG | NOT TESTED | Total |
|-----|-----:|----:|-----------:|------:|
| AUTH | 29 | 0 | 0 | 29 |
| VALIDATE | 78 | 8 | 0 | 86 |
| SMOKE | 3 | 1 | 0 | 4 |
| E2E | 1 | 0 | 0 | 1 |
| CORR | 2 | 0 | 0 | 2 |

## Environment

| Field | Value |
|-------|-------|
| Base URL | `https://canary-api.travelvip.ai` |
| Correlation ID | `b3fbc832-da66-4a24-9510-a43300176d9e` |
| Booking BR | `—` |
| Booking status | — |
| Elapsed | 83549 ms |

## AUTH

Score: PASS **29** / BUG **0** / NOT TESTED **0**

| # | Rule | How tested | Status |
|---|------|------------|--------|
| 1 | POST /auth/partner/token — valid partner_id + partner_secret returns access_token and refresh_token | POST /auth/partner/token with partner_id/partner_secret from env (this is the baseline for mutations below). | **PASS** |
| 2 | POST /auth/partner/token — omit partner_id | POST /auth/partner/token body { partner_secret } only. | **PASS** |
| 3 | POST /auth/partner/token — omit partner_secret | POST /auth/partner/token body { partner_id } only. | **PASS** |
| 4 | POST /auth/partner/token — empty JSON body | POST /auth/partner/token body {}. | **PASS** |
| 5 | POST /auth/partner/token — partner_id with trailing comma | POST /auth/partner/token clone valid credentials then change the named field (extra comma / special chars). | **PASS** |
| 6 | POST /auth/partner/token — partner_secret with trailing comma | POST /auth/partner/token clone valid credentials then change the named field (extra comma / special chars). | **PASS** |
| 7 | POST /auth/partner/token — partner_id with punctuation !@#$ | POST /auth/partner/token clone valid credentials then change the named field (extra comma / special chars). | **PASS** |
| 8 | POST /auth/partner/token — partner_id with HTML/script chars | POST /auth/partner/token clone valid credentials then change the named field (extra comma / special chars). | **PASS** |
| 9 | POST /auth/partner/token — partner_id with quote/semicolon | POST /auth/partner/token clone valid credentials then change the named field (extra comma / special chars). | **PASS** |
| 10 | POST /auth/partner/refresh — valid refresh_token returns a new access_token | POST /auth/partner/refresh body { refresh_token } from the access-token response. | **PASS** |
| 11 | POST /auth/partner/refresh — empty refresh_token | POST /auth/partner/refresh body { refresh_token: "" }. | **PASS** |
| 12 | POST /auth/partner/refresh — refresh_token with trailing comma | POST /auth/partner/refresh clone/mutate refresh_token with extra comma or special chars. | **PASS** |
| 13 | POST /auth/partner/refresh — refresh_token punctuation !@#$ | POST /auth/partner/refresh clone/mutate refresh_token with extra comma or special chars. | **PASS** |
| 14 | POST /auth/partner/refresh — refresh_token HTML/script chars | POST /auth/partner/refresh clone/mutate refresh_token with extra comma or special chars. | **PASS** |
| 15 | POST /auth/partner/refresh — refresh_token is only a comma | POST /auth/partner/refresh clone/mutate refresh_token with extra comma or special chars. | **PASS** |
| 16 | POST /v1/auth/session — valid X-Partner-Key + tierId returns auth_token | POST /v1/auth/session with X-Partner-Key = partner access_token and body { tierId } from env. | **PASS** |
| 17 | POST /v1/auth/session — omit X-Partner-Key | POST /v1/auth/session with no X-Partner-Key header, body { tierId }. | **PASS** |
| 18 | POST /v1/auth/session — invalid X-Partner-Key | POST /v1/auth/session X-Partner-Key=gmr_at_invalid_access_token, body { tierId }. | **PASS** |
| 19 | POST /v1/auth/session — X-Partner-Key with trailing comma | POST /v1/auth/session clone valid user-auth request then add extra comma / special chars on X-Partner-Key. | **PASS** |
| 20 | POST /v1/auth/session — X-Partner-Key with punctuation | POST /v1/auth/session clone valid user-auth request then add extra comma / special chars on X-Partner-Key. | **PASS** |
| 21 | POST /v1/auth/session — X-Partner-Key with HTML/script chars | POST /v1/auth/session clone valid user-auth request then add extra comma / special chars on X-Partner-Key. | **PASS** |
| 22 | POST /v1/auth/session — tierId with trailing comma | POST /v1/auth/session clone valid user-auth request then add extra comma / special chars on tierId. | **PASS** |
| 23 | POST /v1/auth/session — tierId with punctuation | POST /v1/auth/session clone valid user-auth request then add extra comma / special chars on tierId. | **PASS** |
| 24 | POST /v1/auth/session — tierId with HTML/script chars | POST /v1/auth/session clone valid user-auth request then add extra comma / special chars on tierId. | **PASS** |
| 25 | POST /v1/flights/search — omit Authorization Bearer | Same valid search body, no Bearer header, keep X-Partner-Key. | **PASS** |
| 26 | POST /v1/flights/search — garbage Bearer token | Authorization: Bearer gmr_at_invalid<> on OW search. | **PASS** |
| 27 | POST /api/v2/flights/booking/issue-ticket — omit X-Partner-Key | Bearer present, omit X-Partner-Key, stub issue-ticket body. | **PASS** |
| 28 | POST /api/v2/flights/booking/issue-ticket — X-Partner-Key with comma | X-Partner-Key=gmr_at_invalid, on stub issue-ticket. | **PASS** |
| 29 | POST /api/v2/flight/cancel — omit X-Partner-Key | Bearer present, omit X-Partner-Key, dummy bookingId. | **PASS** |

## VALIDATE

Score: PASS **78** / BUG **8** / NOT TESTED **0**

| # | Rule | How tested | Status |
|---|------|------------|--------|
| 1 | POST /api/v2/flights/booking/issue-ticket — valid priced issue-ticket body is accepted (not VALIDATION_ERROR) | Priced OW BOM→DEL (searchId=srch_58b0d5ee471e4a678a30626594c36b58, priceId=price_0f95bdc067f54bbf943f7e6bc9e69053), then POST /api/v2/flights/booking/issue-ticket with a complete ticket body (passengers, contact, priceId, bookingReference). | **PASS** |
| 2 | POST /api/v2/flights/booking/issue-ticket — type required | Clone that priced issue-ticket body, change only this field/rule (type required), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 3 | POST /api/v2/flights/booking/issue-ticket — type non-empty | Clone that priced issue-ticket body, change only this field/rule (type non-empty), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 4 | POST /api/v2/flights/booking/issue-ticket — currency required | Clone that priced issue-ticket body, change only this field/rule (currency required), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 5 | POST /api/v2/flights/booking/issue-ticket — currency non-empty | Clone that priced issue-ticket body, change only this field/rule (currency non-empty), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 6 | POST /api/v2/flights/booking/issue-ticket — language required | Clone that priced issue-ticket body, change only this field/rule (language required), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 7 | POST /api/v2/flights/booking/issue-ticket — timezone required | Clone that priced issue-ticket body, change only this field/rule (timezone required), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 8 | POST /api/v2/flights/booking/issue-ticket — bookingReference required | Clone that priced issue-ticket body, change only this field/rule (bookingReference required), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 9 | POST /api/v2/flights/booking/issue-ticket — searchIds required | Clone that priced issue-ticket body, change only this field/rule (searchIds required), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 10 | POST /api/v2/flights/booking/issue-ticket — searchIds non-empty | Clone that priced issue-ticket body, change only this field/rule (searchIds non-empty), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 11 | POST /api/v2/flights/booking/issue-ticket — journeyType required | Clone that priced issue-ticket body, change only this field/rule (journeyType required), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 12 | POST /api/v2/flights/booking/issue-ticket — journeyType enum | Clone that priced issue-ticket body, change only this field/rule (journeyType enum), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 13 | POST /api/v2/flights/booking/issue-ticket — data required | Clone that priced issue-ticket body, change only this field/rule (data required), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 14 | POST /api/v2/flights/booking/issue-ticket — priceId required | Clone that priced issue-ticket body, change only this field/rule (priceId required), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 15 | POST /api/v2/flights/booking/issue-ticket — priceId non-empty | Clone that priced issue-ticket body, change only this field/rule (priceId non-empty), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 16 | POST /api/v2/flights/booking/issue-ticket — passportType required | Clone that priced issue-ticket body, change only this field/rule (passportType required), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 17 | POST /api/v2/flights/booking/issue-ticket — passportType enum | Clone that priced issue-ticket body, change only this field/rule (passportType enum), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 18 | POST /api/v2/flights/booking/issue-ticket — includeGst required | Clone that priced issue-ticket body, change only this field/rule (includeGst required), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 19 | POST /api/v2/flights/booking/issue-ticket — contact.email required | Clone that priced issue-ticket body, change only this field/rule (contact.email required), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 20 | POST /api/v2/flights/booking/issue-ticket — contact.email format | Clone that priced issue-ticket body, change only this field/rule (contact.email format), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 21 | POST /api/v2/flights/booking/issue-ticket — contact.mobile required | Clone that priced issue-ticket body, change only this field/rule (contact.mobile required), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 22 | POST /api/v2/flights/booking/issue-ticket — contact.mobile too short | Clone that priced issue-ticket body, change only this field/rule (contact.mobile too short), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 23 | POST /api/v2/flights/booking/issue-ticket — contact.mobile too long | Clone that priced issue-ticket body, change only this field/rule (contact.mobile too long), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 24 | POST /api/v2/flights/booking/issue-ticket — contact.mobile non-digits | Clone that priced issue-ticket body, change only this field/rule (contact.mobile non-digits), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 25 | POST /api/v2/flights/booking/issue-ticket — contact.countryCode required | Clone that priced issue-ticket body, change only this field/rule (contact.countryCode required), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 26 | POST /api/v2/flights/booking/issue-ticket — gstDetails required when includeGst true | Clone that priced issue-ticket body, change only this field/rule (gstDetails required when includeGst true), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 27 | POST /api/v2/flights/booking/issue-ticket — gstNumber required | Clone that priced issue-ticket body, change only this field/rule (gstNumber required), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 28 | POST /api/v2/flights/booking/issue-ticket — gstEmailID format | Clone that priced issue-ticket body, change only this field/rule (gstEmailID format), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 29 | POST /api/v2/flights/booking/issue-ticket — passengers required | Clone that priced issue-ticket body, change only this field/rule (passengers required), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 30 | POST /api/v2/flights/booking/issue-ticket — passengers non-empty | Clone that priced issue-ticket body, change only this field/rule (passengers non-empty), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 31 | POST /api/v2/flights/booking/issue-ticket — paxId required | Clone that priced issue-ticket body, change only this field/rule (paxId required), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 32 | POST /api/v2/flights/booking/issue-ticket — type required | Clone that priced issue-ticket body, change only this field/rule (type required), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 33 | POST /api/v2/flights/booking/issue-ticket — type enum | Clone that priced issue-ticket body, change only this field/rule (type enum), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 34 | POST /api/v2/flights/booking/issue-ticket — isLead required | Clone that priced issue-ticket body, change only this field/rule (isLead required), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 35 | POST /api/v2/flights/booking/issue-ticket — title required | Clone that priced issue-ticket body, change only this field/rule (title required), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 36 | POST /api/v2/flights/booking/issue-ticket — Mrs + Male mismatch | Clone that priced issue-ticket body, change only this field/rule (Mrs + Male mismatch), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 37 | POST /api/v2/flights/booking/issue-ticket — Mr + Female mismatch | Clone that priced issue-ticket body, change only this field/rule (Mr + Female mismatch), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 38 | POST /api/v2/flights/booking/issue-ticket — firstName too short | Clone that priced issue-ticket body, change only this field/rule (firstName too short), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 39 | POST /api/v2/flights/booking/issue-ticket — firstName non-letters | Clone that priced issue-ticket body, change only this field/rule (firstName non-letters), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 40 | POST /api/v2/flights/booking/issue-ticket — lastName too short | Clone that priced issue-ticket body, change only this field/rule (lastName too short), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 41 | POST /api/v2/flights/booking/issue-ticket — gender required | Clone that priced issue-ticket body, change only this field/rule (gender required), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 42 | POST /api/v2/flights/booking/issue-ticket — gender enum | Clone that priced issue-ticket body, change only this field/rule (gender enum), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 43 | POST /api/v2/flights/booking/issue-ticket — dob required | Clone that priced issue-ticket body, change only this field/rule (dob required), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 44 | POST /api/v2/flights/booking/issue-ticket — dob future | Clone that priced issue-ticket body, change only this field/rule (dob future), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 45 | POST /api/v2/flights/booking/issue-ticket — dob format | Clone that priced issue-ticket body, change only this field/rule (dob format), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 46 | POST /api/v2/flights/booking/issue-ticket — nationality required | Clone that priced issue-ticket body, change only this field/rule (nationality required), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 47 | POST /api/v2/flights/booking/issue-ticket — adult age too young (child dob) | Clone that priced issue-ticket body, change only this field/rule (adult age too young (child dob)), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 48 | POST /api/v2/flights/booking/issue-ticket — adult 11 years on depart (1 day under 12) | Clone that priced issue-ticket body, change only this field/rule (adult 11 years on depart (1 day under 12)), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 49 | POST /api/v2/flights/booking/issue-ticket — adult with infant dob (~6 months) | Clone that priced issue-ticket body, change only this field/rule (adult with infant dob (~6 months)), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 50 | POST /api/v2/flights/booking/issue-ticket — child dob makes 12+ on depart (adult age) | Clone that priced issue-ticket body, change only this field/rule (child dob makes 12+ on depart (adult age)), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 51 | POST /api/v2/flights/booking/issue-ticket — child dob makes under 2 on depart (infant age) | Clone that priced issue-ticket body, change only this field/rule (child dob makes under 2 on depart (infant age)), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 52 | POST /api/v2/flights/booking/issue-ticket — infant dob makes 2+ on depart (child age) | Clone that priced issue-ticket body, change only this field/rule (infant dob makes 2+ on depart (child age)), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 53 | POST /api/v2/flights/booking/issue-ticket — infant dob makes 12+ on depart (adult age) | Clone that priced issue-ticket body, change only this field/rule (infant dob makes 12+ on depart (adult age)), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 54 | POST /api/v2/flights/booking/issue-ticket — cityCode required | Clone that priced issue-ticket body, change only this field/rule (cityCode required), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 55 | POST /api/v2/flights/booking/issue-ticket — cityName required | Clone that priced issue-ticket body, change only this field/rule (cityName required), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 56 | POST /api/v2/flights/booking/issue-ticket — passport required for MINI | Clone that priced issue-ticket body, change only this field/rule (passport required for MINI), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 57 | POST /api/v2/flights/booking/issue-ticket — passport number length | Clone that priced issue-ticket body, change only this field/rule (passport number length), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 58 | POST /api/v2/flights/booking/issue-ticket — passport expiry too soon | Clone that priced issue-ticket body, change only this field/rule (passport expiry too soon), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 59 | POST /api/v2/flights/booking/issue-ticket — FULL issuedDate required | Clone that priced issue-ticket body, change only this field/rule (FULL issuedDate required), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 60 | POST /api/v2/flights/booking/issue-ticket — FULL issuedCountryCode required | Clone that priced issue-ticket body, change only this field/rule (FULL issuedCountryCode required), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 61 | POST /api/v2/flights/booking/issue-ticket — exactly one isLead | Clone that priced issue-ticket body, change only this field/rule (exactly one isLead), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 62 | POST /api/v2/flights/booking/issue-ticket — no isLead | Clone that priced issue-ticket body, change only this field/rule (no isLead), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 63 | POST /api/v2/flights/booking/issue-ticket — duplicate paxId | Clone that priced issue-ticket body, change only this field/rule (duplicate paxId), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 64 | POST /api/v2/flights/booking/issue-ticket — duplicate first+last name | Clone that priced issue-ticket body, change only this field/rule (duplicate first+last name), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 65 | POST /api/v2/flights/booking/issue-ticket — firstName == lastName | Clone that priced issue-ticket body, change only this field/rule (firstName == lastName), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 66 | POST /api/v2/flights/booking/issue-ticket — child as only lead | Clone that priced issue-ticket body, change only this field/rule (child as only lead), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 67 | POST /api/v2/flights/booking/issue-ticket — more infants than adults | Clone that priced issue-ticket body, change only this field/rule (more infants than adults), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 68 | POST /api/v2/flights/booking/issue-ticket — wrong order child before adult | Clone that priced issue-ticket body, change only this field/rule (wrong order child before adult), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 69 | POST /api/v2/flights/booking/issue-ticket — child title Mr invalid | Clone that priced issue-ticket body, change only this field/rule (child title Mr invalid), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 70 | POST /api/v2/flights/booking/issue-ticket — duplicate passport numbers | Clone that priced issue-ticket body, change only this field/rule (duplicate passport numbers), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 71 | POST /api/v2/flights/booking/issue-ticket — firstName with trailing comma | Clone priced issue-ticket; set passengers[0].profile.firstName="Rohan,"; POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 72 | POST /api/v2/flights/booking/issue-ticket — lastName with trailing comma | Clone priced issue-ticket; set passengers[0].profile.lastName="Bhagat,"; POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 73 | POST /api/v2/flights/booking/issue-ticket — firstName with punctuation !@#$ | Clone priced issue-ticket; set firstName="Rohan!@#$"; POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 74 | POST /api/v2/flights/booking/issue-ticket — firstName with HTML/script chars | Clone priced issue-ticket; set firstName="Rohan<script>"; POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 75 | POST /api/v2/flights/booking/issue-ticket — currency with trailing comma (INR,) | Clone priced issue-ticket; set currency="INR,"; POST /api/v2/flights/booking/issue-ticket. | **BUG** |
| 76 | POST /api/v2/flights/booking/issue-ticket — type with trailing comma (ticket,) | Clone priced issue-ticket; set type="ticket,"; POST /api/v2/flights/booking/issue-ticket. | **BUG** |
| 77 | POST /api/v2/flights/booking/issue-ticket — journeyType with trailing comma | Clone priced issue-ticket; set journeyType="ONE_WAY,"; POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 78 | POST /api/v2/flights/booking/issue-ticket — contact.email with comma | Clone priced issue-ticket; set contact.email="rohan,bhagat@travelvip.ai"; POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 79 | POST /api/v2/flights/booking/issue-ticket — contact.mobile with comma | Clone priced issue-ticket; set contact.mobile="98765,43210"; POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 80 | POST /api/v2/flights/booking/issue-ticket — searchId with trailing comma | Clone priced issue-ticket; append comma to searchIds[0]; POST /api/v2/flights/booking/issue-ticket. | **BUG** |
| 81 | POST /api/v2/flights/booking/issue-ticket — cityName with comma and punctuation | Clone priced issue-ticket; set city.cityName="Pune, <>!"; POST /api/v2/flights/booking/issue-ticket. | **BUG** |
| 82 | POST /v1/flights/booking/issue-ticket — omit type | Clone priced ticket body, omit type, POST /v1/flights/booking/issue-ticket. | **BUG** |
| 83 | POST /v1/flights/booking/issue-ticket — firstName with trailing comma | Clone priced ticket body, set firstName="Rohan,", POST /v1/flights/booking/issue-ticket. | **BUG** |
| 84 | POST /v1/flights/booking/issue-ticket — searchId with trailing comma | Clone priced ticket body, append comma to searchIds[0], POST /v1/flights/booking/issue-ticket. | **BUG** |
| 85 | POST /api/v2/flights/booking/issue-ticket — multiple validation errors aggregated | Clone that priced issue-ticket body, change only this field/rule (multiple validation errors aggregated), then POST /api/v2/flights/booking/issue-ticket. | **PASS** |
| 86 | Search/details/pricing/SSR/seatmap validations spawn | scripts/probe-flight-search-hop-validations.js | **BUG** |

## SMOKE

Score: PASS **3** / BUG **1** / NOT TESTED **0**

| # | Rule | How tested | Status |
|---|------|------------|--------|
| 1 | Airports catalog with pid | GET /v1/flights/airports?airport=BOM | **BUG** |
| 2 | Airlines catalog | GET /v1/flights/airlines?airline=AI | **PASS** |
| 3 | citySearch with pid | GET /v1/flights/citySearch?q=Pune | **PASS** |
| 4 | OW search pid=vgm | POST /v1/flights/search DEL→BOM | **PASS** |

## E2E

Score: PASS **1** / BUG **0** / NOT TESTED **0**

| # | Rule | How tested | Status |
|---|------|------------|--------|
| 1 | No Riya in any API response | scan every captured flight response body (fareRules, search, issue, status, cancel, …) | **PASS** |

## CORR

Score: PASS **2** / BUG **0** / NOT TESTED **0**

| # | Rule | How tested | Status |
|---|------|------------|--------|
| 1 | Pin one UUID on flight hops | auth-search-no-bearer, auth-search-junk-bearer, auth-issue-no-partner-key, auth-issue-junk-partner-key, auth-cancel-no-partner-key, airports, airlines, citySearch, search-pid | **PASS** |
| 2 | Response _meta.correlation_id | echo same UUID (or documented rewrite) | **PASS** |

## Bugs for Dev

### BUG 1 — VALIDATE.SC5 POST /api/v2/flights/booking/issue-ticket — currency with trailing comma (INR,)

| | |
|---|---|
| How tested | Clone priced issue-ticket; set currency="INR,"; POST /api/v2/flights/booking/issue-ticket. |
| Expected | HTTP 4xx with error.code (VALIDATION_ERROR preferred). Must never be HTTP 500. |
| Actual | Accepted payload that added extra special characters / comma |
| Note | Accepted payload that added extra special characters / comma |

```json
{"bookingReference":"BR1788789458686152","status":"pending","message":"Booking is processing","_meta":{"correlation_id":"b3fbc832-da66-4a24-9510-a43300176d9e"}}
```

### BUG 2 — VALIDATE.SC6 POST /api/v2/flights/booking/issue-ticket — type with trailing comma (ticket,)

| | |
|---|---|
| How tested | Clone priced issue-ticket; set type="ticket,"; POST /api/v2/flights/booking/issue-ticket. |
| Expected | HTTP 4xx with error.code (VALIDATION_ERROR preferred). Must never be HTTP 500. |
| Actual | Accepted payload that added extra special characters / comma |
| Note | Accepted payload that added extra special characters / comma |

```json
{"bookingReference":"BR1788789461276791","status":"pending","message":"Booking is processing","_meta":{"correlation_id":"b3fbc832-da66-4a24-9510-a43300176d9e"}}
```

### BUG 3 — VALIDATE.SC10 POST /api/v2/flights/booking/issue-ticket — searchId with trailing comma

| | |
|---|---|
| How tested | Clone priced issue-ticket; append comma to searchIds[0]; POST /api/v2/flights/booking/issue-ticket. |
| Expected | HTTP 4xx with error.code (VALIDATION_ERROR preferred). Must never be HTTP 500. |
| Actual | HTTP 500 Internal Server Error after special chars — expected 4xx error envelope |
| Note | HTTP 500 Internal Server Error after special chars — expected 4xx error envelope |

```json
{"error":{"code":"PRICING_FETCH_FAILED","message":"Failed to fetch flight pricing details","details":null,"timestamp":"2026-09-07T13:57:42Z","request_id":"req-1788789462421"},"_meta":{"correlation_id":"b3fbc832-da66-4a24-9510-a43300176d9e"}}
```

### BUG 4 — VALIDATE.SC11 POST /api/v2/flights/booking/issue-ticket — cityName with comma and punctuation

| | |
|---|---|
| How tested | Clone priced issue-ticket; set city.cityName="Pune, <>!"; POST /api/v2/flights/booking/issue-ticket. |
| Expected | HTTP 4xx with error.code (VALIDATION_ERROR preferred). Must never be HTTP 500. |
| Actual | Accepted payload that added extra special characters / comma |
| Note | Accepted payload that added extra special characters / comma |

```json
{"bookingReference":"BR1788789462364083","status":"pending","message":"Booking is processing","_meta":{"correlation_id":"b3fbc832-da66-4a24-9510-a43300176d9e"}}
```

### BUG 5 — VALIDATE.V1-T1 POST /v1/flights/booking/issue-ticket — omit type

| | |
|---|---|
| How tested | Clone priced ticket body, omit type, POST /v1/flights/booking/issue-ticket. |
| Expected | HTTP 4xx VALIDATION_ERROR (never 500) |
| Actual | Accepted invalid v1 payload |
| Note | Accepted invalid v1 payload |

```json
{"error":{"code":"VALIDATION_ERROR","message":"Validation failed","details":["'type' is required"],"timestamp":"2026-09-07T13:57:25Z","request_id":"req-1788789445811"},"duplicate":true,"duplicateMessage":"Duplicate payload — returning previously processed response.","_meta":{"correlation_id":"b3fbc832-da66-4a24-9510-a43300176d9e"}}
```

### BUG 6 — VALIDATE.V1-SC1 POST /v1/flights/booking/issue-ticket — firstName with trailing comma

| | |
|---|---|
| How tested | Clone priced ticket body, set firstName="Rohan,", POST /v1/flights/booking/issue-ticket. |
| Expected | HTTP 4xx (never 500) |
| Actual | Accepted v1 payload with comma in firstName |
| Note | Accepted v1 payload with comma in firstName |

```json
{"error":{"code":"VALIDATION_ERROR","message":"Validation failed","details":["'data.passengers[0].profile.firstName' must contain only letters and spaces"],"timestamp":"2026-09-07T13:57:38Z","request_id":"req-1788789458304"},"duplicate":true,"duplicateMessage":"Duplicate payload — returning previously processed response.","_meta":{"correlation_id":"b3fbc832-da66-4a24-9510-a43300176d9e"}}
```

### BUG 7 — VALIDATE.V1-SC2 POST /v1/flights/booking/issue-ticket — searchId with trailing comma

| | |
|---|---|
| How tested | Clone priced ticket body, append comma to searchIds[0], POST /v1/flights/booking/issue-ticket. |
| Expected | HTTP 4xx (never 500) |
| Actual | Accepted v1 payload with comma on searchId |
| Note | Accepted v1 payload with comma on searchId |

```json
{"error":{"code":"PRICING_FETCH_FAILED","message":"Failed to fetch flight pricing details","details":null,"timestamp":"2026-09-07T13:57:42Z","request_id":"req-1788789462421"},"duplicate":true,"duplicateMessage":"Duplicate payload — returning previously processed response.","_meta":{"correlation_id":"b3fbc832-da66-4a24-9510-a43300176d9e"}}
```

### BUG 8 — VALIDATE.1 Search/details/pricing/SSR/seatmap validations spawn

| | |
|---|---|
| How tested | scripts/probe-flight-search-hop-validations.js |
| Expected | JSON report with S/H/D/P/SSR/SM rows |
| Actual | exit=1 missing flight-regression-search-hop-validations.json |

### BUG 9 — SMOKE.1 Airports catalog with pid

| | |
|---|---|
| How tested | GET /v1/flights/airports?airport=BOM |
| Expected | HTTP 200 list |
| Actual | HTTP 200 hits=0 code=null |
