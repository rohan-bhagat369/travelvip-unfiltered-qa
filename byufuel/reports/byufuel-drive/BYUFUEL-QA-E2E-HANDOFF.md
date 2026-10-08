# Byufuel / Centvis — QA End-to-End Handoff Guide

**Product:** Byufuel (Used Cooking Oil pickup, warehouse, and payment) running on Centvis
**QA window:** 22–23 September 2026
**Author:** Rohan Bhagat
**Purpose:** A single reference for managers, client conversations, and new team members — what was set up, how the real flow is supposed to run, what was tested, what worked, what's blocked, and what's still unclear.

---

## 1. The short version

We ran the **full UCO journey** across four surfaces:

- **Admin web** — master data, approving requests, building itineraries, assigning drivers
- **Supplier app (APK)** — selling oil / raising a pickup request
- **Driver app (APK)** — accept → start → pickup (QR scan + quantity) → documents → arrive at warehouse
- **Warehouse Worker web** — checking in the oil (via *Check in Oil*, not *Collect Oil*)

**The furthest a run got (23 Sep, evening):**
Schedule `SCH-000006623` → Itinerary `IT-000001188` → Driver **Atul Ugale** in vehicle `MH14GA1111` → pickup completed with container `B-2609-3-00005` (10 kg, Grade A, ₹1180) → driver status **Arrived At Warehouse**.

**Where it stops:** Warehouse **Check in Oil → Scan** crashes the frontend (a `gradeIds` error) and the itinerary's `containerId` shows as `null` even though the container exists. **Confirm Checkin** never becomes clickable, so payment and final "stored in warehouse" status could not be verified on this run.

An earlier run (`IT-000001186` / `SCH-000006622`) was contaminated — the wrong menu (*Collect Oil*) was used with a reused QR code, and it ended in **Missing / Pending Investigation**. Treat **IT-188 as the clean reference** and **IT-186 as a known-bad path** to avoid repeating.

---

## 2. Environment & access

| Item | Value |
|---|---|
| Current web portal (tunnel) | `https://teams-instant-planning-miller.trycloudflare.com` |
| Earlier tunnels (likely dead) | `schemes-empirical-disk-score…`, `phillips-eric-furnishings-casey…` |
| Azure reference environment (separate) | `https://d-byufuel.azurewebsites.net` |
| Auth realm | `byufuel-dev` (Keycloak, via tunnel `/idp`) |
| Operational area | Mumbai (`MUM001`) |
| Warehouse | WareOne — code `WH-000000046` |

**Two things to keep in mind:**
- The tunnel URL changes often. A login screen showing **Error 530** means the local app or `cloudflared` has gone down — restart both and grab the new URL.
- The tunnel points local WebUI at **staging APIs**. Don't assume the Azure environment and the tunnel share the same data unless that's been confirmed.

---

## 3. Users created for QA

### Admin
| Field | Value |
|---|---|
| Email | `adminm@yopmail.com` |
| Password | `Byufuel@12345` |
| Role | Super Admin |

### QA dummy users
All were originally created with password `Byufuel@123`, but Keycloak later rejected that password for the Supplier and Warehouse Worker accounts, so both were reset. **Use the current passwords below.**

| Role | Name | Email | Phone | Registered as | Warehouse | Notes |
|---|---|---|---|---|---|---|
| Supplier | QA Supplier | `qa.supplier.byufuel@yopmail.com` | 9876501001 | Mobile (APK) | — | Active; Andheri, pincode 400069 |
| Driver (dummy) | QA Driver | `qa.driver.byufuel@yopmail.com` | 9876501002 | Mobile | WareOne | Stuck at **Registered** — no KYC docs |
| WH Worker | QA WHWorker | `qa.whworker.byufuel@yopmail.com` | 9876501004 | Web | WareOne, Supervisor | Use the **web** app for check-in — the APK hangs |

**Current passwords (post-reset):**
| User | Password |
|---|---|
| QA Supplier | `dTcmBi!3` |
| QA WHWorker | `w6!CcGzV` |

