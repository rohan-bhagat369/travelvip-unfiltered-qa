# Riya Progressive Search — Preprod vs Prod

Both envs show early→full growth

| City | Preprod first | Preprod total path | Prod first | Prod total path |
|------|---------------|--------------------|------------|-----------------|
| Delhi | 10328ms / t=35 | → max 1483 (grew=true) | 10774ms / t=35 | → max 1470 (grew=true) |
| Mumbai | 15028ms / t=33 | → max 869 (grew=true) | 10111ms / t=33 | → max 916 (grew=true) |
| Dubai | 10449ms / t=38 | → max 1352 (grew=true) | 10933ms / t=38 | → max 1306 (grew=true) |

## Parallel x3 Mumbai
- **preprod**: 7356ms/t=12 · 7350ms/t=12 · 7305ms/t=12 · shortVsFull=false
- **prod**: 12624ms/t=29 · 12601ms/t=29 · 12602ms/t=29 · shortVsFull=false