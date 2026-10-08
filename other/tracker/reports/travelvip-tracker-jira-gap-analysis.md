# TravelVIP Tracker → Jira-like Product Gap Analysis

**Audience:** Engineering / Product (shareable)  
**Product:** https://tracker.travelvip.ai  
**Last live audit:** **2026-09-16** (Playwright MCP, logged in as `rohan@travelvip.ai`)  
**Shareable retest (P0 / shipped / missing):** [travelvip-tracker-retest-2026-09-16.md](travelvip-tracker-retest-2026-09-16.md)  
**Prior sessions:** 2026-09-09 Agent360 E2E + 2026-09-10 teams retest + 2026-09-10 gap analysis  
**Goal:** Build a team-friendly tracker that behaves like Atlassian Jira for TravelVIP  

**This doc includes:**
1. Everything Product asked for (hierarchy, worklog, burndown, bugs→stories, email, etc.)
2. **Additional Jira-parity suggestions** from QA (features you need for a true Atlassian-like duplicate — §3.1 / §12)

**Target hierarchy (Product):**  
`Project → Epic → User Stories → Dev / QA (and other) sub-tasks`  
Bugs link to Stories. Sprints, worklogs, burndown, filters, assignee/reporter, and email notifications must work end-to-end.

---

## 0. Live retest after dev changes (2026-09-16)

Logged in as Rohan Bhagat `rohan@travelvip.ai`. **Verdict: not Jira-compatible yet.** Devs shipped a useful slice (notifications, day-based time log, attachments, Timeline timesheet, QA team, markdown descriptions). The P0 hierarchy / sprint / email / reporter / issue-type work is still missing. §8 Definition of Done is **0/10 full PASS**.

### What landed (vs 2026-09-10)

| Area | Now live |
|---|---|
| Notifications | Bell + Inbox (All/Unread) + Settings: pause, browser push, in-app event checkboxes (comment, mention, assigned, due, …). `/notifications` still **404** (panel only). **No email prefs.** Inbox empty — email path unproven. |
| Time tracking | Issue **Time Log**: date + 25/50/75/100% + day count. **Timeline** = person × week timesheet (Me / ENG / QA). Not Jira hours+note worklog; no remaining estimate; no CSV; no burndown. |
| Attachments | Issue dropzone + comment paste/drop + Attach files. |
| Markdown | ENG-21 Done — descriptions render as paragraphs (markdown support claimed shipped). |
| Teams | **QA** team with `QA-n` keys; ENG **Triage** view; create checkbox “Send to ENG triage”. |
| Comments | Write / Preview / attach. Activity still **comments-only** (no field changelog). |
| Cmd+K | Added QA + Tracker jumps. Still no Reports / Sprints / Epics / Settings. |

### Still failing (P0)

| Check | Result |
|---|---|
| Issue types Epic / Story / Bug / Sub-task (Dev/QA) | **Missing.** Create is still **New task**. Bug is still a **label**. JS bundles have no `issueType` / `epic` / `storyPoints` / `reporter`. |
| Reporter / Watchers | **Missing.** Still Assignees + CC + Follow. |
| Key search `q=ENG-17` | **BUG** — “No tasks match these filters”. Title search `Seat Unavailable` → ENG-17 **PASS**. `q=ENG-12` empty; `/tasks/ENG-12` is **404** (issue gone). |
| Sprint lifecycle | Sprint filter = **No matches**. Issue sprint picker = **No sprint** only. Sidebar SPRINTS gone. `/sprints` `/backlog` `/reports` **404**. |
| Board | Status columns (Triage…Canceled). Needs a single team. Not sprint-scoped. No WIP / swimlanes. |
| Burndown / velocity / sprint report | **Missing.** |
| Email on @mention / assignee | Prefs are **in-app only**. No email toggle. Inbox empty. |
| Admin CRUD | `/settings` `/teams` `/projects` `/epics` `/boards` `/admin` `/dashboard` still **404**. |
| Group by | Status / Assignee / Priority / Project only (no Epic / Type / Sprint). |
| More actions | **Delete task** only (no clone / move / convert). |
| Project mandatory | Create still has optional Project. |

