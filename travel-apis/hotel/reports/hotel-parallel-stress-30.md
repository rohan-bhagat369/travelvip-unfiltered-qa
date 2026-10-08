# Hotel search parallel stress — 30 concurrent

- City: **Paris** (`437227:FR`)
- Concurrent identical searches: **30**
- At: 2026-09-08T10:14:53.039Z

## preprod

- Base: `https://preprod-api.travelvip.ai`
- Dates: 2026-12-29 → 2026-12-30
- Wall clock: **25.32s**
- Success: **30/30** (100%) · Broke: **NO**
- Throughput: **1.185 req/s**
- Latency (ok only): min **24902** · p50 **25101** · p90 **25197** · p95 **25289** · p99 **25312** · max **25312** · avg **25100** ms
- totalResults: 37…37 (spread 0%) · shapes: `{"EARLY":30}`
- fromCache true/false: 29/1
