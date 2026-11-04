# ANS V2 — Email evidence standard (dispute proof)

**Why:** If someone later says “this email is not working”, QA must show **the actual mail** that worked for that booking + action + channel — not only a sheet Yes or a notif shade crop.

## What counts as proof

| Evidence | Counts for |
|----------|------------|
| `notif-evidence/{bookingId}/email/user-{action}.png` | User mail received + content |
| `…/email/admin-{action}.png` | Admin BCC (same body) received |
| `…/email/cs-{action}.png` | CS / CSV2 stage mail received |
| `…/email/INDEX.md` | Subject, To, time, PASS/EXPECT note |
| `EMAIL-EVIDENCE-MANIFEST.md` | Sheet-wide inventory CAPTURED / MISSING |

**Does not count alone:** Android `notif-shade*.png`, dumpsys text, sheet “Yes” without a body PNG.

## Folder layout

```text
notif-evidence/{BOOKING_ID}/
  RESULT.md                 # verdict notes
  notif-shade*.png          # optional push proof
  email/
    user-confirmed.png
    admin-confirmed.png
    cs-confirmed.png        # or cs-ticketed.png for flights
    INDEX.md
```

Action tokens: `request-submitted` · `confirmed` · `cancellation-requested` · `cancelled` · `ticketed` (CS only).

## Sheets driving capture

| Partner | Sheet file | Date |
|---------|------------|------|
| BFL | `sheet-partner-bfl-email-testing.csv` | 28 Oct · Google tab **Partner BFL email testing** |
| SMT | `sheet-partner-smt-email-testing.csv` | 29–30 Oct · Google tab **Partner SMT email testing** |
| TravelVerse (`tvs`) | `sheet-partner-tvs-email-testing.csv` | 3–4 Nov · host `lambda-tvs.travelvip.ai` · Google tab **Partner TravelVerse email testing** |
| Thomas Cook | `sheet-partner-thomas-cook-email-testing.csv` | 3–4 Nov · host `lambda-shop.travelvip.ai` · Google tab **Partner Thomas Cook testing** |
| Entertainer | `sheet-partner-entertainer-email-testing.csv` | 4 Nov · host `lambda-ent.travelvip.ai` · Google tab **Partner Entertainer email testing** · email-only |
| JSP | `sheet-partner-jsp-email-testing.csv` | 4 Nov · host `lambda-shop.travelvip.ai` · Google tab **JSP Email Testing** · **same booking refs / results as SMT** |

**Google Sheet:** [ANS V2 Email Testing](https://docs.google.com/spreadsheets/d/1kU96tGaT8zPUS24PjsUWOO37E2SLpB4cBVjdVupq3XY/edit) — one tab per partner (same columns as CSVs). Local multi-tab: `ANS-V2-partner-email-testing.xlsx`.

Skip: Not Done / N/A / channel No when **EXPECT** (document EXPECT_ABSENT in INDEX).

## Capture checklist (every Done Yes)

1. Search Gmail by booking id.
2. Open exact action mail (User vs CSV2 CS).
3. Subject bar + full body visible in PNG.
4. One file per channel × action.
5. Manifest row updated.
