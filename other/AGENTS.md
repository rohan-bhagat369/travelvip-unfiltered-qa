# Other services — agent memory

**Synced:** **2026-10-08**

| Area | Path | What agents left here |
|------|------|------------------------|
| eSIM | [esim/](esim/) | E2E + duplicate-payload probes |
| Entertainer | [entertainer/](entertainer/) | Airport/rail retest probes |
| Zenith | [zenith/](zenith/) | OTEL / ENG-22 hotel+flight probes (incl. rejected book-shaped PII cases) |
| Tracker tooling | [tracker/](tracker/) | Tracker surface/bundle probes; Jira gap analysis reports |
| Wallet | [wallet/](wallet/) | Dashboard E2E CSV + API guide PDF; Postman in `postman/` |
| Booking URLs | [booking-urls/](booking-urls/) | Confirmation URL spreadsheet |
| Scratch | [_scratch/](_scratch/) | `_tmp-*` one-offs, OCR `eng.traineddata`, migration logs |

## Sibling / other-agent pointers
- **UI Playwright framework rules** (not copied here): `D:\tx ui automation\.cursor\rules\` and `D:\tx-ui-automation\.cursor\rules\` — layout non-negotiables for UI repo
- **B2B-only hotel+flight pack** (source of ALLOW_BOOK / release-gate memory): `D:\Travel VIP B2B API Automation\AGENTS.md` — merged into `travel-apis/hotel|flight/AGENTS.md` on 2026-10-08
