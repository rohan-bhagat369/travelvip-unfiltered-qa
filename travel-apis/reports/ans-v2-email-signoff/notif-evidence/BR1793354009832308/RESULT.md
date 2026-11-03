# Fast Track — BR1793354009832308 (SMT · 2026-10-30)

**Partner chrome:** Travel VIP (SMT)  
**Page:** https://lambda-shop.travelvip.ai/fasttrack/booking-confirmation/BR1793354009832308  
**Page status:** Confirmed · CSX Huanghua T1 Domestic Departure · 20 Nov 2026 6:29 AM · Flight JIBKJON · Pass Id 8576711545040559 · Shailesh Gaikwad · Total ₹4,725.48 · `rohan@travelvip.ai` · +91 8010778440

| Channel | Result | Notes |
|---------|--------|--------|
| **User** | **NOT RCVD** | Inbox + Spam — no mail for BR |
| **Admin** | **NOT RCVD** | No `[DEV] Travel VIP \| Your Fast Track Booking Confirmed` BCC |
| **CS** | **PARTIAL** | CSV2 thread (3): Payment Initiated → Payment Successful → **Booking Submitted to Provider**. **No Confirmed stage mail** yet (~3:23 PM) |
| **Notif** | **NOT RCVD** | A015 (`ai.txv2.starter`) shade/dumpsys — no Fast Track / no `BR1793354009832308`. Device has Bus Confirmed `BB1793352327120871` etc. Evidence: `notif-shade.png`, `notif-dumpsys-raw.txt` |

**Gap:** Page shows **Confirmed**, but User/Admin Confirmed mails + CS Confirmed stage + push notif missing at check time.
