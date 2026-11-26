# Rohan’s standup summaries

Daily standup notes for managers / sync. Update **every testing day** before or after standup.

## How to use

1. Copy `TEMPLATE.md` → `days/YYYY-MM-DD.md` (today’s date).
2. Fill **Done / In progress / Next** from Tracker + what you tested.
3. Keep language plain — managers should understand without API jargon.
4. Optional: paste the same table into Mattermost / Tracker Activity.

## Layout

```
standup/
  README.md          ← this file
  TEMPLATE.md        ← blank day
  latest.md          ← always = most recent day (overwrite daily)
  days/
    YYYY-MM-DD.md    ← history
```

## Related

Concrete “what I did on which task” lives in [`daily-work/LOG.md`](../daily-work/LOG.md) (one file, date-wise sections) — update both on testing days.

## Agent tip

When the user says “standup”, “log today”, or “update standup”:

1. Read `standup/latest.md` + today’s Tracker work.
2. Write/overwrite `standup/days/YYYY-MM-DD.md` and `standup/latest.md`.
3. Keep status labels consistent: **Done on Dev** · **Bug fix in progress** · **Ready for retest** · **Blocked**.
4. Also append today’s row in `daily-work/LOG.md` (task id or short summary).
