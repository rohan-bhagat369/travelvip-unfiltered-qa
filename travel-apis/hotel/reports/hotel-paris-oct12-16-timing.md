# Paris timing — Oct 12 / 14 / 16 (2026)

City: Paris `437227:FR` · no filters · `sort=price_DESC`  
Preprod: `https://preprod-api.travelvip.ai` · Prod: `https://api.travelvip.ai`

## 1) First pass (preprod cold, then prod)

| Dates | Preprod | Prod |
|-------|---------|------|
| 12→13 Oct | **10105ms** · cache=false · total=37 · EARLY | **1224ms** · cache=true · total=37 |
| 14→15 Oct | **11246ms** · cache=false · total=37 · EARLY | **1329ms** · cache=true · total=37 |
| 16→17 Oct | **12230ms** · cache=false · total=37 · EARLY | **800ms** · cache=true · total=37 |

## 2) Second pass (both already warm — full city)

| Dates | Preprod | Prod |
|-------|---------|------|
| 12→13 Oct | **1067ms** · cache=true · total=**2342** | **1168ms** · cache=true · total=**2342** |
| 14→15 Oct | **1127ms** · cache=true · total=**2259** | **1302ms** · cache=true · total=**2259** |
| 16→17 Oct | **964ms** · cache=true · total=**2269** | **1178ms** · cache=true · total=**2269** |

## Notes

- Cold first page on **preprod** for these dates: **~10–12s**, early batch (~37 hotels).
- On the same dates, **prod** was already `fromCache: true` (~1s) when we called it after preprod — later both showed the **same full totals** (~2300).
- So we could **not** get a fair cold prod timing on these exact dates in this run (already warm). Preprod cold times above are the usable cold numbers.
