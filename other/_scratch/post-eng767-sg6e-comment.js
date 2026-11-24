/**
 * One-shot helper: print the ENG-767 SG+6E comment body (for CDP paste).
 */
const body = `@Mayur More

Follow-up — mixed-airline seatmap retest (SG + 6E).

PASS — seats returned for both onward and return.

Env: preprod-api.travelvip.ai · no book
Search: DEL↔BOM RT · 26→28 Nov
Combination: SpiceJet (SG) onward + IndiGo (6E) return (connecting)

Seatmap:
- requestStatus=Completed
- data.segments = 3 (ONWARD + both RETURN hops)

Segments:
1. ONWARD · DEL→BOM · SG 671 · legNumber 1 · direction ONWARD · seatmap present (~1A–32F)
2. RETURN · BOM→AMD · 6E 632 · legNumber 2 · direction RETURN · seatmap present (~1A–31F)
3. RETURN · AMD→DEL · 6E 983 · legNumber 2 · direction RETURN · seatmap present (~1A–39F)

Unlike SG+9I (onward-only) and same-airline 6E SME+NORMAL (return-only / onward missing), this SG+6E mixed-airline RT merge returns seats for both journeys. Looks working for this combination.`;

console.log(body);
console.log("---LEN---", body.length);
