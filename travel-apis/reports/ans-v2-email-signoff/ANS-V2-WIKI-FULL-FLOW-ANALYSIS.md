# ANS V2 full flow — wiki analysis (reference)

**Source Mattermost:** https://team.scandid.in/scandid/pl/aezuzfh9w389unmu1dcd3fioth  
**Posted by:** Shailesh Gaikwad · 2026-10-28  
**Wiki:** https://wiki.scandid.in/books/email-notification-feature-notes/page/ans-v2-full-flow  
**Book:** Email Notification Feature Notes · Revision #4 · Author Shailesh Gaikwad  
**Captured for QA:** 2026-10-28 (BFL lambda-shop retest)

---

## What the Mattermost post is

Not an attachment — a **permalink to the Scandid Wiki page** *ANS V2 full flow*. That page is the technical design of **`notification.ActionNotificationSenderV2`**.

---

## Core model (one sentence)

One pass over a `user_actions` row can send: **customer email** + **admin BCC** + **app push** + **CS email**. It does **not** send Nexus dashboard notifications.

Shell: Java run ~60 min (`-runFor=60`) → wait 1s → restart.

---

## Pipeline (ordered)

1. **Load row** — created last 2 days · `email_json` present · `email_sent_at` empty · `status ≠ 2` · `status > -USER_EMAIL_MAX_ATTEMPTS` (3). Action must be user-email-allowed **or** in V2 CS list.
2. **Partner theme** — from Partner Environment metadata (`partner_name`, logo, header/subheader colours, support phone/emails). `email.conf` fills only empty metadata fields. Same theme for User + CS.
3. **Parse `email_json`** — invalid + user email required → fail user path; **CS not sent that pass**.
4. **`is_only_cs`** — if true: skip user / admin BCC / push; CS (+ MM with CS) only. If false/missing: user path + CS per rules; MM with **user** email only.
5. **User email** — if action in `common_allowed_action_names` and not CS-only. To = `customer.contact.email`. Success → `status=2`, `email_sent_at`. Fail → status −1/−2/−3 (retry next process start ~hourly).
6. **Admin** — **not a separate send**. BCC = `admin_emails` from `email.conf` (same list every partner). No user email ⇒ no admin copy.
7. **App push** — on user path, before email, if `noti_sent_at` empty. Firebase per partner. Sets `noti_sent_at` when all devices accept.
8. **CS email** — same pass after user decision if action in category `stageForActionV2` and `cs_email_status ≠ 2`. Template `cs.{action_id_type}V2`. Inbox: `CS_DEFAULT_EMAIL` → config → `email.conf` → prod `support@travelvip.ai` / else `devcs@travelvip.ai`. Success `cs_email_status=2`; fail `-1` only (no ladder).
9. **Mattermost** — if `createUserActionAlert` on. Channel: `{partnerName}-customer-success---dev` (dev) or `{partnerName}-customer-success` (else). Name from metadata `partner_name` (spaces stripped, lowercased).

**Critical retry rule:** If **user email succeeds**, row closes (`status=2`) even if **CS fails** — **CS is not retried alone** on next restart.

---

## User-email allow list (`common_allowed_action_names`)

`booking_request_submitted` · `booking_confirmed` · `cancellation_requested` · `cancelled` · `partially_cancelled`  

`payment_initiated` → **never** user email.

---

## Subject prefix (V2 only; V1 unchanged)

| Env | Rule |
|-----|------|
| **dev** | Always `[DEV]` · `test_emails` unused |
| Other / prod | `[TEST]` if To matches `test_emails` (domain `@x` or exact addr). Admin BCC does **not** trigger `[TEST]`. Fallback domains if list empty: `@scandid.in`, `@travelvip.ai` |

---

## V2 CS actions by category (wiki)

| Category | Actions |
|----------|---------|
| eSIM / Fast Track / Attractions | payment_initiated, payment_success, payment_failure, booking_submit_success, booking_confirmed, booking_failed, cancelled |
| **Flights** | booking_created, payment_*, booking_submit_success, booking_confirmed, cancellation_requested, cancelled, **booking_ticketed**, booking_refunded |
| **Hotels** | booking_created, payment_*, booking_request_submitted, booking_confirmed, booking_failed, cancellation_requested, cancelled, booking_refunded |
| Duty Free | booking_request_submitted, order_failed, payment_*, cancellation_requested, cancelled |
| Porter / M&G / Cabs / Lounge / Bus | booking_pending, booking_request_submitted, payment_*, booking_confirmed, booking_failed, cancelled |

---

## Config mapping (metadata wins over email.conf)

| email.conf | Partner metadata | Notes |
|------------|------------------|-------|
| partner_name / logo / colours | same keys | Theme |
| support_phone | support_contact_no | |
| support_email | support_emails | |
| — | **is_only_cs** | Metadata only |
| **admin_emails** | — | BCC; conf only |
| **common_allowed_action_names** | — | Conf only |
| **test_emails** | — | Conf only |
| max_retries | — | **Ignored**; use `USER_EMAIL_MAX_ATTEMPTS` |

Sample admin BCC includes `rohan@scandid.in` (matches our Admin inbox checks).

---

## Implications for BFL / lambda-shop QA (this week)

