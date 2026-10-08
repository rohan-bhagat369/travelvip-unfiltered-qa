# Hotel Listing v2 — canary bug report (sort / filter / paging)

For backend: listing v2 spec vs canary. Each bug is clone-baseline → mutate one field → call.

## Environment

- Ran at (UTC): `2026-08-15T15:57:00.686Z`
- Base: `https://canary-api.travelvip.ai`
- Spec path: `POST /api/hotels/v2/availability/listing`
- Live path used after spec 404: `POST /v1/hotels/search`
- pid: `vgm`
- Correlation ID sent: `0bd455b1-1a34-4dbc-bccd-655dd51e0ce9`
- City: Pune TBOCITY (doc sample) entityId=`328605:IN` type=`TBOCITY`
- Dates: 2026-09-12 → 2026-09-13 · currency INR
- Score: **PASS 9 / BUG 22 / NOT TESTED 4** (35 cases)

## What is broken (one paragraph)

`POST /api/hotels/v2/availability/listing` is **not deployed** on canary (HTTP 404). `POST /v1/hotels/search` already **returns** the listing v2 envelope (`sorts`, `filters` with `facetKey`, `offset`, `size`, `last`, `totalResults`), but **does not apply** query `sort` / `offset` / `limit` or body `fq[]`. Every mutated call returns the same first page of hotels. Invalid paging inputs (`offset=-1`, `offset=abc`, `limit=0`) also return HTTP 200 with that same page instead of 4xx.

## Baseline request (use this for bugs 2+)

`POST /v1/hotels/search`

Query:
```
pid=vgm&tierId=10546901&subscriptionId=15045625496a6327&offset=0&limit=5&sort=price_ASC
```
Body:
```json
{
  "checkin": "2026-09-12",
  "checkout": "2026-09-13",
  "type": "TBOCITY",
  "entityId": "328605:IN",
  "nationality": "IN",
  "rooms": [
    {
      "adults": 1,
      "children": 0,
      "childrenAges": []
    }
  ],
  "currency": "INR",
  "language": "en",
  "rt": "compact",
  "requestId": ""
}
```
Baseline response (slim):
```json
{
  "http": 200,
  "page": 0,
  "offset": 0,
  "size": 10,
  "last": false,
  "totalResults": 302,
  "totalPages": 31,
  "requestId": "3e5c0463-77c6-46d7-8b65-71b77aec8b84",
  "currency": "INR",
  "sorts": [
    "price_ASC",
    "price_DESC"
  ],
  "filterNames": [
    "Star Rating|df_long_star_rating|facets=3",
    "Free cancellation|Reservation policy|facets=1"
  ],
  "hotels": [
    {
      "id": "15237042",
      "name": "Keys Prima by Lemon Tree Hotels, Pimpri Pune",
      "starRating": 3,
      "refundable": true,
      "baseFare": 5713.6,
      "totalAmount": 6570.64
    },
    {
      "id": "72379936",
      "name": "Via Royal Stay I",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1333.68,
      "totalAmount": 1402.21
    },
    {
      "id": "72241152",
      "name": "Fabhotel Royal Inn I",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1230.93,
      "totalAmount": 1293.73
    },
    {
      "id": "39604638",
      "name": "Treebo Diamond Residency - DDPK Inn",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1971.62,
      "totalAmount": 2072.47
    },
    {
      "id": "70487786",
      "name": "Fabhotel Prime Athiti Delight Stay",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1370.69,
      "totalAmount": 1439.22
    }
  ]
}
```

## Score by section

| Section | PASS | BUG | NOT TESTED |
|---|---:|---:|---:|
| Shape | 3 | 1 | 0 |
| Sort | 3 | 4 | 0 |
| Filter | 2 | 5 | 3 |
| Paging | 1 | 12 | 1 |

## Bugs — exact steps

### Bug 1 — [Shape.1] Documented listing path exists on canary

**How tested:** POST /api/hotels/v2/availability/listing?offset=0&limit=5&sort=price_ASC

**Steps**
1. Auth (partner token + user session, `tierId=10546901`). Send `X-Partner-Key` = partner access token.
2. Start from the baseline request above (`POST /v1/hotels/search`).
3. Mutate only: POST /api/hotels/v2/availability/listing?offset=0&limit=5&sort=price_ASC
4. Compare HTTP status + listing fields against expected.

**Expected:** HTTP 200 listing envelope (not 404 Page not found)

**Actual:** HTTP 404 {"status":404,"info":"Page not found"} 46ms

**Payload mutation:**
```json
{
  "path": "/api/hotels/v2/availability/listing",
  "query": {
    "pid": "vgm",
    "tierId": 10546901,
    "subscriptionId": "15045625496a6327",
    "offset": 0,
    "limit": 5,
    "sort": "price_ASC"
  },
  "body": {
    "checkin": "2026-09-12",
    "checkout": "2026-09-13",
    "type": "TBOCITY",
    "entityId": "328605:IN",
    "nationality": "IN",
    "rooms": [
      {
        "adults": 1,
        "children": 0,
        "childrenAges": []
      }
    ],
    "currency": "INR",
    "language": "en",
    "rt": "compact",
    "requestId": ""
  }
}
```
**Response (slim):**
```json
{
  "http": 404,
  "code": null,
  "elapsedMs": 46,
  "resultCount": 0,
  "hotels": [],
  "sorts": [],
  "filterNames": [],
  "snippet": "{\"status\":404,\"info\":\"Page not found\"}"
}
```

### Bug 2 — [Sort.1] price_ASC orders this page by price.baseFare

**How tested:** query sort=price_ASC limit=5 (baseline)

**Steps**
1. Auth (partner token + user session, `tierId=10546901`). Send `X-Partner-Key` = partner access token.
2. Start from the baseline request above (`POST /v1/hotels/search`).
3. Mutate only: query sort=price_ASC limit=5 (baseline)
4. Compare HTTP status + listing fields against expected.

**Expected:** results non-decreasing by price.baseFare

**Actual:** fares=[5713.6,1333.68,1230.93,1971.62,1370.69,2052,4400,1631.7,2179.62,1017.42]