### Driver used for the live run (pre-existing, already activated)
| Field | Value |
|---|---|
| Name | Atul Ugale |
| Email | `atul@yopmail.com` |
| Phone | +91 9665498686 |
| Vehicle | Mini Truck `MH14GA1111`, 800 kg capacity |
| Status | Active |

> The dummy **QA Driver** couldn't be activated — approving it without KYC + vehicle RC documents returns **HTTP 500** (`PleaseUploadDriverAndByufuelDocuments`). All E2E runs used **Atul** instead.

### Login rules worth remembering
- **Supplier / Driver** accounts are registered as **Mobile** → they must use the **APK**. Trying to log a supplier in on the web shows *"Please login using Mobile App."*
- **WH Worker** accounts are registered as **Web** → the APK just hangs after credentials are entered.
- Being **Active** in Admin doesn't guarantee the APK password works. If the app says invalid credentials, go to Admin → user → **Reset Password**.

---

## 4. Master data set up in Admin

Do this setup **before** raising a supplier request if the environment is empty.

**MDM configuration:**
- **Time slots:** e.g. 9 AM–12 PM, plus a wide 8 AM–11 PM slot for same-day QA. Note: empty time slots cause `/api/time-slots/search` to return 500 — creating any slot fixes it. Also, the From/To fields in the UI show raw numbers 1–24 instead of AM/PM labels (a UX rough edge).
- **UCO configuration:** Min 5 kg, Max 200 kg, INR, Grades A/B/C, cancellation fee ₹50, contact `9876501099` / `qa.uco.config@yopmail.com`, GSTIN `27AABCT1429B1Z1`. This template appears on the pickup challan PDF.
- **`driverJourneyStart` rule:** must allow **Start** during QA — e.g. "No Rule," not a "Before Starting Itinerary" rule with hours that block it. Getting this wrong blocks the driver from starting with a confusing error.
- **Rate configuration:** Mumbai, Grade A, ₹100/kg + 18% GST → works out to ₹1180 for 10 kg. Only **Grade A** is selectable in the rate dropdown; B and C cannot be rated.
- **Operational areas:** Mumbai linked.

**Inventory / user setup:**
- Warehouse: WareOne was already present.
- Vehicle: created a dummy Tata Ace Mini Truck (`MH14QA3175`); the live run actually used Atul's `MH14GA1111`.
- Containers: created manually (e.g. `B-2609-3-00003`). Note that **Generate QR** creates a **brand-new** container code (e.g. `B-2609-3-00004`) rather than attaching a QR to an existing container.
- Supplier approval: REGISTERED → ACTIVE went through even with empty KYC/bank details — weaker validation than expected.
- Driver approval: blocked without KYC/RC documents, and fails with a 500 rather than a clean error.

---

## 5. The happy-path playbook

Use this as the reference flow for a new teammate running the journey end-to-end.

**Phase A — Admin sets the foundation (once per environment)**
1. Log into Admin web.
2. Confirm OA Mumbai, WareOne, time slots, UCO config, and the Grade A rate all exist.
3. Confirm an Active supplier, an Active driver with a vehicle, and a WH worker on WareOne all exist.
4. Have at least one **unused** container QR ready (see the QR rules in §12).

**Phase B — Supplier raises a pickup (APK)**
1. Log into the Supplier APK.
2. Choose **Sell Oil → Pickup** (not Drop, unless specifically testing Drop).
3. Pick today or the next bookable day, with a slot wide enough to cover testing (QA often uses 8 AM–11 PM).
4. Enter Grade A, 10 kg → expect an estimate of ₹1180 (if rates are configured correctly).
5. Submit and note the resulting **SCH-########** number.

*Alternative without the APK:* In Admin, go to **Request Management → Create Bulk Request**, select QA Supplier, set date/slot/weight, and create it. Then process the pending bulk request (either call `GET /api/uco-schedules/create-bulk-request-uco-schedules` or wait for the background job) until the schedule shows **Approved**.

**Phase C — Admin approves and builds the itinerary**
1. In **Manage Requests**, approve the request if it's still "Request Placed."
2. Go to **Itinerary Management → New Itinerary**.
3. Select the schedule card.
4. Set starting location to **Driver**, drop location to **WareOne**.
5. Create it and note the resulting **IT-########** number.
6. Open the itinerary and use **Assign Driver → ASSIGN** on Atul. This must move the *itinerary's* status to **Driver Assigned** — not just the schedule's.
7. Double-check both the schedule and the itinerary show the driver as assigned before moving on.