| Observation in retest | Explained by wiki? |
|----------------------|--------------------|
| User + Admin get **same** Confirmed subject/body | Yes — Admin is **BCC** on user mail, not a separate template |
| CS is CSV2 multi-stage thread (Created → Payment → Confirmed / Ticketed) | Yes — Hotels/Flights have many CS-only actions in `stageForActionV2` |
| CS create stage Conf No N/A; confirm has SNHAPI… | Expected — different action rows / stages |
| `[DEV]` on subjects | Dev prefix rule |
| Partner chrome “Bajaj Finserve” | Partner env metadata theme |
| Guest count wrong in User mail vs page | **Not covered** here — payload/template mapping lives in sibling wiki pages (*ANS V2 Payloads*) |
| Delivery PASS ≠ full content parity | Doc defines **send path**, not field-level email content QA |

---

## Sibling pages in same wiki book (for deeper content QA)

- Email Notification Feature Findings  
- User Action Table Description…  
- Action Notification Sender / New / ANS-New Architecture  
- Enhancing ANSV2  
- **ANS V2 Payloads** · **ANS V2 Payloads (Frontend)** ← use these for guest/room field bugs  

---

## Same-pass example (`booking_confirmed`, not CS-only)

1. App push (if `noti_sent_at` empty)  
2. User email + admin BCC  
3. Mattermost (user-email alert)  
4. CS email to shared CS inbox  

If user OK and CS fails → row done; CS not re-queued alone.

---

## Alignment: existing QA results vs this wiki

### A) Oct 22 TravelVIP Dev sign-off (`ANS-V2-EMAIL-SIGNOFF.md`)

| What we tested | Wiki expectation | Aligned? |
|----------------|------------------|----------|
| User + Admin + CS + Notif on **Confirmed / Submitted / Cancel*** | User allow-list + CS `stageForActionV2` + push on user path | **Yes** |
| Admin received same Confirmed as User | Admin = **BCC** of user mail | **Yes** (method matches; we called it “Admin email”) |
| First bugs = null `email_json` → no user/admin | Loader requires `email_json`; invalid JSON blocks CS that pass | **Yes** — root cause matches doc |
| Duty Free **Confirmed** CS not sent → sheet **EXPECT** | Duty Free CS list has **no** `booking_confirmed` | **Yes** — EXPECT is correct per wiki |
| Attraction / FT / Flight V2 / Lounge HAK fixed then PASS | Confirm needs `email_json` + allow-list action | **Yes** |
| ENG-555 Nexus manual CS **out of scope** | V2 **does not** send Nexus dashboard notifications | **Yes** |
| Cabs / Bag Assure NOT TESTED | Cabs in CS list but UI blocked; Bag Assure N/A | **OK** (blocked, not contradicted) |
| Concierge CS “Not Required” closed | Concierge not in the V2 CS category table on this page | Soft — sheet closed; wiki silent |
| Content bugs (phone IT, refund 0, Dragon Pass) | Flow doc ≠ payload/content contract | Soft — use Payloads wiki |

**Sign-off verdict vs doc:** Delivery matrix **aligned**. Duty Free Confirmed CS skip **validated by wiki**. ENG-555 exclusion **validated**.

### B) Oct 28 BFL retest (`ANS-V2-BFL-EMAIL-DUMP` · 4 bookings)

| Booking | Action we checked | Wiki | Result vs doc |
|---------|-------------------|------|---------------|
| FB…4118 Flight OW | User Confirmed + Admin + CS→Ticketed | `booking_confirmed` user · flights CS includes **ticketed** · `[DEV]` · partner theme | **Aligned PASS** |
| FB…0082 Flight RT | Same | Same | **Aligned PASS** (content soft ≠ flow) |
| Hotel …1623 | User Confirmed + Admin + CS→Confirmed | Hotels CS has create + confirmed | **Aligned PASS** (Conf No N/A on create = expected stage) |
| Hotel …0533 | Same + room/guest content | Flow OK; guest count = payload/template | **Flow aligned** · content soft |

### C) What the wiki says we did **not** need to fail on

- CS create-stage Conf No **N/A** while confirm has SNHAPI… → **expected multi-action**, not a send FAIL  
- User/Admin identical bodies → **expected BCC**  
- Multi-stage CSV2 (Created → Payment → Ticketed/Confirmed) → **expected** CS action list  

### D) Gaps (doc covers; we have not proven yet on BFL)

| Gap | Notes |
|-----|--------|
| Remaining BFL categories | Duty Free, Porter, FT, Lounge… still PENDING on 28 Oct retest (covered historically on TravelVIP 22 Oct) |
| `is_only_cs` partner | Not exercised |
| Negative: `payment_initiated` must **not** user-mail | Not explicit TC |
| User OK / CS fail → no CS-only retry | Not proven |
| Mattermost `{partner}-customer-success---dev` | Not checked this BFL session |
| App push / `noti_sent_at` | Oct 22 Yes; BFL dump Notif column mostly `—` |

### Bottom line

| Pack | Aligned with wiki flow? |
|------|-------------------------|
| **Oct 22 TravelVIP sign-off** | **Yes** — channels + actions + EXPECT Duty Free CS + ENG-555 OOS |
| **Oct 28 BFL Flight+Hotel Confirmed** | **Yes** — User/Admin BCC/CS stages/`[DEV]`/theme |
| Soft content notes (guests, RT return, pax) | **Outside** this flow doc — do not flip delivery to FAIL |
