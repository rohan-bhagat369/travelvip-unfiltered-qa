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
| BFL | `sheet-partner-bfl-email-testing.csv` | 28 Oct |
| SMT | `sheet-partner-smt-email-testing.csv` | 29–30 Oct |

Skip: Not Done / N/A / channel No when **EXPECT** (document EXPECT_ABSENT in INDEX).

## Capture checklist (every Done Yes)

1. Search Gmail by booking id.
2. Open exact action mail (User vs CSV2 CS).
3. Subject bar + full body visible in PNG.
4. One file per channel × action.
5. Manifest row updated.
