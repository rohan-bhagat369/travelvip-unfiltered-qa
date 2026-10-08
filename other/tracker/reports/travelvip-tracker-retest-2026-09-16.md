# TravelVIP Tracker — live retest vs Jira gap analysis

**Product:** https://tracker.travelvip.ai  
**Date:** 2026-09-16  
**Tester:** Rohan (`rohan@travelvip.ai`) via Playwright  
**Baseline:** [travelvip-tracker-jira-gap-analysis.md](travelvip-tracker-jira-gap-analysis.md) (written 2026-09-10; Product ask + QA extras)  
**Workspace snapshot:** 31 issues (ENG 16 + QA 15). Projects: Tracker, Travel VIP, Flight, Hotel, Lounge.

---

## Verdict

**Not Jira-compatible.** Devs shipped a useful slice after the 10 Sep analysis (notifications, day-based time log, Timeline timesheet, attachments, markdown, QA team). The Product P0 model is still missing:

`Project → Epic → Story → Dev/QA sub-tasks` · Bugs as a type linked to Stories · Sprints with burndown · Reporter / Watchers · **email** on @mention.

**Do not position Tracker as a Jira replacement until the P0 blockers in §3 are done.**

| Score | Count |
|---|---|
| PASS (shell / new surfaces that work) | 18 |
| PARTIAL (started, not Jira-shaped) | 4 |
| FAIL / missing Product P0 | 12 |
| BUG (broken, not just missing) | 1 |
| NOT TESTED (needs 2nd user / SMTP / admin CRUD) | 3 |

---

## 1. Analysis of latest changes (10 Sep → 16 Sep)

What Product/QA asked for vs what actually landed.

| Asked (P0) | 10 Sep | 16 Sep | Analysis |
|---|---|---|---|
| Issue types Epic / Story / Bug / Sub-task | Missing (one Task type) | **Still missing.** Create is still **New task**. Team badge only switches ENG vs QA. | Team ≠ issue type. QA work is a **second Linear-style team** (`QA-n` keys), not QA sub-tasks under a Story. |
| Project → Epic → Story tree | Flat tasks + generic subtasks | Same. Subtasks still generic “Add subtask…”. | ENG-14 has 3 nested subtasks (ENG-30/32/23) with progress `1/3`. Tree exists, types do not. |
| Bug type + link to Story | Label “Bug” only | Still a **label**. Filter `Label: Bug` returns **ENG-30** (a subtask: “Rotate leaked Postgres production password”). | Labelling a subtask “Bug” is not a defect workflow. No severity, repro template, or required Story link. |
| Reporter + Watchers | Missing | **Still missing.** Fields: Assignees (multi), CC, Follow. | Follow/CC is the watcher seed; it was not renamed and does not prove email. Avatar is display-only (no profile / sign-out / settings menu). |
| Fix key search `q=ENG-12` | BUG | **Still BUG**, worse evidence: `q=ENG-17` (issue **exists** on the list) → “No tasks match these filters”. Title `Seat Unavailable` finds ENG-17. `/tasks/ENG-12` is now **404** (issue deleted). Cmd+K `ENG-12` also no hit. | Search is title-only. Keys are unusable in the search box. Direct URL `/tasks/ENG-17` works. |
| Sprint create / start / complete + backlog rank | Sprint = filter chip (“Sept Sprint 1”) | **Regressed.** Sprint filter = **No matches**. Issue sprint picker = **No sprint** only. Sidebar **SPRINTS** section is gone. `/sprints` `/backlog` **404**. | Old sprint data/UI was removed without shipping lifecycle. You cannot plan a sprint today. |
| Sprint-scoped board | Global status board | Same, plus **Triage** column. Board requires a single team (“Board view needs a single team”). | Not “active sprint board”. No WIP, no swimlanes, no sprint goal. |
| Story points + burndown | Missing | **Still missing.** No points field. `/reports` `/dashboard` **404**. JS bundles contain no `storyPoints` / `burndown` / `epic`. | Time Log is **days / % of a day**, not points. Cannot burn a sprint. |
| Worklog per person | Missing | **PARTIAL.** Issue **Time Log**: date + 25/50/75/100% + day spinner. **Timeline** = person × week grid (Me / ENG / QA / + Person). Weekend = non-working. | This is a timesheet, not Jira worklog (hours + date + note + remaining estimate + CSV). Rohan has 0 assigned tasks so Timeline “Log day” shows **No matching tasks**. |
| Email on comment / @mention / assignee | Missing | **PARTIAL UI only.** Bell + Inbox (empty) + Settings: pause, browser push, **in-app** checkboxes (task created/updated/deleted, status, priority, assigned, unassigned, new comment, mentioned me, follower add/remove, due soon, overdue). **No email toggle.** `/notifications` still **404**. | Mentions **do** resolve users in the comment box (`@` → Akshay, Amaan, Mayur, …). Inbox is empty so we did **not** prove delivery. Email is still unproven. |
| Activity changelog | Comments only | Still comments only (Write / Preview / Attach). | Status/assignee edits will not show in history. |
| Admin (teams/projects/sprints/settings) | All 404 | Same 404s: `/settings` `/teams` `/projects` `/sprints` `/backlog` `/reports` `/dashboard` `/epics` `/boards` `/admin` `/notifications`. | Sidebar data is hardcoded/seeded. No CRUD to create Project/Epic/Sprint. |
| Attachments | Missing | **Shipped.** Issue dropzone + Choose files; comments: paste/drop + Attach files. | P1 item landed early. Good. |
| Markdown description | Missing | **Shipped** (ENG-21 Done: “Lets add support for Markdown in Decription”). | P1 item landed. Create/detail still say “Add description…” on empty issues. |
| Filters | Status, Assignee, Sprint, Priority, Project, Label | Same set. **No** Issue Type / Epic / Reporter / Watcher. Group by still Status / Assignee / Priority / Project. | Cannot do DoD #10: `project + open sprint + type = Bug`. |
| Cmd+K | Views + projects | Added **QA** + **Tracker**. Still no Reports / Sprints / Epics / Settings. | Shell improved; destinations for P0 modules don’t exist. |