**Phase D — Driver app**
1. Log in as Atul and refresh.
2. Tap **Accept** — this only appears if the itinerary is properly in **Driver Assigned** status.
3. Tap **Start** (requires a `driverJourneyStart` config that doesn't block starting).
4. At the supplier stop, scan the container.
5. **QR format matters:** the code must be JSON, `{"Code":"B-xxxx-x-xxxxx"}` — a plain-text code shows **Invalid QR**.
6. Enter Quantity 10, Capacity ≥ 10 (e.g. 40), Grade A.
7. Capture a photo if required, then go to **Documentation**, sign as Driver + FBO, and generate the challan. Leave "Paid to Supplier" unchecked unless specifically testing cash — the PDF will correctly show "Not Paid."
8. Complete the pickup, navigate to WareOne (Guide Mode optional), and mark **Arrived At Warehouse**.

**Phase E — Warehouse Worker web (use *Check in Oil*, not *Collect Oil*)**
1. Log in as `qa.whworker…` on the **web** app.
2. Open **Check in Oil** specifically — do not use **Collect Oil From Supplier** for this journey.
3. Open the itinerary row (status should read **Arrived At Warehouse**).
4. Scan → Manual → enter the container code. (Known issue: Manual entry expects a plain code, but the driver's QR is JSON — see §9.)
5. It should register as **1/1 scanned**; set the check-in weight and hit **Confirm Checkin / Complete**.
6. Confirm the itinerary/schedule move out of Pending Investigation, then check **Supplier Payment**.

**Phase F — Payment (expected after a successful check-in)**
- In Admin, **Supplier Payment** should show an amount matching the fixture (₹1180 in this case).
- Flag: an earlier contaminated run showed payment as **Credited** while the itinerary was still in **Pending Investigation** — this needs a product decision (see §10).

---

## 6. What we actually ran

### The contaminated path (a lesson, not a template)
| ID | Result |
|---|---|
| `SCH-000006622` | Supplier request raised; later reached the warehouse |
| `IT-000001186` | Ended in **Pending Investigation / Missing container** |

**What went wrong:** the wrong warehouse menu (**Collect Oil** instead of **Check in Oil**) was used, with a QR code that had already been used on a different schedule. **Lesson:** one QR per journey, and the warehouse menu must always be **Check in Oil**.

### The clean path (23 Sep — the primary reference)
| Step | Result |
|---|---|
| Portal | `teams-instant-planning-miller.trycloudflare.com` |
| Bulk request `BR-000000113` | QA Supplier, today, 8 AM–11 PM, 10 kg → Completed |
| Schedule | `SCH-000006623` — Approved → Driver Assigned |
| First itinerary attempt | `IT-000001187` — schedule showed assigned, but the itinerary itself stayed stuck at Created, so no Accept ever appeared; it was cancelled |
| Working itinerary | `IT-000001188` — correctly assigned, reached Driver Assigned |
| Driver | Accept → Start → Pickup, QR `B-2609-3-00005`, 10 kg, Grade A, capacity 40 |
| Documents | Challan generated, marked Not Paid, both signatures captured |
| Warehouse arrival | Arrived At WH |
| Warehouse check-in | **Blocked** — scan crash (details in §9) |

---

## 7. Coverage map

| Area | Status | Via |
|---|---|---|
| Admin login / session | ✅ Covered | Web |
| MDM: time slots, UCO config, rates | ✅ Covered | Web |
| Warehouse / vehicles / containers / Generate QR | ✅ Covered | Web |
| Create & approve supplier | ✅ Covered | Web |
| Driver KYC / approve | ⚠️ Partial — blocked without docs | Web |
| Create WH worker | ✅ Covered | Web |
| Supplier sell oil / pricing | ✅ Covered | APK (+ bulk alternate on web) |
| Admin approve request | ✅ Covered | Web |
| Create itinerary + assign driver | ✅ Covered | Web |
| Driver accept / start / guide mode | ✅ Covered | APK |
| Driver QR scan + quantity/capacity | ✅ Covered | APK |
| Pickup documentation / challan PDF | ✅ Covered | APK |
| Driver arrive at warehouse | ✅ Covered | APK |
| WH Check in Oil | ❌ Attempted, blocked | Web |
| WH Collect Oil (as a negative case) | ✅ Covered — confirmed this path causes Missing | Web |
| Supplier payment end-state | ⚠️ Partial — only seen on the prior (contaminated) run | Web |
| Chat | ❌ Broken (401) | Web |
| Reschedule / Suggest new time | ❌ Broken (slot selection) | Web |
| Drop flow warehouse selection | ⚠️ Issue noted | APK |

---

## 8. What worked vs. where it blocks

**Ran correctly:**
- Admin can create time slots, UCO config, and rates (Grade A); build bulk schedules; and create itineraries with Driver → WareOne routing.
- A proper **ASSIGN** call (`PATCH …/update-assign-driver` with `{ id, driverId }`) correctly moves the itinerary to **Driver Assigned**, after which the driver sees **Accept**.
- Driver Start (with a non-blocking journey-start config), pickup, challan generation, and arrival at the warehouse all work.
- The pickup PDF correctly shows "unpaid" when "Paid to Supplier" is left unchecked.
- The warehouse list correctly shows the itinerary at **Arrived At Warehouse** with 10 kg collected.
- The container master record is correctly created at the point of pickup (`B-2609-3-00005`).

**Where it blocks, in priority order:**
| # | Block | Where | Impact |
|---|---|---|---|
| 1 | Check in Oil → Scan throws a `gradeIds undefined` error; scanned count stays at 0/1 | WH web | **Blocks E2E completion and payment verification entirely** |
| 2 | Itinerary's UCO detail shows `containerId: null` after a successful driver pickup | Data / pickup API | Root cause of the check-in / missing-container behavior |
| 3 | Partial driver assignment — schedule shows Driver Assigned but itinerary stays at Created | Admin assign | Driver never sees an Accept button |
| 4 | Driver Start blocked by the `driverJourneyStart` UCO config | MDM + APK | Driver cannot leave the depot |
| 5 | Dummy driver can't be activated without KYC/RC docs; Approve returns HTTP 500 | Admin | Have to substitute a different Active driver |
| 6 | WH APK is unusable for a Web-registered worker | APK | Must use web instead |
| 7 | Tunnel returns Error 530 when the origin or `cloudflared` is down | Infra | No web testing possible until restarted |

### The critical warehouse check-in bug, in detail
| | |
|---|---|
| **How it was tested** | WH → Check in Oil → IT-188 → Scan → Manual → `B-2609-3-00005` |
| **Expected** | Scanned reaches 1/1 → Confirm Checkin becomes available → status moves to Stored in Warehouse |
| **Actual** | The API does find the OilCollected row, but the UI console throws `Cannot read properties of undefined (reading 'gradeIds')`. Scanned count stays at 0/1, and Confirm Checkin does nothing. |
| **Related data issue** | The pickup detail shows `containerId: null`, even though a valid container ID (`x6Frn1ButDMpmfR3GPpSZQ`) exists for it. |
| **QR complication** | The driver requires a JSON-format QR, but Manual search in the warehouse UI treats a full JSON string as a literal container number and returns zero hits. |

---

## 9. Full issues list (for client / managers)

Severity key: **Blocker** > **Bug** > **Issue** > **UX**

| # | Severity | Page / action | Platform | Issue |
|---|---|---|---|---|
| 1 | Blocker | Check in Oil – Scan | Web | Scan crashes (`gradeIds`); IT-188 cannot be checked in |
| 2 | Blocker | Check in Oil | Web | Once an item hits Missing / Pending Investigation, Scan is hidden and the checklist can't be completed |
| 3 | Bug | Check in Oil – Complete | Web | API may move toward "Stored In Warehouse" while the UI still shows Missing / Pending |
| 4 | Bug | Collect Oil vs. Check in Oil | Web | Using Collect Oil, or reusing a QR, results in Missing / Pending Investigation |
| 5 | Bug | Driver / WH Scan QR | App/Web | A plain code shows Invalid QR; only `{"Code":"…"}` JSON works on the driver app |
| 6 | Bug | Generate QR Codes | Web | Creates a **new** container instead of attaching a QR to an existing one (`qrCode` stays null) |
| 7 | Bug | Generate QR Codes | Web | UI only asks for a count — no capacity or quantity inputs |
| 8 | Bug | Driver – Scan after dashboard QR | Web/App | Capacity/quantity are blank after scanning |
| 9 | Bug | Driver Approve | Web | Missing KYC/docs returns HTTP 500 instead of a proper 400 validation error |
| 10 | Bug | Create New Supplier / login | Web/App | Registration/login problems have been historically reported |
| 11 | Bug | Login | Dashboard | 403 for some other users |
| 12 | Bug | Sell Oil pricing | APK | Estimated price/tax/total show 0.00 when rates or config are wrong |
| 13 | Bug | Sell Oil – Drop | APK | Warehouse selection is unresponsive |
| 14 | Bug | Suggest a New Time | Dashboard | Time slots cannot be selected |
| 15 | Bug | Driver Guide → Navigation | APK | App crash |
| 16 | Bug | Phone-call icon | Supplier/Driver APK | Shows null or "account not active" |
| 17 | Bug | WH Worker login | APK | Hangs after credentials (for Web-registered users) |
| 18 | Bug | Driver Start | APK/MDM | Blocked by `driverJourneyStart` with confusing messaging |
| 19 | Bug | Chat hub | Web | Persistent 401 |
| 20 | Issue | Rate Configuration | Web | Grades B/C can't be rated — only Grade A |
| 21 | Issue | Supplier Approve | Web | Can go Active with empty establishment/KYC/bank details |
| 22 | Issue | Lists (Drivers/Rates) | Web | Briefly show "0 of 0" before populating on refresh |
| 23 | UX | MDM Time Slots | Web | Hours shown as raw 1–24 integers, not AM/PM labels |
| 24 | UX | Admin session | Web | Auto-logout after ~5–10 minutes with no clear warning |
| 25 | UX | WH Worker creation | Web | Warehouse is required but validation is weak when none exist |
| 26 | Bug | Itinerary assign (partial) | Web | Schedule shows Driver Assigned but itinerary stays Created — no Accept appears (seen on IT-187) |
| 27 | Bug | `containerId` on pickup detail | API | Stays null even after a successful driver pickup |

*(Note: the tracking sheet has a column header typo — "Platfrom" should read "Platform.")*

---

## 10. Open questions for the client / product team

| # | Question | Page | Platform |
|---|---|---|---|
| 1 | Do we perform KYC on the driver? (Profile shows KYC/bank fields.) | Profile | Driver App |
| 2 | What's the difference between a "Supplier container" and a "Byufuel container"? | Home | Driver App |
| 3 | Does each restaurant need its own supplier account/login? | Sign up | Supplier App |
| 4 | What are supplier bank details actually used for? | Sign up | Supplier App |
| 5 | What defines Grade A/B/C, and who assigns it? | Home | Supplier App |
| 6 | Why can location be changed on Home if signup already captured an address? | Home | Supplier App |
| 7 | Should pickup reminders be a call or an SMS? | Request pickup | Supplier App |
| 8 | What's the intended end-to-end journey for "Request New Drop"? | Drop | Supplier App |
| 9 | Under what conditions does chat appear? | Upcoming | Supplier App |
| 10 | Is QR-based pickup actually in use on the supplier side? | UCO pickup | Supplier App |
| 11 | Are there password expiry rules per role? | Home | Supplier App |
| 12 | Is it meant to be the same container QR across Collect Oil and Check in Oil, or one QR per journey? | Check-in | Web |
| 13 | When an item is Missing / Pending Investigation, what's the recovery path — rescan, mark as missing, or does admin need to clear it first? | Check in Oil | Web/App |
| 14 | Is it expected that payment shows Credited while the itinerary is still Pending Investigation? | Supplier Payment | Web |
| 15 | Should WH workers be registered as Mobile for APK use, or is web-only sufficient? | Login | WH |
| 16 | Is the JSON `{"Code":…}` format the official QR contract? | Scan | Driver/WH |
| 17 | What's the correct staging value for `driverJourneyStart`? | Start / MDM | Driver/MDM |
| 18 | Is "No Rule" for Driver Contact Display intentional? | UCO Config | Web |

---

## 11. Talking points for manager → client

1. **Warehouse check-in is currently broken** on staging after a successful driver pickup, so the E2E flow can't be closed out.
2. **The QR contract is unclear** — the driver app requires JSON, but warehouse manual entry behaves differently.
3. **Collect Oil vs. Check in Oil** is easy to confuse and, once misused, corrupts the itinerary's state.
4. **Generate QR doesn't bind to an existing container** — it silently creates a new one instead.
5. **Driver activation is blocked by missing documents**, and the failure comes back as an HTTP 500 rather than a clean validation message.
6. **Suppliers can go Active without KYC/bank details** — worth confirming whether the checklist or the product behavior is the one that's wrong.
7. **Payment can precede check-in completion** — Credited while still Pending Investigation needs an explicit product rule.
8. **Grade B/C rates can't be configured**, even though those grades exist in the UCO config.
9. **Warehouse mobile app isn't usable** for workers registered as Web users.
10. **Partial driver assignment** can leave a schedule marked assigned while the itinerary isn't — the driver never sees an Accept option.

---

## 12. Replay checklist for a new team member

1. Confirm the tunnel URL loads the login page (not a Cloudflare 530).
2. Log into Admin and verify the Mumbai slot, Grade A rate, and WareOne all exist.
3. Confirm Active status for QA Supplier, Atul (or another Active driver), and the WH worker.
4. Create a **new** schedule (via supplier APK or admin bulk request) — **do not reuse IT-186**.
5. Build a new itinerary → Assign Atul → verify the itinerary itself shows **Driver Assigned**.
6. Driver: Accept → Start → scan a **new** JSON QR → enter 10 kg → complete documents → Arrive at WH.
7. Warehouse web: use **Check in Oil only** → scan → confirm.
8. If the scan fails with a `gradeIds` error or stays at 0 scanned — **stop and log the bug**. Do not attempt to work around it via Collect Oil.
9. If check-in succeeds, verify Supplier Payment and the final statuses.

### QR quick reference
```text
Required driver scan payload:
{"Code":"B-2609-3-00005"}

Sample PNG generated for QA:
reports/byufuel-drive/qr-B-2609-3-00005.png
```
Prefer QR codes generated from Admin's **Generate QR Codes** for anything official — the local PNG is only useful as a reference for the encoding format.

---

## 13. Artifact index (this repo)

| File | Contents |
|---|---|
| `reports/byufuel-drive/BYUFUEL-QA-E2E-HANDOFF.md` | This document |
| `reports/byufuel-drive/master-data-setup-report.json` | MDM/setup details + early issues |
| `reports/byufuel-drive/dummy-users-created.json` | Original dummy users |
| `reports/byufuel-drive/supplier-password-reset.json` | Supplier password reset record |
| `reports/byufuel-drive/whworker-password-reset.json` | WH worker password reset record |
| `reports/byufuel-drive/e2e-fresh-e2e-status.json` | IT-188 assignment status |
| `reports/byufuel-drive/wh-checkin-it188-report.json` | Warehouse check-in failure details |
| `reports/byufuel-drive/issues-review.csv` | Issues sheet export |
| `reports/byufuel-drive/doubt-review.csv` | Open questions sheet export |
| Google Sheet | Shared Issues & Doubts workbook |

---

## 14. Document control

| | |
|---|---|
| **Author context** | QA automation / staging E2E on Byufuel Centvis |
| **Last updated** | 23 Sep 2026 |
| **Primary fixture** | `SCH-000006623` · `IT-000001188` · `B-2609-3-00005` · Atul / WareOne |
| **Current portal** | `https://teams-instant-planning-miller.trycloudflare.com` |

**Next step:** once the warehouse check-in bug is fixed, retest from **Phase E** using a **new** schedule/itinerary (or a cleared IT-188, if the product allows it), then update §6–§8 with the payment results.
