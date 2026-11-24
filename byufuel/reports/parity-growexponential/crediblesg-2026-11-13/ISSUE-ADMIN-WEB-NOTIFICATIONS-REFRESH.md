# BUG — Admin web notifications do not update live after enabling web notifications

| | |
|--|--|
| **ID** | UI-NOTIF-01 |
| **Verdict** | **BUG** |
| **Severity** | **Medium** (ops miss pickup/drop alerts until manual refresh) |
| **Module** | Admin Web → header **Notifications** (bell) · web notifications enabled |
| **When** | 2026-11-18 |
| **Surface** | Admin web (Grow `uat-byufuel.crediblesg.com`) |

## Summary

After enabling **web notifications** on Admin web, new **pickup** and **drop** notifications are **not received / not shown in real time**. The notification list (and badge) only updates after a **full page refresh**.

## Environments

| Env | URL |
|-----|-----|
| **Grow (reported)** | `https://uat-byufuel.crediblesg.com` |

Admin: Amaan Khan (`amaan@crediblesg.com`).

## Steps to reproduce

1. Login Admin on Grow.
2. Enable **web notifications** (browser / in-app notification permission as prompted).
3. Keep the Admin web session open (any screen; do not refresh).
4. Trigger a **pickup** or **drop** event that should create an Admin notification.
5. Observe the header **Notifications** bell / list **without** refreshing.
6. Refresh the page and open Notifications again.

## Expected

- With web notifications enabled, Admin receives / sees **pickup** and **drop** notifications **live** (toast and/or bell badge + list update) without refreshing the page.

## Actual

- No live update while the session stays open.
- Recent pickup/drop notifications appear only after **manual refresh** of the screen.

## Impact

- Admin must keep refreshing to monitor pickup/drop activity.
- Easy to miss time-sensitive schedule / itinerary alerts during live ops.

## Evidence

| Item | Status |
|------|--------|
| Steps above | Reported 2026-11-18 |
| Screenshots / recording | TBD (attach bell before refresh vs after refresh) |

## Suggested fix

- Ensure Admin web keeps an active channel (websocket / SSE / push) for notification events after permission is granted.
- Update bell badge + notification list (and optional toast) on receive without requiring page reload.
- Confirm pickup and drop event types are subscribed on Grow Admin web.

## Tracker paste (short)

**Title:** [Grow Admin] Web notifications enabled but pickup/drop alerts need page refresh  

**Body:**  
Admin web — after enabling web notifications, recent pickup and drop notifications do not appear live. Bell/list only updates after refreshing the screen. BUG UI-NOTIF-01. Env: `https://uat-byufuel.crediblesg.com`. Admin: amaan@crediblesg.com.
