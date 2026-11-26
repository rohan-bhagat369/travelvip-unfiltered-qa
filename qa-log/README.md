# QA Log — daily testing record + dashboard

One place that answers: **what was tested each day, from which dev changelog, by which agent, what failed, and which bugs are still pending.**

```
qa-log/
  days/YYYY-MM-DD.json   one file per testing day (tasks tested + result + bug ids + evidence)
  bugs.json              bug register (id, severity, status, history, link to the report file)
  dashboard/index.html   generated, self-contained — open in a browser or share
  scripts/               log.js (CLI) · build-dashboard.js · dashboard.template.html
```

## Daily flow

1. Dev sends a changelog → you give it to the Cursor/Claude agent.
2. Agent tests it, writes the usual report under the domain `reports/`.
3. **Agent logs it** (rule in `AGENTS.md` + `.cursor/rules/qa-logging.mdc`):

```powershell
# a bug found
npm run qa:log -- bug --id HTL-12 --title "Search returns 0 for Goa" --product Hotel --severity High --task ENG-901 --report travel-apis/hotel/reports/xyz.md

# the task tested (one entry per task / per product)
npm run qa:log -- entry --task ENG-901 --title "Hotel search filters" --product Hotel --result Fail --source "Dev changelog" --bugs HTL-12 --evidence travel-apis/hotel/reports/xyz.md

# later: dev fixed it / you retested it
npm run qa:log -- bug-status HTL-12 retest
npm run qa:log -- bug-status HTL-12 closed
```

Every command rebuilds `qa-log/dashboard/index.html`. To rebuild only: `npm run qa:dashboard`.

- `--result`: Pass · Fail · Partial · Blocked
- `--severity`: Critical · High · Medium · Low
- bug status: open → fixed → retest → closed (or wontfix)
- `--date YYYY-MM-DD` backfills a past day. Bug ids must exist before an entry references them.

## Dashboard

Daily timeline (filter by date range, product/agent, result, bug status, search) · Bugs table (pending first, by severity, with age and status history) · Summary (per-day chart, per-product table). Click a bug chip on a task to jump to the bug. Print-friendly for manager reports.

## Notes

- Seeded on 2026-11-25 from existing reports and git history. **Review the seeded rows**: every seeded bug is marked `open` and dates for the Byufuel days are approximate. Fix them by editing the JSON or with `bug-status`.
- Commit `qa-log/` so history is kept. The dashboard file is regenerated, so merge conflicts there can be resolved by re-running `npm run qa:dashboard`.
