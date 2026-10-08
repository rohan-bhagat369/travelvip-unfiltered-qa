# Hotel search parallel stress — 50 concurrent

- City: **Paris** (`437227:FR`)
- Concurrent searches: **50**
- Unique dates per request: **YES**
- At: 2026-09-08T10:18:26.574Z

## preprod

- Base: `https://preprod-api.travelvip.ai`
- Dates: 50 unique date pairs (2027-02-05 … 2027-05-14)
- Wall clock: **85.64s**
- Success: **50/50** (100%) · Empty pages: **37** · Broke: **NO**
- Throughput: **0.584 req/s**
- Latency (ok only): min **15558** · p50 **83431** · p90 **85585** · p95 **85611** · p99 **85628** · max **85628** · avg **73119** ms
- totalResults: 36…2052 (spread 98.2%) · shapes: `{"EARLY":11,"EMPTY":37,"FULL":2}`
- fromCache true/false: 1/12