**Response (slim):**
```json
{
  "fares": [
    5713.6,
    1333.68,
    1230.93,
    1971.62,
    1370.69,
    2052,
    4400,
    1631.7,
    2179.62,
    1017.42
  ],
  "hotels": [
    {
      "id": "15237042",
      "name": "Keys Prima by Lemon Tree Hotels, Pimpri Pune",
      "starRating": 3,
      "refundable": true,
      "baseFare": 5713.6,
      "totalAmount": 6570.64
    },
    {
      "id": "72379936",
      "name": "Via Royal Stay I",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1333.68,
      "totalAmount": 1402.21
    },
    {
      "id": "72241152",
      "name": "Fabhotel Royal Inn I",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1230.93,
      "totalAmount": 1293.73
    },
    {
      "id": "39604638",
      "name": "Treebo Diamond Residency - DDPK Inn",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1971.62,
      "totalAmount": 2072.47
    },
    {
      "id": "70487786",
      "name": "Fabhotel Prime Athiti Delight Stay",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1370.69,
      "totalAmount": 1439.22
    }
  ]
}
```

### Bug 3 — [Sort.2] price_DESC orders this page by price.baseFare

**How tested:** clone baseline → query sort=price_DESC

**Steps**
1. Auth (partner token + user session, `tierId=10546901`). Send `X-Partner-Key` = partner access token.
2. Start from the baseline request above (`POST /v1/hotels/search`).
3. Mutate only: clone baseline → query sort=price_DESC
4. Compare HTTP status + listing fields against expected.

**Expected:** results non-increasing by price.baseFare

**Actual:** HTTP 200 fares=[5713.6,1333.68,1230.93,1971.62,1370.69,2052,4400,1631.7,2179.62,1017.42] 510ms

**Response (slim):**
```json
{
  "http": 200,
  "code": null,
  "elapsedMs": 510,
  "page": 0,
  "offset": 0,
  "size": 10,
  "last": false,
  "totalResults": 302,
  "availableResults": 302,
  "totalPages": 31,
  "requestId": "f687656b-db8e-4495-92a4-0153bdc01811",
  "currency": "INR",
  "resultCount": 10,
  "hotels": [
    {
      "id": "15237042",
      "name": "Keys Prima by Lemon Tree Hotels, Pimpri Pune",
      "starRating": 3,
      "refundable": true,
      "baseFare": 5713.6,
      "totalAmount": 6570.64
    },
    {
      "id": "72379936",
      "name": "Via Royal Stay I",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1333.68,
      "totalAmount": 1402.21
    },
    {
      "id": "72241152",
      "name": "Fabhotel Royal Inn I",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1230.93,
      "totalAmount": 1293.73
    },
    {
      "id": "39604638",
      "name": "Treebo Diamond Residency - DDPK Inn",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1971.62,
      "totalAmount": 2072.47
    },
    {
      "id": "70487786",
      "name": "Fabhotel Prime Athiti Delight Stay",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1370.69,
      "totalAmount": 1439.22
    }
  ],
  "sorts": [
    "price_ASC",
    "price_DESC"
  ],
  "filterNames": [
    "Star Rating|df_long_star_rating|facets=3",
    "Free cancellation|Reservation policy|facets=1"
  ],
  "snippet": "{\"page\":0,\"size\":10,\"offset\":0,\"totalResults\":302,\"totalPages\":31,\"availableResults\":302,\"last\":false,\"results\":[{\"id\":\"15237042\",\"name\":\"Keys Prima by Lemon Tree Hotels, Pimpri Pune\",\"address\":\"Near PCMC Office, 31/6\",\"distance\":null,\"image\":\"https://i.travelapi.com/lodging/5000"
}
```

### Bug 4 — [Sort.3] DESC first fare >= ASC first fare

**How tested:** Compare first hotel of price_ASC vs price_DESC on same search

**Steps**
1. Auth (partner token + user session, `tierId=10546901`). Send `X-Partner-Key` = partner access token.
2. Start from the baseline request above (`POST /v1/hotels/search`).
3. Mutate only: Compare first hotel of price_ASC vs price_DESC on same search
4. Compare HTTP status + listing fields against expected.

**Expected:** price_DESC[0].baseFare >= price_ASC[0].baseFare

**Actual:** ASC first=5713.6 DESC first=5713.6


### Bug 5 — [Sort.4] sort on every page — page 2 continues global ASC

**How tested:** same body + requestId; query offset=10&sort=price_ASC

**Steps**
1. Auth (partner token + user session, `tierId=10546901`). Send `X-Partner-Key` = partner access token.
2. Start from the baseline request above (`POST /v1/hotels/search`).
3. Mutate only: same body + requestId; query offset=10&sort=price_ASC
4. Compare HTTP status + listing fields against expected.

**Expected:** page2[0].baseFare >= page1[last].baseFare; page 2 still ASC; no overlapping ids

**Actual:** HTTP 200 p2fares=[5713.6,1333.68,1230.93,1971.62,1370.69,2052,4400,1631.7,2179.62,1017.42] lastP1=1017.42 overlap=15237042,72379936,72241152,39604638,70487786,72395060,72419366,71037232,39452499,15599148

**Response (slim):**
```json
{
  "http": 200,
  "code": null,
  "elapsedMs": 302,
  "page": 0,
  "offset": 0,
  "size": 10,
  "last": false,
  "totalResults": 302,
  "availableResults": 302,
  "totalPages": 31,
  "requestId": "6cddfb83-fb53-432b-b3d2-9e1e62f0bce3",
  "currency": "INR",
  "resultCount": 10,
  "hotels": [
    {
      "id": "15237042",
      "name": "Keys Prima by Lemon Tree Hotels, Pimpri Pune",
      "starRating": 3,
      "refundable": true,
      "baseFare": 5713.6,
      "totalAmount": 6570.64
    },
    {
      "id": "72379936",
      "name": "Via Royal Stay I",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1333.68,
      "totalAmount": 1402.21
    },
    {
      "id": "72241152",
      "name": "Fabhotel Royal Inn I",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1230.93,
      "totalAmount": 1293.73
    },
    {
      "id": "39604638",
      "name": "Treebo Diamond Residency - DDPK Inn",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1971.62,
      "totalAmount": 2072.47
    },
    {
      "id": "70487786",
      "name": "Fabhotel Prime Athiti Delight Stay",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1370.69,
      "totalAmount": 1439.22
    }
  ],
  "sorts": [
    "price_ASC",
    "price_DESC"
  ],
  "filterNames": [
    "Star Rating|df_long_star_rating|facets=3",
    "Free cancellation|Reservation policy|facets=1"
  ],
  "snippet": "{\"page\":0,\"size\":10,\"offset\":0,\"totalResults\":302,\"totalPages\":31,\"availableResults\":302,\"last\":false,\"results\":[{\"id\":\"15237042\",\"name\":\"Keys Prima by Lemon Tree Hotels, Pimpri Pune\",\"address\":\"Near PCMC Office, 31/6\",\"distance\":null,\"image\":\"https://i.travelapi.com/lodging/5000"
}
```

