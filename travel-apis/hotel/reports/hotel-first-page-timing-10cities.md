# First-page search — 10 cities (preprod vs prod, cold)

- Preprod: `https://preprod-api.travelvip.ai`
- Prod: `https://api.travelvip.ai`
- Dates: **same on both envs, parallel cold**
- Avg: **preprod 14053ms** · **prod 14536ms**
- Shape EARLY: preprod **7/10** · prod **7/10** · FULL: pre **2** / prod **2**
- Both `fromCache:false`: **8/10**

| # | City | Size | Dates | Preprod | Prod | Faster |
|---|------|------|-------|---------|------|--------|
| 1 | Delhi | large | 2027-04-16 | **10.5s** · t=34 · cache=false · 5★=29 · EARLY | **10.6s** · t=34 · cache=true · 5★=29 · EARLY | preprod |
| 2 | Mumbai | large | 2027-04-20 | **16.5s** · t=29 · cache=false · 5★=21 · EARLY | **16.5s** · t=29 · cache=false · 5★=21 · EARLY | prod |
| 3 | Dubai | large | 2027-04-24 | **17.2s** · t=19 · cache=false · 5★=12 · EARLY | **17.1s** · t=19 · cache=false · 5★=12 · EARLY | prod |
| 4 | Bangkok | large | 2027-04-28 | **14.7s** · t=20 · cache=false · 5★=20 · EARLY | **14.8s** · t=20 · cache=false · 5★=20 · EARLY | preprod |
| 5 | Paris | large | 2027-05-02 | **12.0s** · t=36 · cache=false · 5★=25 · EARLY | **12.0s** · t=36 · cache=false · 5★=25 · EARLY | prod |
| 6 | Jaipur | mid | 2027-05-06 | **20.0s** · t=17 · cache=false · 5★=9 · EARLY | **19.8s** · t=17 · cache=false · 5★=9 · EARLY | prod |
| 7 | Kochi | mid | 2027-05-10 | **18.3s** · t=14 · cache=false · 5★=5 · EARLY | **23.5s** · t=14 · cache=false · 5★=5 · EARLY | preprod |
| 8 | Pune | mid | 2027-05-14 | **7.8s** · t=0 · cache=true · 5★=- · EMPTY | **7.8s** · t=0 · cache=false · 5★=- · EMPTY | prod |
| 9 | Manali | small | 2027-05-18 | **11.8s** · t=276 · cache=false · 5★=10 · FULL | **11.8s** · t=276 · cache=false · 5★=10 · FULL | prod |
| 10 | Rishikesh | small | 2027-05-22 | **11.6s** · t=270 · cache=false · 5★=3 · FULL | **11.6s** · t=270 · cache=false · 5★=3 · FULL | prod |

Legend: **EARLY** = totalResults &lt; 80 (progressive first batch) · **FULL** = total ≥ 200 · cache = `fromCache` · 5★ = star facet count.