### §8 DoD score (2026-09-16)

| # | Need | Status |
|---|---|---|
| 1 | Create Project TravelVIP | NOT TESTED (projects exist as data; no admin UI) |
| 2 | Create Epic under project | **FAIL** |
| 3 | Stories with AC + points | **FAIL** |
| 4 | Dev + QA sub-tasks | **FAIL** (generic Add subtask…; QA is a **team**, not a sub-task type) |
| 5 | Sprint N + sprint board | **FAIL** |
| 6 | Log work + per-person | **PARTIAL** (day % log + Timeline; no hours/note/CSV) |
| 7 | Bug type + link Story + reporter/watchers | **FAIL** |
| 8 | `@teammate` → **email** | **NOT TESTED** / likely **FAIL** (in-app prefs only) |
| 9 | Burndown + complete sprint | **FAIL** |
| 10 | Filter project + open sprint + type=Bug | **FAIL** |

Until 2–5, 7, 9–10 land, do not call Tracker a Jira replacement.

---

## 0.1 Prior live audit summary (2026-09-10)

| Check | Result |
|---|---|
| Login (Google OIDC) | PASS |
| List + Board + Synced | PASS |
| Teams ENG Active / Backlog / All ENG | PASS (counts live) |
| Projects sidebar filters | PASS |
| Sprint filter “Sept Sprint 1” → ENG-9, ENG-4 | PASS |
| Title search `q=Signoz` → ENG-9 | PASS |
| Key search `q=ENG-12` | **BUG** — empty |
| Nested subtasks under parent (list) | PASS |
| New task modal (ENG badge, no issue types) | Confirmed |
| Cmd+K palette (Go to views/projects) | PASS |
| Notification bell / Watchers / Reporter | **Missing** |
| Worklog / Story points / Burndown / Reports | **Missing** |
| Epic / Story / Bug issue types | **Missing** (Bug is a **label** only) |
| Admin routes `/settings` `/teams` `/projects` `/sprints` `/backlog` `/reports` `/dashboard` `/epics` `/boards` `/admin` `/notifications` | All **HTTP 404** |

**Verdict:** Strong **task/kanban POC**. Not yet a Jira replacement. Keep shell; rebuild issue-type hierarchy, sprint lifecycle, time tracking, and notifications.

---

## 1. What exists today (live inventory)

### 1.1 Shell & navigation
- Google OIDC (`Continue with Google`)
- Sidebar: **My Tasks** / **Following** / **All Tasks**
- **TEAMS:** ENG → Active / Backlog / All ENG
- **PROJECTS:** AMCB, Scandid, TravelVIP, TravelVIP › Flights / Hotels / Lounges
- **SPRINTS:** Sept Sprint 1 (filter only — not sprint planning UI)
- Cmd+K / Commands: jump to All Tasks, Board, My Tasks, Following, ENG, projects
- Light/Dark + **Synced**
- List + Board; filters: Status, Assignee, Sprint, Priority, Project, Label
- Group by: **Status | Assignee | Priority | Project** (no Epic / Issue Type / Sprint group)
- Subtasks toggle (show/hide nested rows)

### 1.2 Issue model (current)
- Single type: **Task** (`ENG-n`)
- Statuses: Backlog, Todo, In Progress, In Review, Done, Canceled
- Priorities: None / Urgent / High / Medium / Low
- Fields: multi **Assignees**, **CC** + **Following**, Project, Sprint, Labels, Start/Due
- Dependencies: Blocked by / Blocking (issue links lite)
- Subtasks: nested under parent; chip `0/2`
- Activity: **comments only** (incl. `@Name` text) — no field changelog, no email observed
- Labels include Bug, Feature, Android, API, iOS, Performance, etc. — **not issue types**

