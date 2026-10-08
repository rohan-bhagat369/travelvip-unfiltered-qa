# Riya Progressive Search QA — preprod (search only)

- **12 PASS / 0 BUG / 4 NOT TESTED**
- Correlation: `2633194a-1819-4ad1-b49a-f57fae352c6a`
- No bookings (A4 / B2-book skipped)

| Id | Rule | Status |
|----|------|--------|
| A1 | Results appear early (~8–14s), then more | **PASS** |
| A2 | Paging through several pages to end | **PASS** |
| A3 | Detail from first-page hotel matches card | **PASS** |
| A4 | Book end to end from early result | **NOT TESTED** |
| B1 | Narrow filter must not falsely end search | **PASS** |
| B2 | Hotels from first page still listed after reload (book skipped) | **PASS** |
| B3 | No availability says so honestly | **PASS** |
| B4 | Same search in parallel — both get full results | **PASS** |
| B4b | 3 parallel identical Mumbai searches | **PASS** |
| C1 | TBO / RateHawk search unaffected | **NOT TESTED** |
| C2 | Riya with progressive flag off | **NOT TESTED** |
| D1 | Small city timing (known may be slower) | **PASS** |
| D2 | Branded hotels on first page (known may be thin) | **PASS** |
| D3 | Result order may change as more arrive (known) | **PASS** |
| P1 | Parallel different-city searches all succeed | **PASS** |
| P2 | Preprod vs prod compare | **NOT TESTED** |