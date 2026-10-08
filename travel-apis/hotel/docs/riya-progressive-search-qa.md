# Riya Progressive Search — QA Brief

**Environment:** pre-production only  ·  **Affects:** Riya hotels only  ·  **Rollback:** config flag, no deploy
**Date:** 8 September 2026  ·  **Engineering detail:** `docs/hotels/riya-progressive-srp-handover.md`

Riya hotel search now shows a first page of real, priced hotels at around 8–11 seconds instead of making the customer wait ~22 seconds for the whole city. Below is what changed and the cases we would like covered. **Add your own freely** — these are the ones we already know are worth checking.

---

## What changed, in one paragraph

A Riya search used to make one big request that priced an entire city, and the customer saw a blank screen for 15–25 seconds of it. Now each search fires **two requests at once**: a small fast one for about 25 hotels that comes back in ~8 seconds, and the full city one that still takes ~22 seconds. The page shows the fast results first and fills in the rest when the full result lands.

So the visible change is: **results appear early, and then more results appear.** The order can shift as the full set arrives. That is expected, not a bug.

Nothing about TBO or RateHawk hotels changed, and nothing about Riya changes when the feature is switched off.

---

## Before you start — three rules that decide whether the test means anything

**Rule 1 — use a fresh city and dates every single time.**
Results are cached for 30 minutes. Repeat the same search and it comes back in under a second whether the feature works or not, so it tells us nothing. Change the city, the dates, or the number of guests between every test.

**Rule 2 — complete a real booking, do not just search.**
The most serious class of bug here ends at the booking step, not on the results page: a hotel shows with a price, then fails when you try to book it. Searching alone cannot find that. Please book through at least a few times.

**Rule 3 — note anything that appears and then vanishes.**
A hotel visible on the first results page that is gone a moment later, or a result count that goes down, is worth reporting even if everything else looks fine. It is the shape of the one issue we knowingly left open.

---

## Group A — Core behaviour

The feature doing its job. Every case here uses a fresh city and dates.

### - [ ] A1 · Results appear early, then more arrive — **MUST PASS**

**Steps**
1. Search a large city (Delhi, Mumbai, Dubai) with dates ~30 days out.
2. Watch the results area from the moment you hit search.

**Expect** — A page of real hotels with real prices within roughly 8–14 seconds. More hotels and more pages become available shortly after.

**Why** — This is the entire point of the change. If the first results still take ~22 seconds, the feature is not working.

### - [ ] A2 · Paging through to the end — **MUST PASS**

**Steps**
1. Run a large-city search and page forward through several pages.
2. Keep going until there are no more pages.

**Expect** — Paging never gets stuck, never loops, and reaching the end feels normal. No page is blank.

**Why** — The app decides whether to ask for more based on a flag we changed. Getting it wrong means either the results stop too early or the app keeps asking forever.

### - [ ] A3 · Hotel detail opens correctly from an early result — **MUST PASS**

**Steps**
1. Search, and click a hotel *as soon as* the first results appear — do not wait for the full list.
2. Check the name, photos, star rating and price against the search card.

**Expect** — The detail page opens, and the details match the card you clicked.

**Why** — Early results come from a different request than the full list. A hotel opened from an early card is the case most likely to mismatch.

### - [ ] A4 · Book end to end from an early result — **MUST PASS** ⭐ highest value

**Steps**
1. Search, click a hotel from the *first* batch of results.
2. Go all the way through to booking confirmation.
3. Repeat two or three times with different cities.

**Expect** — Booking completes, and the price at booking matches the price shown in search.

**Why** — The highest-value case in this brief. Hotels shown early are priced by a separate request, and a mismatch or failure here is the worst outcome the change could produce.

---

## Group B — Bugs we found and fixed, please confirm

Each of these was a real defect during development. They should all behave correctly now.

### - [ ] B1 · A filter that matches nothing early must not end the search — **MUST PASS**

**Steps**
1. Search a large city with fresh dates.
2. As soon as the first results appear, apply a narrow price filter — a band well below or above what is on screen.
3. Wait 20–30 seconds without touching anything.

**Expect** — Either matching hotels appear as the full result arrives, or a normal "no hotels match" message *after* the search finishes. It must **not** show "no hotels found" immediately and then stay empty while results were still coming.

**Why** — Previously this told the app the search was over while thousands of hotels were still on their way. The customer saw zero results for a city with 2,600 available hotels.

### - [ ] B2 · A hotel shown in results is genuinely bookable — **MUST PASS**

**Steps**
1. Search, and note two or three hotels from the *first* results.
2. Wait for the full result set to finish loading.
3. Check whether those hotels are still listed, then try booking one.

**Expect** — Any hotel still shown can be booked. A hotel that has genuinely sold out should disappear from the list rather than stay bookable-looking.