### 1.3 New task create form (live)
- Team badge **ENG** (fixed default)
- Title, description, Status, Priority, Assignees, CC, Project, Sprint, Label, Schedule
- **No** Issue Type picker, Epic, Story points, Estimate, Reporter, Severity, Attachments

### 1.4 Missing product surfaces (404)
Settings, Teams admin, Projects admin, Sprints admin, Backlog planning, Reports, Dashboard, Epics, Boards, Admin, Notifications inbox

---

## 2. Target model (agree once, then build)

```
Workspace
 └── Project (TravelVIP, AMCB, Scandid)          ← Jira “Project”
      ├── Board (Scrum / Kanban)
      ├── Backlog (ranked)
      ├── Epics
      │     └── Stories
      │           ├── Sub-task: Dev
      │           ├── Sub-task: QA
      │           └── linked Bugs
      ├── Bugs (link → Story; optional Epic)
      └── Sprints (future → active → completed)
            └── committed Stories (+ Bugs)
```

**Rules**
1. Work lives under a **Project** (mandatory).
2. **Epic** groups **Stories**.
3. **Story** = planning unit (AC, points, sprint).
4. **Dev / QA sub-tasks** under Story; progress rolls up.
5. **Bugs** link to Stories (`relates` / `blocks` / `caused by`).
6. **Sprint** holds Stories/Bugs; burndown from points + worklog.
7. **Assignee** = doer; **Reporter** = raiser; **Watchers** get email.

---

## 3. Gap matrix vs Jira (your requirements)

### A. Hierarchy & issue types — CRITICAL

| # | Need | Today | Suggestion |
|---|---|---|---|
| A1 | Epic / Story / Task / Bug / Sub-task | One Task type | Add `issueType` + icons + create menus |
| A2 | Project → Epic → Story → Sub-task | Flat tasks + optional subtasks | Enforce tree; Epic panel; breadcrumb |
| A3 | Create Story under Epic | N/A | “Create Story” from Epic |
| A4 | Dev / QA sub-tasks under Story | Generic “Add subtask…” | Typed templates: Dev, QA |
| A5 | Link Bug → Story | Blocked by / Blocking only | Full issue links + “Linked Story” |
| A6 | Epic progress | N/A | Stories done / points bar |
| A7 | Everything under Story | Subtasks only | Children panel always visible |

### B. People — CRITICAL

| # | Need | Today | Suggestion |
|---|---|---|---|
| B1 | Primary Assignee | Multi assignees | Keep multi optional; show primary like Jira |
| B2 | Reporter | Missing | Default = creator; editable |
| B3 | Watchers | Follow / CC | Rename to Watchers; drive email |
| B4 | @mention → notify | Text only (`@Akshay…`) | Resolve user + email + in-app |
| B5 | Team/project roles | Members only | Admin / Member / Viewer |
| B6 | Create teams/projects | Sidebar data; no CRUD UI | Admin pages (today 404) |

### C. Sprint & Agile — CRITICAL

| # | Need | Today | Suggestion |
|---|---|---|---|
| C1 | Ranked backlog | Status=Backlog filter | Dedicated Backlog + drag rank |
| C2 | Sprint create/start/complete | Sprint = filter chip | Lifecycle UI |
| C3 | Sprint-scoped board | Global status board | Board = active sprint |
| C4 | Story points | Missing | On Story (+ optional Bug) |
| C5 | Estimates (original/remaining) | Missing | Hours fields |
| C6 | Burndown chart | Missing | Points + hours |
| C7 | Velocity / sprint report | Missing | Reports section |
| C8 | Add/remove from sprint | Field only | Backlog “Add to sprint” |

### D. Worklog — CRITICAL (you called out)

| # | Need | Today | Suggestion |
|---|---|---|---|
| D1 | Log work (time + date + note) | Missing | Worklog panel on every issue |
| D2 | Worklog per person | Missing | Report: user × sprint/project |
| D3 | Remaining estimate adjust | Missing | Optional auto-reduce |
| D4 | My worklogs / CSV | Missing | Timesheet view + export |

### E. Defects / QA — CRITICAL