### Bug 6 — [Filter.1] Single facet fq filters results

**How tested:** clone → fq=["df_long_star_rating:5"]

**Steps**
1. Auth (partner token + user session, `tierId=10546901`). Send `X-Partner-Key` = partner access token.
2. Start from the baseline request above (`POST /v1/hotels/search`).
3. Mutate only: clone → fq=["df_long_star_rating:5"]
4. Compare HTTP status + listing fields against expected.

**Expected:** HTTP 200; every result starRating=5; totalResults reflects filtered set

**Actual:** HTTP 200 n=10 stars=[3,3,3,3,3,0,3,0,3,2] total=302 unfiltered=302 307ms

**Payload mutation:**
```json
{
  "fq": [
    "df_long_star_rating:5"
  ]
}
```
**Response (slim):**
```json
{
  "http": 200,
  "code": null,
  "elapsedMs": 307,
  "page": 0,
  "offset": 0,
  "size": 10,
  "last": false,
  "totalResults": 302,
  "availableResults": 302,
  "totalPages": 31,
  "requestId": "b8a402d5-0b97-475f-8ec7-1923a8214ee8",
  "currency": "INR",
  "resultCount": 10,
  "hotels": [
    {
      "id": "15237042",
      "name": "Keys Prima by Lemon Tree Hotels, Pimpri Pune",
      "starRating": 3,
      "refundable": true,
      "baseFare": 5713.6,
      "totalAmount": 6570.64
    },
    {
      "id": "72379936",
      "name": "Via Royal Stay I",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1333.68,
      "totalAmount": 1402.21
    },
    {
      "id": "72241152",
      "name": "Fabhotel Royal Inn I",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1230.93,
      "totalAmount": 1293.73
    },
    {
      "id": "39604638",
      "name": "Treebo Diamond Residency - DDPK Inn",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1971.62,
      "totalAmount": 2072.47
    },
    {
      "id": "70487786",
      "name": "Fabhotel Prime Athiti Delight Stay",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1370.69,
      "totalAmount": 1439.22
    }
  ],
  "sorts": [
    "price_ASC",
    "price_DESC"
  ],
  "filterNames": [
    "Star Rating|df_long_star_rating|facets=3",
    "Free cancellation|Reservation policy|facets=1"
  ],
  "snippet": "{\"page\":0,\"size\":10,\"offset\":0,\"totalResults\":302,\"totalPages\":31,\"availableResults\":302,\"last\":false,\"results\":[{\"id\":\"15237042\",\"name\":\"Keys Prima by Lemon Tree Hotels, Pimpri Pune\",\"address\":\"Near PCMC Office, 31/6\",\"distance\":null,\"image\":\"https://i.travelapi.com/lodging/5000"
}
```

### Bug 7 — [Filter.3] Several values use semicolon, not comma

**How tested:** clone → fq=["df_long_star_rating:5;4"]

**Steps**
1. Auth (partner token + user session, `tierId=10546901`). Send `X-Partner-Key` = partner access token.
2. Start from the baseline request above (`POST /v1/hotels/search`).
3. Mutate only: clone → fq=["df_long_star_rating:5;4"]
4. Compare HTTP status + listing fields against expected.

**Expected:** HTTP 200; every starRating in {5,4}

**Actual:** HTTP 200 n=10 stars=[3,3,3,3,3,0,3,0,3,2] total=302

**Payload mutation:**
```json
{
  "fq": [
    "df_long_star_rating:5;4"
  ]
}
```
**Response (slim):**
```json
{
  "http": 200,
  "code": null,
  "elapsedMs": 304,
  "page": 0,
  "offset": 0,
  "size": 10,
  "last": false,
  "totalResults": 302,
  "availableResults": 302,
  "totalPages": 31,
  "requestId": "583b29c9-d047-4af1-87c5-018b1709736c",
  "currency": "INR",
  "resultCount": 10,
  "hotels": [
    {
      "id": "15237042",
      "name": "Keys Prima by Lemon Tree Hotels, Pimpri Pune",
      "starRating": 3,
      "refundable": true,
      "baseFare": 5713.6,
      "totalAmount": 6570.64
    },
    {
      "id": "72379936",
      "name": "Via Royal Stay I",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1333.68,
      "totalAmount": 1402.21
    },
    {
      "id": "72241152",
      "name": "Fabhotel Royal Inn I",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1230.93,
      "totalAmount": 1293.73
    },
    {
      "id": "39604638",
      "name": "Treebo Diamond Residency - DDPK Inn",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1971.62,
      "totalAmount": 2072.47
    },
    {
      "id": "70487786",
      "name": "Fabhotel Prime Athiti Delight Stay",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1370.69,
      "totalAmount": 1439.22
    }
  ],
  "sorts": [
    "price_ASC",
    "price_DESC"
  ],
  "filterNames": [
    "Star Rating|df_long_star_rating|facets=3",
    "Free cancellation|Reservation policy|facets=1"
  ],
  "snippet": "{\"page\":0,\"size\":10,\"offset\":0,\"totalResults\":302,\"totalPages\":31,\"availableResults\":302,\"last\":false,\"results\":[{\"id\":\"15237042\",\"name\":\"Keys Prima by Lemon Tree Hotels, Pimpri Pune\",\"address\":\"Near PCMC Office, 31/6\",\"distance\":null,\"image\":\"https://i.travelapi.com/lodging/5000"
}
```

### Bug 8 — [Filter.4] Several filters combined (AND)

**How tested:** clone → fq=["df_long_star_rating:5","Reservation policy:Free cancellation"]

**Steps**
1. Auth (partner token + user session, `tierId=10546901`). Send `X-Partner-Key` = partner access token.
2. Start from the baseline request above (`POST /v1/hotels/search`).
3. Mutate only: clone → fq=["df_long_star_rating:5","Reservation policy:Free cancellation"]
4. Compare HTTP status + listing fields against expected.

**Expected:** HTTP 200; star filter still holds; totalResults <= single-star total

**Actual:** HTTP 200 n=10 total=302 singleStarTotal=302