### Also new (not in the original P0 list, but live)

| Surface | What it is | Notes |
|---|---|---|
| QA team | Second team, keys `QA-3` … `QA-17` | Useful org split. **Does not** replace QA sub-tasks under a Story. |
| ENG Triage | Sidebar + status + create checkbox “Send to ENG triage instead of a board” | Intake queue. Fine as extra; not a substitute for Bug type. |
| Draft task | ENG-20 is a **ticket asking** for draft-on-unexpected-close | Feature itself **not shipped**. |
| Delete task | More actions → Delete task only | No clone / move / convert / archive. |
| Send feedback | Floating button | Product feedback, not an issue type. |

---

## 2. End-to-end live checklist (16 Sep)

Walked: login → list → search → board → timeline → create modal → issue detail (ENG-14, ENG-17, ENG-21) → notifications → filters → Cmd+K → following / my tasks → labels → @mention → status workflow → routes.

| # | Area | How tested | Status |
|---|---|---|---|
| 1 | Google login | Continue with Google → `rohan@travelvip.ai` | **PASS** |
| 2 | List + counts | All Tasks **31**; ENG 16; QA 15 | **PASS** |
| 3 | Board | `/tasks?view=board` needs one team; ENG board columns Triage → Canceled | **PASS** (kanban shell) |
| 4 | Realtime | “Synced” | **PASS** |
| 5 | My Tasks | `?mine=true` → empty (Rohan has 0 assignees) | **PASS** (empty is correct) |
| 6 | Following | `?following=true` → empty | **PASS** (empty) |
| 7 | Title search | `q=Seat Unavailable` → ENG-17 | **PASS** |
| 8 | Key search | `q=ENG-17` → no results; `/tasks/ENG-17` opens | **BUG** |
| 9 | Direct key URL | `/tasks/ENG-12` → HTTP **404** | **NOTE** (issue gone) |
| 10 | Nested subtasks | ENG-14 list chip `1/3`; detail lists ENG-30, ENG-32, ENG-23 | **PASS** |
| 11 | Create form | New task: title, description, Status, Priority, Assignees, CC, Project, Sprint, Labels, dates, triage checkbox. Team = ENG \| QA. **No issue type / epic / points / reporter.** | **FAIL** vs P0 |
| 12 | Issue detail fields | Status, Priority, Assignees, CC, Follow, Project, Sprint, Labels, Schedule. **No Reporter, Watchers, points, estimate, resolution, severity, environment, components, versions.** | **FAIL** vs P0 |
| 13 | Status workflow | Triage, Backlog, Todo, In Progress, In Review, Done, Canceled. No Resolution on Done. | **PASS** (task workflow) |
| 14 | Time Log | + Log a day → date + 25/50/75/100% + spinner. Did **not** save. | **PARTIAL** |
| 15 | Timeline | `/tasks/timeline` week grid, holidays, + Person, team chips. Log day → search tasks. | **PARTIAL** |
| 16 | Attachments | Dropzone + Choose files on ENG-14 / ENG-17 | **PASS** (UI present) |
| 17 | Markdown | ENG-21 description renders as paragraphs | **PASS** |
| 18 | @mention picker | Typed `@` on ENG-17 → user list (Akshay, Amaan, Mayur, …). **Did not post.** | **PARTIAL** (picker works; email unproven) |
| 19 | Notifications | Bell → Inbox empty; Settings in-app events; no email | **PARTIAL** |
| 20 | Dependencies | Blocked by / Blocking buttons | **PASS** (lite links) |
| 21 | Subtask create | Add subtask… same fields as task; “Inherits Engineering from ENG-14”; no Dev/QA type | **FAIL** vs P0 |
| 22 | Sprint filter / picker | Filter **No matches**; picker **No sprint** only | **FAIL** |
| 23 | Label Bug | Filter → ENG-30 tagged Bug | **PASS** as label; **FAIL** as issue type |
| 24 | Cmd+K | Jump to All Tasks, Board, My Tasks, Following, ENG, QA, projects | **PASS** |
| 25 | Admin / reports routes | fetch `/settings` `/teams` `/projects` `/sprints` `/backlog` `/reports` `/dashboard` `/epics` `/boards` `/admin` `/notifications` | **FAIL** (all 404) |
| 26 | Account menu | Avatar `RO` is not a menu (no settings / sign-out) | **FAIL** (hygiene) |
| 27 | More actions | Delete task only | **FAIL** vs clone/move |
| 28 | Project mandatory | Create Project button optional | **FAIL** vs P0 rule |
| 29 | Email send | No SMTP prefs; inbox empty; did not @ a teammate live | **NOT TESTED** |
| 30 | Create Project / Epic / Sprint in UI | No screens | **NOT TESTED** / **FAIL** |
| 31 | Burndown / velocity | No reports UI | **FAIL** |