| # | Need | Today | Suggestion |
|---|---|---|---|
| E1 | Bug issue type + severity | Label “Bug” | `issueType=Bug` + S1–S4 |
| E2 | Repro steps / Expected / Actual | Free description | Bug create template |
| E3 | Link Bug → Story | Weak deps | Required linked Story for product bugs |
| E4 | QA sub-task under Story | Generic subtask | QA template |
| E5 | Components | Project hierarchy helps | Explicit Components field |

### F. Story quality

| # | Need | Suggestion |
|---|---|---|
| F1 | Rich description | Markdown editor |
| F2 | Acceptance criteria | Checklist section |
| F3 | Attachments | Uploads on issue |
| F4 | “Create Dev task” / “Create QA task” | One-click from Story |

### G. Search & filters — HIGH

| # | Need | Today | Suggestion |
|---|---|---|---|
| G1 | Search by key `ENG-12` | **BUG** | Fix immediately |
| G2 | Filters: type, epic, reporter | Partial pills | Add Issue Type, Epic, Reporter, Watcher |
| G3 | Saved filters / JQL-lite | Missing | Saved views |
| G4 | Board quick filters | Missing | Only my issues / Recently updated |

### H. Notifications — CRITICAL

| Event | Need |
|---|---|
| Comment on issue | Email watchers + assignee + reporter |
| @mention | Email mentioned users |
| Assignee change | Email new assignee |
| Status / sprint / due | Configurable |
| In-app | Notification bell + `/notifications` (404 today) |
| Prefs | Per-user email on/off by event |

### I. Views / reporting — HIGH

| Missing | Suggestion |
|---|---|
| Epic swimlanes | Board by Epic |
| Sub-tasks on board | Toggle like Jira |
| Dashboards | My open, burndown, bugs by severity |
| Roadmap | Epic timeline (P2) |

### J. Admin — HIGH

Project settings, workflows, screens by type, permissions, invite users, notification schemes, Jira/CSV importer (empty-state already mentions importer), audit/changelog beyond comments.

---

## 3.1 Additional Jira-parity suggestions (beyond original ask)

These are **QA recommendations** to make Tracker feel like real Jira Software — not only the items Product listed. Prioritize after P0 core hierarchy/sprint/worklog/notifications.

### K. Issue lifecycle & fields (Jira Software)

| # | Jira feature | Why it matters | Suggestion |
|---|---|---|---|
| K1 | **Resolution** (Fixed, Won’t Fix, Duplicate, Cannot Reproduce, Done) | Done ≠ Fixed; reporting needs resolution | Add Resolution on Done/Canceled transitions |
| K2 | **Status categories** (To Do / In Progress / Done) | Board & reports group correctly | Map each status → category |
| K3 | Transition screens | Capture resolution, comment on Done | Optional form on status change |
| K4 | **Fix Version / Affects Version** | Release tracking | Versions entity + fields on Story/Bug |
| K5 | **Components** | Flights/Hotels/API ownership | Project components (beyond project tree) |
| K6 | **Environment** on Bugs | Staging vs Prod defects | Bug field: environment |
| K7 | **Flagged / Impediment** | Standup blockers | Flag on card + filter |
| K8 | Clone issue (with/without subtasks & links) | Recurring work | Clone action |
| K9 | Move issue across projects | Wrong project created | Move + re-key or keep key policy |
| K10 | Convert issue type (Task→Story, etc.) | Mistakes happen | Convert with field mapping |
| K11 | Delete / archive issues | Cleanup without losing history | Soft-delete or archive |
| K12 | Inline edit title/fields | Jira speed | Click-to-edit on list + detail |
| K13 | Required fields by type | Bug needs severity; Story needs points | Screen schemes per type |
| K14 | Default values per project | Faster create | Project defaults (assignee, component) |
| K15 | Issue templates | Same bug form every time | Templates for Bug / Story / Spike |

### L. Hierarchy beyond Epic–Story (Advanced Roadmaps style)