**Payload mutation:**
```json
{
  "fq": [
    "df_long_star_rating:5",
    "Reservation policy:Free cancellation"
  ]
}
```
**Response (slim):**
```json
{
  "http": 200,
  "code": null,
  "elapsedMs": 313,
  "page": 0,
  "offset": 0,
  "size": 10,
  "last": false,
  "totalResults": 302,
  "availableResults": 302,
  "totalPages": 31,
  "requestId": "dba487e5-cd59-470d-aec4-76023d4c7d26",
  "currency": "INR",
  "resultCount": 10,
  "hotels": [
    {
      "id": "15237042",
      "name": "Keys Prima by Lemon Tree Hotels, Pimpri Pune",
      "starRating": 3,
      "refundable": true,
      "baseFare": 5713.6,
      "totalAmount": 6570.64
    },
    {
      "id": "72379936",
      "name": "Via Royal Stay I",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1333.68,
      "totalAmount": 1402.21
    },
    {
      "id": "72241152",
      "name": "Fabhotel Royal Inn I",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1230.93,
      "totalAmount": 1293.73
    },
    {
      "id": "39604638",
      "name": "Treebo Diamond Residency - DDPK Inn",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1971.62,
      "totalAmount": 2072.47
    },
    {
      "id": "70487786",
      "name": "Fabhotel Prime Athiti Delight Stay",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1370.69,
      "totalAmount": 1439.22
    }
  ],
  "sorts": [
    "price_ASC",
    "price_DESC"
  ],
  "filterNames": [
    "Star Rating|df_long_star_rating|facets=3",
    "Free cancellation|Reservation policy|facets=1"
  ],
  "snippet": "{\"page\":0,\"size\":10,\"offset\":0,\"totalResults\":302,\"totalPages\":31,\"availableResults\":302,\"last\":false,\"results\":[{\"id\":\"15237042\",\"name\":\"Keys Prima by Lemon Tree Hotels, Pimpri Pune\",\"address\":\"Near PCMC Office, 31/6\",\"distance\":null,\"image\":\"https://i.travelapi.com/lodging/5000"
}
```

### Bug 9 — [Filter.9] fq must be string array, not object

**How tested:** clone → fq={ df_long_star_rating: ["5"] } (legacy shape)

**Steps**
1. Auth (partner token + user session, `tierId=10546901`). Send `X-Partner-Key` = partner access token.
2. Start from the baseline request above (`POST /v1/hotels/search`).
3. Mutate only: clone → fq={ df_long_star_rating: ["5"] } (legacy shape)
4. Compare HTTP status + listing fields against expected.

**Expected:** 4xx VALIDATION_ERROR or ignore object; must not 500

