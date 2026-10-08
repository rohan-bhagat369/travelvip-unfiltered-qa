# Riya Result Ordering — Test Plan

> Riya hotel results used to appear in whatever order the supplier sent. They are now ordered by rules
> we have configured. Nothing else about search, filters, hotel pages or booking has changed — and most
> of this plan is confirming exactly that.
>
> **Live on pre-production. Nothing to set up: no settings to change, no database work. Just search.**

---

## One thing that will confuse you

Search results are **cached for 30 minutes**. Repeating the same city with the same dates returns the
stored answer — correct behaviour, but you are not seeing a fresh search. **When you want a fresh one,
change the dates.**

---

## What the rules say

Hotels are placed into groups, in this order. A hotel must match **every** condition in a group to join
it, and it joins the first group it matches.

| Group | Conditions |
|---|---|
| **1** | Within **5 km** of the city centre, **4 or 5 star**, and one of: **Taj, Marriott, Hyatt, Hilton, IHG, Accor** |
| **2** | Within **10 km**, and **4 or 5 star** |
| **3** | Within **15 km**, and one of: **FabHotels, Treebo, Lemon Tree, Royal Orchid** |
| **rest** | All remaining hotels, in the order they arrive |

Inside each group, hotels are ordered by **distance first, then star rating, then chain**.

### So in practice

- **Page one** should be recognisable premium hotels — Taj, Marriott, Hyatt, Hilton, IHG or Accor — at
  4 or 5 stars, close to the centre.
- **After those**, other 4 and 5 star hotels regardless of brand.
- **Then** the budget chains — FabHotel, Treebo, Lemon Tree, Royal Orchid.
- **The last pages** should hold unrated properties, 1 and 2 star hotels, and independents with no chain.

Every hotel is still there. Being unrated pushes a hotel down; it never removes it.

---

## Must pass — nothing is lost or broken

This is the important group. The change should affect the order and nothing else.

### 1. Page one looks deliberate — BLOCKER

**Do:** Search several different cities — a large metro, a mid-size city, a small town. Look at page one
each time.

**Expect:** Page one is mostly 4 and 5 star hotels, with the premium brands above. You should **not**
see unrated or 1-star hotels near the top, and not a random mix.

**Report:** If page one looks wrong for a city, note the city and dates and screenshot the first ten
results.

### 2. The result count has not changed — BLOCKER

**Do:** Search a city and note the total number of hotels shown. Compare against what the same city
returned before this change, or against production.

**Expect:** The same total. This change reorders results; it must never add or remove a hotel.

### 3. Paging shows every hotel exactly once — BLOCKER

**Do:** Page through a full city result set to the last page.

**Expect:** No hotel appears twice. No hotel disappears. Page two continues from where page one stopped
rather than starting over. The last page is correctly the last.

**Why:** This is the most likely way an ordering change breaks. Please page all the way to the end on at
least two cities.

### 4. Sorting by price still works properly — BLOCKER

**Do:** Search a city, then choose *Price low to high*. Then *Price high to low*.

**Expect:** Strictly cheapest first, then dearest first. The new rules must have **no** influence — a
cheap unrated hotel should sit above an expensive 5-star when sorting by price ascending.

**Why:** The customer's own choice must always win over our default order. If price sort still shows
premium hotels first, that is a bug.

### 5. Filters work, and the counts stay put — BLOCKER

**Do:** Apply each filter on its own — star rating, chain, brand, property type, GST claimable. Then two
together, for example 4–5 star plus a chain.

**Expect:** Only matching hotels remain, ordered by the rules. The number shown next to each filter
option should **not** change when you tick a filter — picking "Apartment" must not drop the other
property types to zero.

### 6. Hotel pages and booking are unchanged — BLOCKER

**Do:** Open hotels from the results, check rooms, prices, amenities and cancellation terms. Complete at
least one booking to confirmation.

**Expect:** No change of any kind. The new ordering applies only to the results list.

---

## The order itself

### 7. A premium-brand 4-star beats a 5-star that is further out — HIGH

**Do:** In a large city, find a 4-star Marriott, Taj, Hyatt, Hilton, IHG or Accor near the centre. Then
find a 5-star from a different brand further out.

**Expect:** The 4-star appears first. Group 1 outranks group 2 whatever the star rating.

**Note:** This looks wrong at a glance, and it is intended. Group membership matters more than stars.

### 8. A premium brand that is only 3-star does not get group 1 — HIGH

**Do:** Find a hotel from one of the six premium chains that is rated 3 star or lower, or one that is far
from the centre.

**Expect:** It is **not** at the top. A hotel must satisfy distance *and* stars *and* brand together —
two out of three is not enough.

### 9. Unrated hotels are last but still present — HIGH

**Do:** Page to the end of a large city's results.

**Expect:** Unrated properties and independents with no brand appear near the bottom — and they **do
appear**. If a hotel you expect is missing entirely, that is a bug worth reporting.

### 10. Budget chains sit above unbranded hotels — NORMAL

**Do:** Look for FabHotel, Treebo, Lemon Tree or Royal Orchid properties in an Indian city.

**Expect:** They appear after the 4 and 5 star hotels, but before unbranded and unrated properties.

---

## Edges

### 11. A city with very few hotels — NORMAL

**Do:** Search a small town returning one page or fewer.
**Expect:** Results render normally. A single hotel and a single page both work.

### 12. A search with nothing available — NORMAL

**Do:** Search a city or date range with no availability — try dates far in the future.
**Expect:** The normal "no results" message. No error page, no blank screen.

### 13. Repeating a search gives the same order — NORMAL

**Do:** Search a city, then repeat it immediately with the same dates.
**Expect:** The same order, and a noticeably faster response.

**Please record:** roughly how long each of the two searches took. We have no measurement of a repeated
search yet, so this genuinely fills a gap.

### 14. Changing dates gives a fresh search — NORMAL

**Do:** Search a city, then change only the dates and search again.
**Expect:** Results are ordered by the same rules. Prices and availability may differ; the ordering
logic should not.

---

## Not this change — three things you will probably notice

Not caused by the new ordering. Worth reporting, but as separate issues.

**Some searches take 15 to 25 seconds.** That is Riya's own response time — measured as 99.7% of the
wait. Expected on a first search for a city and dates; a repeat within 30 minutes is fast. **Please do
flag any search that takes more than 30 seconds or fails**, since that is where it stops being slow and
starts being broken.

**Some cities return fewer hotels than you would expect.** Hotels that Riya prices but does not describe
have no name or image, so they cannot be shown. This can be up to a third of a city and predates this
change. Note the city if it looks unusually thin.

**Meal and room labels.** The same release also carried a change to how meal types are read. Unrelated
to ordering, but worth a look while you are in there.

---

## What to include in a bug

- **City and exact dates** — without these we cannot reproduce it, and the 30-minute cache means old
  dates may behave differently.
- **A screenshot of the first ten results**, or the last ten if the problem is at the end.
- **The time you searched**, so we can find the matching log line.
- **Whether a filter or sort was active**, and which.

---

14 cases. No configuration or database changes are needed to run this plan.

Technical detail: `docs/hotels/riya-srp-ranking-design.md`