| # | Feature | Suggestion |
|---|---|---|
| L1 | Optional **Initiative** above Epic | `Initiative → Epic → Story → Sub-task` for multi-quarter work |
| L2 | Cross-project Epics | One Epic spanning TravelVIP + AMCB (decide if needed) |
| L3 | Parent progress % | Auto % from child stories / sub-tasks |
| L4 | Split Story | Split unfinished points into new Story |
| L5 | Dependency graph view | Visualize blocks/blocked-by (not only list) |

### M. Board power features (Scrum + Kanban)

| # | Feature | Suggestion |
|---|---|---|
| M1 | Map **multiple statuses → one column** | Flexible workflows |
| M2 | **WIP limits** per column | Kanban discipline |
| M3 | Swimlanes: Epic / Assignee / Priority / Queries | Standup views |
| M4 | Card layout config (show points, due, flags) | Less noise |
| M5 | Card colors by priority/type | Scan board faster |
| M6 | Days-in-column indicator | Spot stuck work |
| M7 | Quick filters on board | “Only my”, “Bugs”, “Flagged” |
| M8 | Parallel sprints (optional) | Multiple teams on one project |
| M9 | Sprint **goal** text | Shown on board header |
| M10 | Kanban backlog + backlog column | If some projects aren’t Scrum |
| M11 | Rank drag on board + backlog | Same as Jira rank |
| M12 | Hide done issues after N days | Board hygiene |

### N. Agile reports (full set)

| # | Report | Suggestion |
|---|---|---|
| N1 | Sprint burndown (points + hours) | Already in Product ask — keep |
| N2 | **Burnup** chart | Scope-change visibility |
| N3 | **Velocity** chart | Last N sprints |
| N4 | Sprint report (committed vs completed vs removed) | End-of-sprint |
| N5 | **Cumulative Flow Diagram (CFD)** | WIP / bottlenecks |
| N6 | Control chart (cycle time) | Predictability |
| N7 | Epic report / Epic burndown | Epic health |
| N8 | Version report / release burndown | With Fix Versions |
| N9 | Created vs Resolved bugs | QA quality trend |
| N10 | Average age of open bugs | Defect backlog health |
| N11 | Worklog by person / by project / by epic | Capacity & billing |
| N12 | Lead time / cycle time dashboards | Flow metrics |

### O. Search, JQL, filters (Atlassian depth)

| # | Feature | Suggestion |
|---|---|---|
| O1 | Full **JQL-like** language | `project = TV AND sprint in openSprints() AND type = Bug` |
| O2 | Autocomplete for fields/values | Like Jira navigator |
| O3 | Saved filters (private / shared / favourites) | Team reuse |
| O4 | Filter subscriptions (daily/weekly email digest) | Passivebox without spam |
| O5 | Recently viewed issues | Cmd+K section |
| O6 | Basic search across comments + description | Not title-only |
| O7 | Search operators: empty, was, changed AFTER | Power users |
| O8 | Board “Filter” based on saved filter | Classic Jira board |

### P. Automation & integrations

| # | Feature | Suggestion |
|---|---|---|
| P1 | **Automation rules** | When Bug → In Review, notify QA; when Story Done, close sub-tasks |
| P2 | Webhooks out | Slack / Teams / custom |
| P3 | Incoming email → Bug | Optional defect intake |
| P4 | **GitHub/GitLab PR panel** | Branch, PR, commits on issue |
| P5 | CI build status on issue | Pass/fail badge |
| P6 | Public REST API + API tokens | Same as Jira for scripts |
| P7 | Slack deep links | `/tracker ENG-12` |
| P8 | Calendar sync for due dates | Optional |

### Q. Collaboration & activity

| # | Feature | Suggestion |
|---|---|---|
| Q1 | Full **changelog** (who changed what/when) | Not comments-only |
| Q2 | Edit / delete own comments | Basic hygiene |
| Q3 | Comment reactions / emoji | Lightweight ack |
| Q4 | Pin important comment | AC or decision pin |
| Q5 | @here / @team (optional) | Team pings |
| Q6 | Activity stream (project-wide) | “What changed today?” |
| Q7 | Presence / who is viewing (optional) | Avoid edit clash |
| Q8 | Rich text: headings, tables, code blocks, checklists | Story AC quality |
| Q9 | Image paste into description/comments | Bug screenshots fast |
| Q10 | Attachment preview + versioning | Design/QA assets |