---

## 3. P0 blockers (must ship next)

These are the Product “Jira duplicate” blockers. Until they are done, Tracker stays a **task/kanban + timesheet POC**.

| ID | Blocker | Why it blocks daily standup | Suggested build |
|---|---|---|---|
| **P0-1** | **Issue types** | Cannot create Epic / Story / Bug / Sub-task. Everything is a Task. Bug is a label. QA team ≠ QA sub-task. | Add `issueType`: `epic \| story \| task \| bug \| subtask` with Dev/QA subtype. Create menu: Create Epic / Story / Bug. Icons + filters + group-by type. |
| **P0-2** | **Hierarchy UI** | No Epic panel, no “Create Story under Epic”, no breadcrumb `Project › Epic › Story`. | Enforce parent: Story → Epic, Sub-task → Story. Children panel always visible. Epic progress = stories done / points. |
| **P0-3** | **Key search** | `q=ENG-17` fails while the issue is on the same page. | Match `KEY-n` in search + Cmd+K; case-insensitive; exact key first. |
| **P0-4** | **Sprint lifecycle** | No sprints to assign. Filter empty. Sidebar sprints removed. | Sprint entity: future / active / closed. Create / start / complete. Ranked backlog. Board = **active sprint** (not all statuses forever). |
| **P0-5** | **Story points + burndown** | Cannot plan or chart a sprint. Time Log is days, not points. | Points on Story (Fibonacci). Burndown from remaining points. Optional hours later. |
| **P0-6** | **Bug as type + link to Story** | ENG-30 labelled Bug is a password-rotation **subtask**, not a defect. | Bug create template (repro / expected / actual / severity). Link type `caused by` / `relates` to Story. |
| **P0-7** | **Reporter + Watchers** | No raiser; Follow/CC is not Watchers. | Reporter default = creator, editable. Rename Follow → Watch. Primary assignee + optional multi. |
| **P0-8** | **Email notifications** | In-app inbox is empty and has **no email channel**. | Email on: comment, @mention, assignee change (minimum). Then status/due. Prefs: email on/off per event. Prove with a real send. |
| **P0-9** | **Changelog** | Activity is comments only. | Field history: who changed status/assignee/sprint/points, when. |
| **P0-10** | **Project mandatory + admin CRUD** | Cannot create Project / Team / Sprint in product. Routes 404. | Project required on create. Minimal admin: Projects, Teams, Sprints. |

**DoD mapping (Product’s 10 “Jira duplicate” tests)**

| # | Need | 16 Sep |
|---|---|---|
| 1 | Create Project TravelVIP | **FAIL** (data exists; no create UI) |
| 2 | Create Epic under it | **FAIL** |
| 3 | Stories with AC + points under Epic | **FAIL** |
| 4 | Add Dev + QA sub-tasks; assign | **FAIL** |
| 5 | Move Stories into Sprint N; board = that sprint | **FAIL** |
| 6 | Log work; worklog per person | **PARTIAL** |
| 7 | File Bug, link Story; assignee/reporter/watchers | **FAIL** |
| 8 | Comment `@teammate` → **email** | **NOT TESTED** (picker yes, email no) |
| 9 | Burndown; complete sprint with report | **FAIL** |
| 10 | Filter project + open sprint + type = Bug | **FAIL** |

---

## 4. What still needs to be added

### 4.1 P0 build list (this quarter)