**Why** — Early results are a snapshot from seconds earlier. Previously a hotel that sold out in between stayed on the page, priced and clickable, and failed only at booking.

### - [ ] B3 · A city with no availability says so honestly — **SHOULD PASS**

**Steps**
1. Search somewhere with little or no inventory, or dates far out / fully booked.

**Expect** — A clear "no hotels" message. Not a short list of two or three hotels presented as if it were the whole city.

**Why** — If the main request fails, the fast one may have already found a handful of hotels. Showing those as the complete result was misleading; the search should fail honestly instead.

### - [ ] B4 · The same search in two tabs at once — **SHOULD PASS**

**Steps**
1. Open two tabs. Set up the identical search — same city, dates and guests — in both.
2. Hit search in both within a second or two of each other.
3. Let both finish and compare.

**Expect** — Both tabs end up with a full set of results. Neither ends up empty or noticeably short.

**Why** — Two identical searches share internal state. This has already caused two separate bugs, and one narrow case remains open — see the last section.

---

## Group C — Regression, things that must be unaffected

The change touched some code shared by all hotel providers. We traced it and believe nothing else is affected, but this is worth a pass.

### - [ ] C1 · TBO and RateHawk hotel search — **MUST PASS**

**Steps**
1. Run normal searches against partners served by TBO and by RateHawk.
2. Search, filter, page, open detail, and book.

**Expect** — Exactly the behaviour and speed you saw before this change. Nothing new, nothing slower.

**Why** — Two of the fixes edited code every provider runs. It is scoped to Riya, but a shared file is a shared risk.

### - [ ] C2 · Riya with the feature switched off — **SHOULD PASS**

**Steps**
1. Ask the dev team to set the flag back to off.
2. Repeat A1–A4 for Riya.

**Expect** — Old behaviour exactly: one slow wait of 15–25 seconds, then the full result. No early page.

**Why** — Off is our rollback. It has to be genuinely identical to before, because it is what we would fall back to in a hurry.

---

## Group D — Known weak spots, tell us how bad they are

We already know about these. We are not asking whether they happen, but whether they are bad enough to block. **Please note what you see rather than raising them as new bugs.**

### - [ ] D1 · Small cities may be slower, not faster — *known*

**Steps**
1. Search a small destination — somewhere with fewer than about ten hotels.
2. Time how long until the first results appear.

**Expect** — It may take longer than a big city, possibly longer than before the change. Note the destination and the rough time.

**Why** — The early-results rule needs a minimum number of hotels before it will show anything, so a small city can end up waiting for both requests.

### - [ ] D2 · Branded hotels may be missing from the first page — *known*

**Steps**
1. Search a city you would expect to have recognisable chains (Taj, Marriott, Novotel).
2. Note which hotels are on the first results, then compare after the full list loads.

**Expect** — Some well-known hotels may only show up in the later results. Note whether the early page looks noticeably worse than the final one.

**Why** — Chain and brand information comes from a second data source the early selection does not read yet, so those hotels cannot be picked early.

### - [ ] D3 · Results reorder as more arrive — *known*

**Steps**
1. Search a large city and watch the first results, then watch again after the full set lands.

**Expect** — The order changes. This is unavoidable in any progressive design and RateHawk already behaves this way. Tell us if it feels *jarring* rather than merely different.

**Why** — Ranking runs over whatever has arrived, so a better hotel appearing later moves up.

---

## Reporting — what to send back

For anything that fails, the single most useful thing is the **correlation id** from the request, plus the exact search. With those we can find the search in the logs in seconds; without them, often not at all.

| Include | Why it helps |
|---|---|
| Case id | A1, B2 and so on — or "own test" |
| Correlation id | Finds the exact search in the logs |
| City, dates, guests | Lets us reproduce it |
| Rough timestamp | Narrows the log window |
| Time to first result | Even approximate is useful — it is the number the change exists to move |
| Screen recording | Invaluable for anything about timing or ordering |

### One open issue — please do report it if you see it

If two identical searches run at the same moment and one of them fails, the other can lose its results. We know about it, we judged it narrow, and we left it open deliberately. If you hit it in normal testing rather than by deliberately racing two tabs, that changes our assessment — so please flag it.

---

## Results summary

| Case | Result | Notes |
|---|---|---|
| A1 Results appear early | | |
| A2 Paging to the end | | |
| A3 Detail from early result | | |
| A4 Book from early result | | |
| B1 Filter matching nothing | | |
| B2 Shown hotel is bookable | | |
| B3 No availability is honest | | |
| B4 Same search, two tabs | | |
| C1 TBO / RateHawk | | |
| C2 Riya with flag off | | |
| D1 Small cities | | |
| D2 Branded hotels early | | |
| D3 Reordering | | |