### R. Permissions, security, admin schemes (Jira DNA)

| # | Feature | Suggestion |
|---|---|---|
| R1 | **Permission scheme** | Create/Edit/Transition/Delete/Worklog rights |
| R2 | Project roles (Admin, Developer, QA, Viewer) | Map Google groups later |
| R3 | Issue security levels (optional) | Sensitive issues |
| R4 | Workflow scheme per project | TravelVIP ≠ AMCB |
| R5 | Issue type scheme | Which types allowed in project |
| R6 | Field / screen scheme | Bug screen ≠ Story screen |
| R7 | Notification scheme | Who gets what email |
| R8 | Audit log (admin) | Compliance |
| R9 | Project archive | Soft-retire projects |
| R10 | User deactivate / offboarding | Preserve history |
| R11 | Guest / read-only link (optional) | External stakeholders |
| R12 | SSO already (Google) + session timeout policy | Harden |

### S. UX / productivity (Jira keyboard & speed)

| # | Feature | Suggestion |
|---|---|---|
| S1 | Global shortcuts: `C` create, `G`+`D` dashboard, `/` search | Power users |
| S2 | Bulk edit / bulk transition / bulk move to sprint | Planning days |
| S3 | Bulk assign / label | Triage |
| S4 | “Send to top/bottom” rank | Backlog grooming |
| S5 | Empty states with next action CTA | Onboarding |
| S6 | Onboarding checklist for new joiners | First Epic/Story |
| S7 | Printable sprint cards / PDF export | Optional ceremonies |
| S8 | CSV / Excel export of filters | Reporting outside app |
| S9 | Wallboard / TV mode for board | War room |
| S10 | Mobile-responsive issue view | On-call bugs |
| S11 | Undo last transition (short window) | Mistake recovery |
| S12 | Draft issue auto-save | Don’t lose create form |

### T. QA / engineering-specific (TravelVIP context)

| # | Feature | Suggestion |
|---|---|---|
| T1 | Bug **severity** + SLA clocks (P1 response time) | Support-like severity |
| T2 | Regression label + “found in build” | Link to release |
| T3 | Test case link / checklist on QA sub-task | Already have Test case label — deepen |
| T4 | Environments: staging / canary / prod | Match TravelVIP API envs |
| T5 | “Blocked by vendor” status or flag | Riya/IX type waits |
| T6 | Defect reject → reopen workflow | QA fails Dev fix |
| T7 | Story “Definition of Ready” gate | Can’t pull to sprint without AC/points |
| T8 | Story “Definition of Done” checklist | Auto-prompt on Done |
| T9 | Link API automation case IDs | Bridge to this QA repo later |
| T10 | Flaky / quarantine label for automation | Engineering hygiene |

### U. Planning & capacity

| # | Feature | Suggestion |
|---|---|---|
| U1 | Team capacity hours per sprint | Vs committed points |
| U2 | Individual capacity / leave | Realistic commitment |
| U3 | Commitment vs completed at sprint start | Sprint health |
| U4 | What-if planning (optional) | Advanced Roadmaps lite |
| U5 | Estimation helper (Fibonacci points UI) | Consistent points |

### V. Data migration & coexistence

| # | Feature | Suggestion |
|---|---|---|
| V1 | Jira CSV / JSON import | Empty-state already mentions importer — ship it |
| V2 | Preserve issue keys where possible | Or map old→new |
| V3 | Import users / watchers / links | Don’t lose graph |
| V4 | Dual-run period checklist | Jira + Tracker in parallel |
| V5 | Export out anytime | Avoid lock-in fear |

---

## 4. Naming / UX / copy changes (design)