1. Issue type picker on create + convert existing tasks.  
2. Epic / Story hierarchy + “Create Story from Epic” + “Create Dev task” / “Create QA task”.  
3. Fix key search and Cmd+K jump-to-key.  
4. Restore sprints with lifecycle UI (do not leave filter as “No matches”).  
5. Ranked backlog + sprint board.  
6. Story points + basic burndown.  
7. Bug type + required/optional linked Story.  
8. Reporter + Watchers.  
9. Email (mention / assignee / comment) + prove it in staging.  
10. Changelog on the issue.  
11. Project required; thin admin for projects/teams/sprints.

### 4.2 P1 (after P0 — already partly started)

| Item | Status now | Still need |
|---|---|---|
| Worklog | Day % | Hours + note + remaining estimate + CSV + per-person report |
| Attachments | UI shipped | Preview, size limits, virus scan as needed |
| Markdown / comments | Shipped | Edit/delete own comments; image paste already hinted |
| Notifications | In-app prefs | Email + `/notifications` route + non-empty proof |
| Saved filters | Missing | Save current pills; share with team |
| Components / severity / environment | Missing | On Bug (and Story components) |
| Resolution | Missing | On Done / Canceled |
| Clone issue | Missing | With/without subtasks |
| Bulk add to sprint | Missing | Planning day |
| AC checklist | Missing | On Story |
| Board quick filters | Missing | Only my issues / Bugs / Flagged |
| WIP limits | Missing | Kanban discipline |

### 4.3 P2 (Jira Software parity — do not start until P0 is green)

Roadmap/timeline **as epics** (today’s Timeline is a **timesheet**, not a roadmap), dashboards, Fix/Affects Versions, JQL, automation, permission/workflow schemes, CFD/velocity/burnup, GitHub PR panel, CSV import/export, keyboard shortcuts, mobile issue view.

Do **not** treat the new Timeline as the P2 “roadmap” — it is capacity logging.

---

## 5. Open bugs / debt

| ID | Severity | Issue | Expected vs actual |
|---|---|---|---|
| **T-SEARCH-KEY** | **P0 / High** | Search by issue key | Expected: `q=ENG-17` returns ENG-17. Actual: empty. Title search works. |
| **T-NO-ISSUETYPE** | High (gap) | Cannot create Epic/Story/Bug as types | Expected: type picker. Actual: New task + labels. |
| **T-NO-SPRINT** | High (gap + regression) | No sprints to select | Expected: Sept Sprint 1 (or new sprint). Actual: No matches / No sprint. |
| **T-ADMIN-404** | High (gap) | Admin and reports URLs | Expected: pages. Actual: 404. |
| **T-NO-EMAIL** | High (gap) | @mention email | Expected: email. Actual: in-app prefs only; inbox empty. |
| **T-NO-REPORTER** | High (gap) | Reporter field | Missing. |
| **T-NO-CHANGELOG** | Medium | Field history | Comments only. |
| **T-BOARD-SUBTASKS** | Medium | Nested work on board | Board shows parent (ENG-14 “Has subtasks”); children mainly in list/detail. |
| **T-MORE-ACTIONS** | Low | Clone / move / convert | Only Delete task. |
| **T-NO-ACCOUNT-MENU** | Low | Sign out / profile | Avatar is not clickable as a menu. |
| **T-COMMENT-DEDUP** | Low | Old ENG-2 duplicate comment text | Not re-checked (ENG-2 not opened this run). |

---

## 6. Keep from the current build

Do not throw away:

- Google OIDC + Synced  
- List / Board / filters / Cmd+K  
- Nested subtasks + progress chip  
- Labels taxonomy (keep as **tags**, not as types)  
- Dependencies (extend to issue links)  
- Projects as entities (make them mandatory + admin)  
- Follow / CC → evolve into Watchers  
- **New:** Notifications inbox + event prefs (add email on top)  
- **New:** Time Log + Timeline (evolve to hours + remaining, keep the week grid)  
- **New:** Attachments + markdown  
- **New:** QA team + Triage (keep as org/intake; still add issue types)

---

## 7. Suggested next sprint for Tracker itself

If ENG is using Tracker to build Tracker (ENG-14, ENG-21, ENG-32 attachments):

1. **P0-3** key search — smallest, already a bug.  
2. **P0-1 + P0-2** issue types + hierarchy — unblocks everything else.  
3. **P0-4 + P0-5** sprints + points + burndown.  
4. **P0-6** Bug type.  
5. **P0-7 + P0-8 + P0-9** people + email + changelog.  
6. **P0-10** admin CRUD.

Do **not** spend the next sprint on JQL, WIP limits, or a Figma-perfect roadmap until 1–5 work on staging with a real email.

---

*Retest method: Playwright MCP, logged in, no data mutated (create/log/comment cancelled). Re-run this file when P0-1 or P0-4 lands.*
