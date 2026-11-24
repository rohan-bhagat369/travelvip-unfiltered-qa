# Tracker — Collect Oil / Drop notification + payment gaps (2026-11-19)

ENG Triage · Project **ByuFuel** · Assignee **Mayur More** · Priority **High**  
Env: `https://uat-byufuel.crediblesg.com` · WH Worker Mayur More · Admin `amaan@crediblesg.com`

## Issue 1 — WH not notified when Admin approves Supplier Drop

**Title:** `[Grow] WH Worker not notified after Admin approves Supplier Drop (expected Scheduled Drop Approved)`

**ID:** WH-NOTIF-DROP-01 · BUG · High

**Summary:** After Admin approves a Supplier **Drop** request, the respective WH Worker does not receive a notification. Expected something like **Scheduled Drop Approved**.

**Steps:**
1. Login Supplier APK on Grow UAT → create / submit a **Drop** (warehouse drop) schedule for a WH in scope (e.g. Kalika).
2. Login Admin web → approve that Drop schedule.
3. Login as the **WH Worker** assigned to that warehouse (e.g. Mayur More / `mayurmwh1@byufuel.in`).
4. Check WH web **Notifications** (bell / list) and any email/push if enabled — **without** requiring a full page hunt for the schedule list only.

**Expected:** WH Worker receives a notification that the Drop was approved (e.g. **Scheduled Drop Approved** / equivalent), for that schedule.

**Actual:** No notification received by the respective WH Worker after Admin approval.

**Env:** Grow `https://uat-byufuel.crediblesg.com`

---

## Issue 2 — No notification to Supplier + Admin after Collect Oil complete

**Title:** `[Grow] No notification to Supplier and Admin after WH completes Collect Oil From Supplier`

**ID:** WH-NOTIF-COLLECT-01 · BUG · High

**Summary:** After WH completes **Collect Oil From Supplier** (collection complete), Supplier and Admin do not receive notifications of the activity.

**Steps:**
1. Have an approved Drop / Collect Oil eligible schedule for a supplier.
2. Login WH Worker → **Collect Oil From Supplier** → open the schedule → Scan / Check-in → complete collection (incl. documentation if required on this path).
3. Keep **Supplier** session (APK notifications) and **Admin** web notifications available.
4. Observe notification trays / bell lists for both roles after collection completes.

**Expected:** Supplier and Admin each receive a notification that oil collection from supplier was completed (for that SCH).

**Actual:** No notification received by Supplier or Admin after completing collection.

**Env:** Grow UAT Collect Oil From Supplier path.

---

## Issue 3 — No Supplier Payment entry + missing downstream notifications after Collect Oil

**Title:** `[Grow] After Collect Oil complete — no Supplier Payment entry and no activity notifications to respective users`

**ID:** WH-PAY-COLLECT-01 · BUG · High

**Summary:** After WH finishes collecting oil from supplier, Admin **Supplier Payment** does not get a payable entry for that supplier/schedule. Related activity notifications also do not go out to the respective users (Admin / Supplier / WH as applicable).

**Steps:**
1. Complete **Collect Oil From Supplier** for a schedule (same path as Issue 2) through Check-in / documentation complete.
2. Login Admin → **Supplier Payment** → search / filter for that supplier and schedule (SCH).
3. Confirm whether a **Created / Verified / payable** row appears for payment.
4. Check notifications for Admin, Supplier, and WH for payment-created / collection-completed style events.

**Expected:**
- A Supplier Payment entry is created so Admin can pay the supplier for the collected oil.
- Notifications for these activities are sent to the respective users.

**Actual:**
- No entry created in Supplier Payment for that collection.
- Notifications for these activities are not received by the respective users.

**Env:** Grow Admin `/byu/supplier-payment` + Collect Oil completion.

---

## Issue 4 — Documentation missing in DROP / Collect Oil flow

**Title:** `[Grow] Documentation missing in DROP / Collect Oil From Supplier flow after collecting oil`

**ID:** WH-DOC-DROP-01 · BUG · High

**Summary:** After collecting oil from supplier on the Drop → Collect Oil From Supplier path, Documentation / Generate Documentation is missing so WH cannot complete documentation for that schedule.

**Steps:**
1. Supplier APK → create/submit a Drop schedule; Admin approves it.
2. WH Worker → Collect Oil From Supplier → open approved Drop schedule.
3. Complete Scan / Check-in and oil collection from supplier.
4. Look for Documentation / Generate Documentation after collection.

**Expected:** WH can generate / complete Documentation after collecting oil on the Drop flow.

**Actual:** Documentation step missing after collecting oil from supplier on Drop flow.

**Env:** Grow UAT Collect Oil From Supplier (Drop path).

---

## Tracker keys (created 2026-11-19)

| # | Key | Title short | Link |
|---|-----|-------------|------|
| 1 | **ENG-828** | WH notif on Drop approved | https://tracker.travelvip.ai/tasks/ENG-828 |
| 2 | **ENG-829** | Supplier+Admin notif after Collect Oil complete | https://tracker.travelvip.ai/tasks/ENG-829 |
| 3 | **ENG-830** | Supplier Payment missing + activity notifs after Collect Oil | https://tracker.travelvip.ai/tasks/ENG-830 |
| 4 | **ENG-831** | Documentation missing in DROP / Collect Oil after collection | https://tracker.travelvip.ai/tasks/ENG-831 |

All four: ENG Triage · Project **ByuFuel** · Assignee **Mayur More** · Priority **High**