| Current | Suggested |
|---|---|
| Task / New task | **Issue** / **Create issue** (type picker first) |
| All Tasks | **Issues** or project Board / Backlog |
| Follow / CC | **Watchers** |
| Subtasks (generic) | **Sub-tasks** with Dev / QA type |
| Project optional | **Project mandatory** |
| Team vs Project | Clarify: Team = org; Project = delivery container |
| Label “Bug” / “Feature” | Prefer **Issue Type**; labels stay as tags |
| Empty-state “create a team, then a task…” | “Create a **project**, then an **Epic** / **Story**…” |

**Suggested IA**

```
Sidebar
├── My work
├── Boards → [Project] Scrum board
├── Backlog
├── Epics
├── Issues (search)
├── Sprints (+ reports)
├── Reports (burndown, velocity, worklog by person)
└── Project settings
```

---

## 5. Suggested data model

```text
Project { id, key, name, leadUserId, type: scrum|kanban, components[], versions[] }
Initiative? { id, key, projectIds[] }          // optional L1
Issue {
  issueType: epic|story|task|bug|subtask|spike?
  projectId, epicId?, parentId?, initiativeId?, sprintId?
  reporterId, assigneeId?, watcherIds[]
  points?, originalEstimateSec?, remainingEstimateSec?
  severity?, environment?, components[], fixVersions[], affectsVersions[]
  resolution?, flagged?, acceptanceCriteria?, rank
}
SubTask.subType: dev|qa|other
IssueLink { fromId, toId, linkType }
Worklog { issueId, userId, seconds, workDate, note }
Sprint { projectId, name, goal?, startAt, endAt, state: future|active|closed }
Notification { userId, issueId, event, channel: email|inapp }
AutomationRule { projectId?, trigger, conditions, actions }
SavedFilter { jql, ownerId, sharedWith }
PermissionScheme / WorkflowScheme / NotificationScheme
Attachment { issueId, url, uploadedBy, createdAt }
Changelog { issueId, field, from, to, authorId, at }
```

---

## 6. Delivery phases

### P0 — Daily standup usable like Jira (Product must-haves)
1. Issue types: Epic, Story, Bug, Task, Sub-task (Dev/QA)  
2. Hierarchy UI + breadcrumb  
3. Reporter + primary Assignee + Watchers  
4. **Fix key search**  
5. Sprint create/start/complete + backlog rank + sprint board  
6. Story points + basic burndown  
7. Bug form + link to Story  
8. Email on comment / @mention / assignee change  
9. Activity changelog (not comments only)  
10. Project mandatory on create  

### P1 — Tracking & QA maturity (Product + high-value Jira extras)
Worklog + per-person report + CSV · estimates · components/severity/environment · attachments + image paste · AC checklist · Resolution field · saved filters · in-app notifications · team/project admin CRUD · sprint report + velocity · board quick filters / WIP · clone issue · bulk move to sprint · GitHub/GitLab PR panel (if repos known)

### P2 — Strong Jira Software parity (QA suggestions §3.1)
Roadmap / timeline · dashboards + wallboard · Fix/Affects Versions · CFD + control chart + burnup · JQL-like search + filter subscriptions · automation rules · webhooks · permission/workflow/notification schemes · flagged impediments · epic/version reports · capacity planning · CSV/Jira import-export · keyboard shortcuts · bulk edit · mobile-responsive issue view  

### P3 — Nice-to-have / Atlassian-complete
Initiative hierarchy · Advanced dependency graph · parallel sprints · SLA clocks · incoming-email → bug · Slack bot · planning poker · guest links · custom fields builder · printable cards · presence indicators  

---

## 7. Open QA bugs / debt (live)

