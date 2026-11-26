# Rohan’s daily work updates

**One markdown file for all days:** [`LOG.md`](LOG.md).  
Add a new `## YYYY-MM-DD` section at the **top** (newest first). Do not create a separate file per day.

Manager-facing status stays in `standup/`.

## Rules (mandatory)

1. **Same file, date-wise sections** — edit only `daily-work/LOG.md`.
2. **New day** → insert a new `## YYYY-MM-DD` block at the top (below the intro). Never delete older dates.
3. **During / end of day** — any agent that worked appends a table row under today’s date:
   - Prefer **Tracker task id** (`ENG-…` / `QA-…`) + short “what we did”.
   - If **no task id** → still add a row with a **short summary**.
4. **Real results only** — Pass / Fail / Partial / Blocked / In progress / Done / N/A.

## Layout

```
daily-work/
  README.md   ← this file
  LOG.md      ← all days, newest section first
```

## Section shape (per day)

```md
## YYYY-MM-DD

**Summary:** …

| Task | Product | What I did | Result | Evidence / notes |
|------|---------|------------|--------|------------------|
| ENG-826 | Inventory | … | Pass | report path |

**Other:** …
**Carry:** …
```

## vs standup/

| Folder | Audience | Content |
|--------|----------|---------|
| `standup/` | Managers / sync | Plain-language status (can stay per-day files) |
| `daily-work/LOG.md` | Rohan / any agent | Date-wise task id (or short summary) + what was done |

## Agent tip

Triggers: “daily work”, “log my day”, “work update”, “end of day”, or after finishing a testing task:

1. Open `daily-work/LOG.md`.
2. If today’s `## YYYY-MM-DD` is missing → add it at the top.
3. Append a row: **task id** if known, else **short summary**.
4. Still run `npm run qa:log` for formal Pass/Fail/bugs when you tested a Tracker task.