**Actual:** HTTP 200 code=- results=10 snippet={"page":0,"size":10,"offset":0,"totalResults":302,"totalPages":31,"availableResults":302,"last":false,"results":[{"id":"15237042","name":"Keys Prima by Lemon Tree Hotels, Pimpri Pu

**Response (slim):**
```json
{
  "http": 200,
  "code": null,
  "elapsedMs": 264,
  "page": 0,
  "offset": 0,
  "size": 10,
  "last": false,
  "totalResults": 302,
  "availableResults": 302,
  "totalPages": 31,
  "requestId": "099823de-6553-42bd-ac5a-7f947208f938",
  "currency": "INR",
  "resultCount": 10,
  "hotels": [
    {
      "id": "15237042",
      "name": "Keys Prima by Lemon Tree Hotels, Pimpri Pune",
      "starRating": 3,
      "refundable": true,
      "baseFare": 5713.6,
      "totalAmount": 6570.64
    },
    {
      "id": "72379936",
      "name": "Via Royal Stay I",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1333.68,
      "totalAmount": 1402.21
    },
    {
      "id": "72241152",
      "name": "Fabhotel Royal Inn I",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1230.93,
      "totalAmount": 1293.73
    },
    {
      "id": "39604638",
      "name": "Treebo Diamond Residency - DDPK Inn",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1971.62,
      "totalAmount": 2072.47
    },
    {
      "id": "70487786",
      "name": "Fabhotel Prime Athiti Delight Stay",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1370.69,
      "totalAmount": 1439.22
    }
  ],
  "sorts": [
    "price_ASC",
    "price_DESC"
  ],
  "filterNames": [
    "Star Rating|df_long_star_rating|facets=3",
    "Free cancellation|Reservation policy|facets=1"
  ],
  "snippet": "{\"page\":0,\"size\":10,\"offset\":0,\"totalResults\":302,\"totalPages\":31,\"availableResults\":302,\"last\":false,\"results\":[{\"id\":\"15237042\",\"name\":\"Keys Prima by Lemon Tree Hotels, Pimpri Pune\",\"address\":\"Near PCMC Office, 31/6\",\"distance\":null,\"image\":\"https://i.travelapi.com/lodging/5000"
}
```
**Note:** Object accepted as 200 — spec wants string[]


### Bug 10 — [Filter.10] fq must not be a bare string

**How tested:** clone → fq="indexField:value" (not array)

**Steps**
1. Auth (partner token + user session, `tierId=10546901`). Send `X-Partner-Key` = partner access token.
2. Start from the baseline request above (`POST /v1/hotels/search`).
3. Mutate only: clone → fq="indexField:value" (not array)
4. Compare HTTP status + listing fields against expected.

**Expected:** 4xx VALIDATION_ERROR preferred; not 500

**Actual:** HTTP 200 code=- snippet={"page":0,"size":10,"offset":0,"totalResults":302,"totalPages":31,"availableResults":302,"last":false,"results":[{"id":"15237042","name":"Keys Prima by Lemon Tree Hotels, Pimpri Pu

**Response (slim):**
```json
{
  "http": 200,
  "code": null,
  "elapsedMs": 261,
  "page": 0,
  "offset": 0,
  "size": 10,
  "last": false,
  "totalResults": 302,
  "availableResults": 302,
  "totalPages": 31,
  "requestId": "fcbecb63-9217-406c-bdc8-a45d4451b06d",
  "currency": "INR",
  "resultCount": 10,
  "hotels": [
    {
      "id": "15237042",
      "name": "Keys Prima by Lemon Tree Hotels, Pimpri Pune",
      "starRating": 3,
      "refundable": true,
      "baseFare": 5713.6,
      "totalAmount": 6570.64
    },
    {
      "id": "72379936",
      "name": "Via Royal Stay I",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1333.68,
      "totalAmount": 1402.21
    },
    {
      "id": "72241152",
      "name": "Fabhotel Royal Inn I",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1230.93,
      "totalAmount": 1293.73
    },
    {
      "id": "39604638",
      "name": "Treebo Diamond Residency - DDPK Inn",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1971.62,
      "totalAmount": 2072.47
    },
    {
      "id": "70487786",
      "name": "Fabhotel Prime Athiti Delight Stay",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1370.69,
      "totalAmount": 1439.22
    }
  ],
  "sorts": [
    "price_ASC",
    "price_DESC"
  ],
  "filterNames": [
    "Star Rating|df_long_star_rating|facets=3",
    "Free cancellation|Reservation policy|facets=1"
  ],
  "snippet": "{\"page\":0,\"size\":10,\"offset\":0,\"totalResults\":302,\"totalPages\":31,\"availableResults\":302,\"last\":false,\"results\":[{\"id\":\"15237042\",\"name\":\"Keys Prima by Lemon Tree Hotels, Pimpri Pune\",\"address\":\"Near PCMC Office, 31/6\",\"distance\":null,\"image\":\"https://i.travelapi.com/lodging/5000"
}
```

### Bug 11 — [Paging.1] First page offset=0 limit=5

**How tested:** query offset=0&limit=5

**Steps**
1. Auth (partner token + user session, `tierId=10546901`). Send `X-Partner-Key` = partner access token.
2. Start from the baseline request above (`POST /v1/hotels/search`).
3. Mutate only: query offset=0&limit=5
4. Compare HTTP status + listing fields against expected.

**Expected:** response.offset=0, size=5 (or <=limit), last=false when total>5

**Actual:** offset=0 size=10 last=false total=302 page=0

**Response (slim):**
```json
{
  "offset": 0,
  "size": 10,
  "last": false,
  "page": 0,
  "totalResults": 302
}
```

### Bug 12 — [Paging.2] totalPages = ceil(totalResults / limit)

**How tested:** Compare totalPages vs ceil(totalResults/limit)

**Steps**
1. Auth (partner token + user session, `tierId=10546901`). Send `X-Partner-Key` = partner access token.
2. Start from the baseline request above (`POST /v1/hotels/search`).
3. Mutate only: Compare totalPages vs ceil(totalResults/limit)
4. Compare HTTP status + listing fields against expected.

**Expected:** totalPages=61

**Actual:** totalPages=31 total=302 limit=5


### Bug 13 — [Paging.3] Next offset = response.offset + response.size (not page*size)

**How tested:** query offset=10 (= 0+10) keep dates/entity/fq/sort

**Steps**
1. Auth (partner token + user session, `tierId=10546901`). Send `X-Partner-Key` = partner access token.
2. Start from the baseline request above (`POST /v1/hotels/search`).
3. Mutate only: query offset=10 (= 0+10) keep dates/entity/fq/sort
4. Compare HTTP status + listing fields against expected.

**Expected:** response.offset=10; no overlapping hotel ids with page 1; last=false unless end

**Actual:** HTTP 200 offset=0 overlap=15237042,72379936,72241152,39604638,70487786,72395060,72419366,71037232,39452499,15599148 last=false

**Response (slim):**
```json
{
  "http": 200,
  "code": null,
  "elapsedMs": 302,
  "page": 0,
  "offset": 0,
  "size": 10,
  "last": false,
  "totalResults": 302,
  "availableResults": 302,
  "totalPages": 31,
  "requestId": "6cddfb83-fb53-432b-b3d2-9e1e62f0bce3",
  "currency": "INR",
  "resultCount": 10,
  "hotels": [
    {
      "id": "15237042",
      "name": "Keys Prima by Lemon Tree Hotels, Pimpri Pune",
      "starRating": 3,
      "refundable": true,
      "baseFare": 5713.6,
      "totalAmount": 6570.64
    },
    {
      "id": "72379936",
      "name": "Via Royal Stay I",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1333.68,
      "totalAmount": 1402.21
    },
    {
      "id": "72241152",
      "name": "Fabhotel Royal Inn I",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1230.93,
      "totalAmount": 1293.73
    },
    {
      "id": "39604638",
      "name": "Treebo Diamond Residency - DDPK Inn",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1971.62,
      "totalAmount": 2072.47
    },
    {
      "id": "70487786",
      "name": "Fabhotel Prime Athiti Delight Stay",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1370.69,
      "totalAmount": 1439.22
    }
  ],
  "sorts": [
    "price_ASC",
    "price_DESC"
  ],
  "filterNames": [
    "Star Rating|df_long_star_rating|facets=3",
    "Free cancellation|Reservation policy|facets=1"
  ],
  "snippet": "{\"page\":0,\"size\":10,\"offset\":0,\"totalResults\":302,\"totalPages\":31,\"availableResults\":302,\"last\":false,\"results\":[{\"id\":\"15237042\",\"name\":\"Keys Prima by Lemon Tree Hotels, Pimpri Pune\",\"address\":\"Near PCMC Office, 31/6\",\"distance\":null,\"image\":\"https://i.travelapi.com/lodging/5000"
}
```

### Bug 14 — [Paging.4] Keep fq and sort identical across pages — same totalResults

**How tested:** page 2 used same body + sort as page 1

**Steps**
1. Auth (partner token + user session, `tierId=10546901`). Send `X-Partner-Key` = partner access token.
2. Start from the baseline request above (`POST /v1/hotels/search`).
3. Mutate only: page 2 used same body + sort as page 1
4. Compare HTTP status + listing fields against expected.

**Expected:** totalResults stable (302)

**Actual:** p1=302 p2=302 overlap=10


### Bug 15 — [Paging.5] Stop when last==true

**How tested:** query offset=300 (last page of 61)

**Steps**
1. Auth (partner token + user session, `tierId=10546901`). Send `X-Partner-Key` = partner access token.
2. Start from the baseline request above (`POST /v1/hotels/search`).
3. Mutate only: query offset=300 (last page of 61)
4. Compare HTTP status + listing fields against expected.

**Expected:** last=true; results.length <= limit

**Actual:** HTTP 200 last=false offset=0 n=10 page=0

**Response (slim):**
```json
{
  "http": 200,
  "code": null,
  "elapsedMs": 267,
  "page": 0,
  "offset": 0,
  "size": 10,
  "last": false,
  "totalResults": 302,
  "availableResults": 302,
  "totalPages": 31,
  "requestId": "6eaf4086-88d5-4b87-8d22-1a157de827ea",
  "currency": "INR",
  "resultCount": 10,
  "hotels": [
    {
      "id": "15237042",
      "name": "Keys Prima by Lemon Tree Hotels, Pimpri Pune",
      "starRating": 3,
      "refundable": true,
      "baseFare": 5713.6,
      "totalAmount": 6570.64
    },
    {
      "id": "72379936",
      "name": "Via Royal Stay I",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1333.68,
      "totalAmount": 1402.21
    },
    {
      "id": "72241152",
      "name": "Fabhotel Royal Inn I",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1230.93,
      "totalAmount": 1293.73
    },
    {
      "id": "39604638",
      "name": "Treebo Diamond Residency - DDPK Inn",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1971.62,
      "totalAmount": 2072.47
    },
    {
      "id": "70487786",
      "name": "Fabhotel Prime Athiti Delight Stay",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1370.69,
      "totalAmount": 1439.22
    }
  ],
  "sorts": [
    "price_ASC",
    "price_DESC"
  ],
  "filterNames": [
    "Star Rating|df_long_star_rating|facets=3",
    "Free cancellation|Reservation policy|facets=1"
  ],
  "snippet": "{\"page\":0,\"size\":10,\"offset\":0,\"totalResults\":302,\"totalPages\":31,\"availableResults\":302,\"last\":false,\"results\":[{\"id\":\"15237042\",\"name\":\"Keys Prima by Lemon Tree Hotels, Pimpri Pune\",\"address\":\"Near PCMC Office, 31/6\",\"distance\":null,\"image\":\"https://i.travelapi.com/lodging/5000"
}
```

### Bug 16 — [Paging.6] page is offset/limit rounded down — offset=7 reports page 1

**How tested:** query offset=7&limit=5 — page is display-only

**Steps**
1. Auth (partner token + user session, `tierId=10546901`). Send `X-Partner-Key` = partner access token.
2. Start from the baseline request above (`POST /v1/hotels/search`).
3. Mutate only: query offset=7&limit=5 — page is display-only
4. Compare HTTP status + listing fields against expected.

**Expected:** HTTP 200; page=1; offset=7; do not advance with page*limit

**Actual:** HTTP 200 page=0 offset=0 ids=15237042,72379936,72241152,39604638,70487786,72395060,72419366,71037232,39452499,15599148

**Response (slim):**
```json
{
  "http": 200,
  "code": null,
  "elapsedMs": 265,
  "page": 0,
  "offset": 0,
  "size": 10,
  "last": false,
  "totalResults": 302,
  "availableResults": 302,
  "totalPages": 31,
  "requestId": "ba107a13-55c3-4a19-b163-b80d43d1cb55",
  "currency": "INR",
  "resultCount": 10,
  "hotels": [
    {
      "id": "15237042",
      "name": "Keys Prima by Lemon Tree Hotels, Pimpri Pune",
      "starRating": 3,
      "refundable": true,
      "baseFare": 5713.6,
      "totalAmount": 6570.64
    },
    {
      "id": "72379936",
      "name": "Via Royal Stay I",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1333.68,
      "totalAmount": 1402.21
    },
    {
      "id": "72241152",
      "name": "Fabhotel Royal Inn I",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1230.93,
      "totalAmount": 1293.73
    },
    {
      "id": "39604638",
      "name": "Treebo Diamond Residency - DDPK Inn",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1971.62,
      "totalAmount": 2072.47
    },
    {
      "id": "70487786",
      "name": "Fabhotel Prime Athiti Delight Stay",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1370.69,
      "totalAmount": 1439.22
    }
  ],
  "sorts": [
    "price_ASC",
    "price_DESC"
  ],
  "filterNames": [
    "Star Rating|df_long_star_rating|facets=3",
    "Free cancellation|Reservation policy|facets=1"
  ],
  "snippet": "{\"page\":0,\"size\":10,\"offset\":0,\"totalResults\":302,\"totalPages\":31,\"availableResults\":302,\"last\":false,\"results\":[{\"id\":\"15237042\",\"name\":\"Keys Prima by Lemon Tree Hotels, Pimpri Pune\",\"address\":\"Near PCMC Office, 31/6\",\"distance\":null,\"image\":\"https://i.travelapi.com/lodging/5000"
}
```

### Bug 17 — [Paging.7] Advancing via page*size after offset=7 would re-show hotels

**How tested:** Compare offset=5 (if fetched) vs offset=7 — shared ids prove page field is display-only

**Steps**
1. Auth (partner token + user session, `tierId=10546901`). Send `X-Partner-Key` = partner access token.
2. Start from the baseline request above (`POST /v1/hotels/search`).
3. Mutate only: Compare offset=5 (if fetched) vs offset=7 — shared ids prove page field is display-only
4. Compare HTTP status + listing fields against expected.

**Expected:** offset=7 shares 3 hotels with offset=5 (doc example)

**Actual:** shared=15237042,72379936,72241152,39604638,70487786,72395060,72419366,71037232,39452499,15599148 sharedCount=10 off7.offset=0 p5=15237042,72379936,72241152,39604638,70487786,72395060,72419366,71037232,39452499,15599148 off7=15237042,72379936,72241152,39604638,70487786,72395060,72419366,71037232,39452499,15599148

**Response (slim):**
```json
{
  "p5ids": [
    "15237042",
    "72379936",
    "72241152",
    "39604638",
    "70487786",
    "72395060",
    "72419366",
    "71037232",
    "39452499",
    "15599148"
  ],
  "off7ids": [
    "15237042",
    "72379936",
    "72241152",
    "39604638",
    "70487786",
    "72395060",
    "72419366",
    "71037232",
    "39452499",
    "15599148"
  ],
  "shared": [
    "15237042",
    "72379936",
    "72241152",
    "39604638",
    "70487786",
    "72395060",
    "72419366",
    "71037232",
    "39452499",
    "15599148"
  ],
  "withP5": [
    "15237042",
    "72379936",
    "72241152",
    "39604638",
    "70487786",
    "72395060",
    "72419366",
    "71037232",
    "39452499",
    "15599148"
  ]
}
```

### Bug 18 — [Paging.8] Offset past the end does not 500

**How tested:** clone → offset=9999

**Steps**
1. Auth (partner token + user session, `tierId=10546901`). Send `X-Partner-Key` = partner access token.
2. Start from the baseline request above (`POST /v1/hotels/search`).
3. Mutate only: clone → offset=9999
4. Compare HTTP status + listing fields against expected.

**Expected:** HTTP 200 empty results last=true, or 4xx — not 500

**Actual:** HTTP 200 n=10 last=false offset=0 code=-

**Response (slim):**
```json
{
  "http": 200,
  "code": null,
  "elapsedMs": 261,
  "page": 0,
  "offset": 0,
  "size": 10,
  "last": false,
  "totalResults": 302,
  "availableResults": 302,
  "totalPages": 31,
  "requestId": "33c0a0ef-7a82-4cb3-8583-375555772d07",
  "currency": "INR",
  "resultCount": 10,
  "hotels": [
    {
      "id": "15237042",
      "name": "Keys Prima by Lemon Tree Hotels, Pimpri Pune",
      "starRating": 3,
      "refundable": true,
      "baseFare": 5713.6,
      "totalAmount": 6570.64
    },
    {
      "id": "72379936",
      "name": "Via Royal Stay I",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1333.68,
      "totalAmount": 1402.21
    },
    {
      "id": "72241152",
      "name": "Fabhotel Royal Inn I",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1230.93,
      "totalAmount": 1293.73
    },
    {
      "id": "39604638",
      "name": "Treebo Diamond Residency - DDPK Inn",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1971.62,
      "totalAmount": 2072.47
    },
    {
      "id": "70487786",
      "name": "Fabhotel Prime Athiti Delight Stay",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1370.69,
      "totalAmount": 1439.22
    }
  ],
  "sorts": [
    "price_ASC",
    "price_DESC"
  ],
  "filterNames": [
    "Star Rating|df_long_star_rating|facets=3",
    "Free cancellation|Reservation policy|facets=1"
  ],
  "snippet": "{\"page\":0,\"size\":10,\"offset\":0,\"totalResults\":302,\"totalPages\":31,\"availableResults\":302,\"last\":false,\"results\":[{\"id\":\"15237042\",\"name\":\"Keys Prima by Lemon Tree Hotels, Pimpri Pune\",\"address\":\"Near PCMC Office, 31/6\",\"distance\":null,\"image\":\"https://i.travelapi.com/lodging/5000"
}
```

### Bug 19 — [Paging.9] Negative offset rejected

**How tested:** clone → offset=-1

**Steps**
1. Auth (partner token + user session, `tierId=10546901`). Send `X-Partner-Key` = partner access token.
2. Start from the baseline request above (`POST /v1/hotels/search`).
3. Mutate only: clone → offset=-1
4. Compare HTTP status + listing fields against expected.

**Expected:** HTTP 400 VALIDATION_ERROR (or 4xx) — not 200 listing, not 500

**Actual:** HTTP 200 code=- n=10 snippet={"page":0,"size":10,"offset":0,"totalResults":302,"totalPages":31,"availableResults":302,"last":false,"results":[{"id":"15237042","name":"Keys Prima by Lemon Tr

**Payload mutation:**
```json
{
  "offset": -1
}
```
**Response (slim):**
```json
{
  "http": 200,
  "code": null,
  "elapsedMs": 270,
  "page": 0,
  "offset": 0,
  "size": 10,
  "last": false,
  "totalResults": 302,
  "availableResults": 302,
  "totalPages": 31,
  "requestId": "ea5c2b2f-a0d2-47ac-b656-9e3dc312ab1d",
  "currency": "INR",
  "resultCount": 10,
  "hotels": [
    {
      "id": "15237042",
      "name": "Keys Prima by Lemon Tree Hotels, Pimpri Pune",
      "starRating": 3,
      "refundable": true,
      "baseFare": 5713.6,
      "totalAmount": 6570.64
    },
    {
      "id": "72379936",
      "name": "Via Royal Stay I",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1333.68,
      "totalAmount": 1402.21
    },
    {
      "id": "72241152",
      "name": "Fabhotel Royal Inn I",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1230.93,
      "totalAmount": 1293.73
    },
    {
      "id": "39604638",
      "name": "Treebo Diamond Residency - DDPK Inn",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1971.62,
      "totalAmount": 2072.47
    },
    {
      "id": "70487786",
      "name": "Fabhotel Prime Athiti Delight Stay",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1370.69,
      "totalAmount": 1439.22
    }
  ],
  "sorts": [
    "price_ASC",
    "price_DESC"
  ],
  "filterNames": [
    "Star Rating|df_long_star_rating|facets=3",
    "Free cancellation|Reservation policy|facets=1"
  ],
  "snippet": "{\"page\":0,\"size\":10,\"offset\":0,\"totalResults\":302,\"totalPages\":31,\"availableResults\":302,\"last\":false,\"results\":[{\"id\":\"15237042\",\"name\":\"Keys Prima by Lemon Tree Hotels, Pimpri Pune\",\"address\":\"Near PCMC Office, 31/6\",\"distance\":null,\"image\":\"https://i.travelapi.com/lodging/5000"
}
```

### Bug 20 — [Paging.10] limit=0 rejected or empty page, not 500

**How tested:** clone → limit=0

**Steps**
1. Auth (partner token + user session, `tierId=10546901`). Send `X-Partner-Key` = partner access token.
2. Start from the baseline request above (`POST /v1/hotels/search`).
3. Mutate only: clone → limit=0
4. Compare HTTP status + listing fields against expected.

**Expected:** 4xx VALIDATION_ERROR preferred; HTTP 200 empty is a product call; not 500

**Actual:** HTTP 200 code=- n=10 size=10

**Payload mutation:**
```json
{
  "limit": 0
}
```
**Response (slim):**
```json
{
  "http": 200,
  "code": null,
  "elapsedMs": 287,
  "page": 0,
  "offset": 0,
  "size": 10,
  "last": false,
  "totalResults": 302,
  "availableResults": 302,
  "totalPages": 31,
  "requestId": "5db8ce96-d0cf-411c-8a57-5876b03e62ff",
  "currency": "INR",
  "resultCount": 10,
  "hotels": [
    {
      "id": "15237042",
      "name": "Keys Prima by Lemon Tree Hotels, Pimpri Pune",
      "starRating": 3,
      "refundable": true,
      "baseFare": 5713.6,
      "totalAmount": 6570.64
    },
    {
      "id": "72379936",
      "name": "Via Royal Stay I",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1333.68,
      "totalAmount": 1402.21
    },
    {
      "id": "72241152",
      "name": "Fabhotel Royal Inn I",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1230.93,
      "totalAmount": 1293.73
    },
    {
      "id": "39604638",
      "name": "Treebo Diamond Residency - DDPK Inn",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1971.62,
      "totalAmount": 2072.47
    },
    {
      "id": "70487786",
      "name": "Fabhotel Prime Athiti Delight Stay",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1370.69,
      "totalAmount": 1439.22
    }
  ],
  "sorts": [
    "price_ASC",
    "price_DESC"
  ],
  "filterNames": [
    "Star Rating|df_long_star_rating|facets=3",
    "Free cancellation|Reservation policy|facets=1"
  ],
  "snippet": "{\"page\":0,\"size\":10,\"offset\":0,\"totalResults\":302,\"totalPages\":31,\"availableResults\":302,\"last\":false,\"results\":[{\"id\":\"15237042\",\"name\":\"Keys Prima by Lemon Tree Hotels, Pimpri Pune\",\"address\":\"Near PCMC Office, 31/6\",\"distance\":null,\"image\":\"https://i.travelapi.com/lodging/5000"
}
```

### Bug 21 — [Paging.11] Non-numeric offset rejected

**How tested:** clone → offset=abc

**Steps**
1. Auth (partner token + user session, `tierId=10546901`). Send `X-Partner-Key` = partner access token.
2. Start from the baseline request above (`POST /v1/hotels/search`).
3. Mutate only: clone → offset=abc
4. Compare HTTP status + listing fields against expected.

**Expected:** 4xx VALIDATION_ERROR — not 500

**Actual:** HTTP 200 code=- snippet={"page":0,"size":10,"offset":0,"totalResults":302,"totalPages":31,"availableResults":302,"last":false,"results":[{"id":"15237042","name":"Keys Prima by Lemon Tr

**Payload mutation:**
```json
{
  "offset": "abc"
}
```
**Response (slim):**
```json
{
  "http": 200,
  "code": null,
  "elapsedMs": 335,
  "page": 0,
  "offset": 0,
  "size": 10,
  "last": false,
  "totalResults": 302,
  "availableResults": 302,
  "totalPages": 31,
  "requestId": "f1932db0-2704-4942-a43b-12231e809db1",
  "currency": "INR",
  "resultCount": 10,
  "hotels": [
    {
      "id": "15237042",
      "name": "Keys Prima by Lemon Tree Hotels, Pimpri Pune",
      "starRating": 3,
      "refundable": true,
      "baseFare": 5713.6,
      "totalAmount": 6570.64
    },
    {
      "id": "72379936",
      "name": "Via Royal Stay I",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1333.68,
      "totalAmount": 1402.21
    },
    {
      "id": "72241152",
      "name": "Fabhotel Royal Inn I",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1230.93,
      "totalAmount": 1293.73
    },
    {
      "id": "39604638",
      "name": "Treebo Diamond Residency - DDPK Inn",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1971.62,
      "totalAmount": 2072.47
    },
    {
      "id": "70487786",
      "name": "Fabhotel Prime Athiti Delight Stay",
      "starRating": 3,
      "refundable": true,
      "baseFare": 1370.69,
      "totalAmount": 1439.22
    }
  ],
  "sorts": [
    "price_ASC",
    "price_DESC"
  ],
  "filterNames": [
    "Star Rating|df_long_star_rating|facets=3",
    "Free cancellation|Reservation policy|facets=1"
  ],
  "snippet": "{\"page\":0,\"size\":10,\"offset\":0,\"totalResults\":302,\"totalPages\":31,\"availableResults\":302,\"last\":false,\"results\":[{\"id\":\"15237042\",\"name\":\"Keys Prima by Lemon Tree Hotels, Pimpri Pune\",\"address\":\"Near PCMC Office, 31/6\",\"distance\":null,\"image\":\"https://i.travelapi.com/lodging/5000"
}
```

### Bug 22 — [Paging.14] requestId echoed and reused on follow-up

**How tested:** Baseline requestId sent back on later listing calls

**Steps**
1. Auth (partner token + user session, `tierId=10546901`). Send `X-Partner-Key` = partner access token.
2. Start from the baseline request above (`POST /v1/hotels/search`).
3. Mutate only: Baseline requestId sent back on later listing calls
4. Compare HTTP status + listing fields against expected.

**Expected:** Follow-up responses keep a requestId; baseline requestId was non-empty

**Actual:** baseline=3e5c0463-77c6-46d7-8b65-71b77aec8b84 page2=6cddfb83-fb53-432b-b3d2-9e1e62f0bce3


## Not bugs / not tested

- **PASS** [Shape.2] Valid listing envelope (live /v1/hotels/search) — HTTP 200 results=10 total=302 last=false sorts=2 filters=2 5322ms
- **PASS** [Shape.3] sorts[] exposes price_ASC and price_DESC — sorts=[{"name":"Price Low to High","key":"price_ASC"},{"name":"Price High to Low","key":"price_DESC"}]
- **PASS** [Shape.4] filters[] includes Star Rating with facetKey — star={"name":"Star Rating","indexField":"df_long_star_rating","facets":[{"name":"5 Star","count":10,"facetKey":"5","iconDTO":null},{"name":"4 Star","count":8,"facetKey":"4","iconDTO":null},{"name":"3 Star","count":184,"facetKey":"3","iconDTO":null}]}
- **PASS** [Sort.5] Unknown sort key is ignored — HTTP 200 code=- results=10 299ms
- **PASS** [Sort.6] Star rating is a filter, not a sort — unknown sort ignored — HTTP 200 code=- results=10
- **PASS** [Sort.7] Empty sort query still returns listing — HTTP 200 code=- results=10
- **NOT TESTED** [Filter.2] Facet counts computed before filtering — other options stay visible — facets=[{"name":"5 Star","count":10,"facetKey":"5","iconDTO":null},{"name":"4 Star","count":8,"facetKey":"4","iconDTO":null},{"name":"3 Star","count":184,"facetKey":"3","iconDTO":null}] filtered=false
- **NOT TESTED** [Filter.5] Comma must not be used as multi-value separator — fq ignored on canary
- **NOT TESTED** [Filter.6] Do not send repeated fq entries for the same field — fq ignored on canary
- **PASS** [Filter.7] Unknown indexField does not 500 — HTTP 200 code=- results=10 total=302
- **PASS** [Filter.8] Unknown facetKey does not 500 — HTTP 200 n=10 total=302
- **NOT TESTED** [Paging.12] Dropping sort on page 2 pages a different order — HTTP 200 sortedIds=15237042,72379936,72241152,39604638,70487786,72395060,72419366,71037232,39452499,15599148 unsortedIds=15237042,72379936,72241152,39604638,70487786,72395060,72419366,71037232,39452499,15599148
- **PASS** [Paging.13] Changing entityId while paging starts a different search — HTTP 200 n=0 overlapWithPage2=0 requestId=7caac404-253c-41b4-8057-309828d0295f

## Suggested backend checks

1. Route `POST /api/hotels/v2/availability/listing` on canary (or confirm v1 search is the listing v2 API and update the spec path).
2. Map query `sort` to `sorts[].key` (`price_ASC` / `price_DESC`) and order by `price.baseFare` **before** paging.
3. Map query `offset` + `limit` (do not use `page * size`). Echo `offset` / `size` / `last` / `page=floor(offset/limit)` from the request.
4. Parse body `fq` as `string[]` of `indexField:value` (semicolon-separated multi-values). Reduce `totalResults` to the filtered set; keep pre-filter facet counts.
5. Reject `offset<0`, non-numeric offset, `limit<=0` with HTTP 400 + `VALIDATION_ERROR`.
6. Echo client `requestId` on follow-up listing calls so paging/filter stay on the same search.