| ID | Issue | Severity |
|---|---|---|
| T-SEARCH-KEY | `q=ENG-12` (and earlier ENG-2) → no results; title search works | **High** |
| T-ADMIN-404 | No UI/routes for settings, teams, projects, sprints, reports, notifications | **High** |
| T-NO-ISSUETYPE | Cannot create Epic/Story/Bug as types; Bug is label | **High** (product gap) |
| T-NO-WORKLOG | No time tracking / burndown / per-person hours | **High** (product gap) |
| T-NO-EMAIL | @mentions in comments do not imply email/in-app notifications | **High** (product gap) |
| T-BOARD-SUBTASKS | Board shows parents; nested subtasks mainly in list/detail | Medium |
| T-COMMENT-DEDUP | Early POC showed concatenated duplicate comment text on ENG-2 | Low |

---

## 8. Definition of done (“Jira duplicate”)

A PM can:
1. Create Project **TravelVIP**  
2. Create Epic under it  
3. Create Stories with AC + points under that Epic  
4. Add **Dev** + **QA** sub-tasks; assign teammates  
5. Move Stories into **Sprint N**; board shows only that sprint  
6. Log work; see **worklog per person** for the sprint  
7. File a **Bug**, link to Story; assignee/reporter/watchers correct  
8. Comment `@teammate` → teammate gets **email**  
9. View **burndown**; complete sprint with report  
10. Filter like: project + open sprint + type = Bug  

Until these 10 work, do not position Tracker as a Jira replacement.

---

## 9. Keep from current build

- Google auth + Synced feel  
- List/Board shell, filters, Cmd+K  
- Nested subtasks  
- Labels taxonomy  
- Dependencies → extend to issue links  
- Projects / Sprints as entities (grow into full modules)  
- Follow/CC → evolve into Watchers  

---

## 10. Product decisions needed

1. Is **Team** = Jira Project, or is **Project** = Jira Project and Team = org group?  
2. Single primary Assignee vs multi forever?  
3. Scrum only, or Kanban too?  
4. Points, hours, or both?  
5. Must Bugs always link to a Story?  
6. Email provider (SES/SendGrid/Google) + from-address?  
7. Do we need **Versions/Releases** and **Initiatives** in v1?  
8. Git provider to integrate first (GitHub / GitLab / Bitbucket)?  
9. How strict should permissions be on day 1 (open vs schemes)?  
10. Target: “Jira Software Cloud subset” or “full duplicate including admin schemes”?  

---

## 11. Live workspace snapshot (audit day)

- User: `rohan@travelvip.ai`  
- All Tasks ≈ 6 (ENG); projects/sprints populated  
- Sample issues: ENG-2 (Backlog, subtasks ENG-8/ENG-11), ENG-9, ENG-4, ENG-12  
- Mentions in Activity prove @syntax exists but notification stack is unproven/absent  
- Tooling note: Agent360 Browser MCP failed (“No tabs”); audit completed via **Playwright MCP**  

---

## 12. Coverage checklist (Product ask + QA Jira extras)

### From Product (original)
- [x] Project → Epic → Story → Dev/QA sub-tasks  
- [x] Bug logging + link to Story  
- [x] Worklog + worklog per person  
- [x] Sprint structure + burndown  
- [x] Assignee + Reporter  
- [x] Filtering  
- [x] Comment / @mention email notifications  
- [x] Design / naming / IA suggestions  
- [x] Live explore of current build  

### Added by QA for Jira-like duplicate (§3.1)
- [x] Resolution, versions, components, environment, flag  
- [x] Clone / move / convert / bulk / archive  
- [x] Board: WIP, swimlanes, quick filters, sprint goal, card layout  
- [x] Full agile reports: burnup, velocity, CFD, control chart, epic/version reports  
- [x] JQL-like search, saved filters, subscriptions  
- [x] Automation, webhooks, Git/CI panel, REST API  
- [x] Changelog, rich text, attachments, reactions  
- [x] Permission / workflow / notification schemes  
- [x] Shortcuts, export, wallboard, mobile  
- [x] TravelVIP-specific QA fields (build, env, DoR/DoD, automation case IDs)  
- [x] Capacity planning + Fibonacci points UI  
- [x] Migration import/export / dual-run  

---

*Update this file whenever hierarchy, sprint, worklog, or notification features land — then re-run the live checklist in §0.*
