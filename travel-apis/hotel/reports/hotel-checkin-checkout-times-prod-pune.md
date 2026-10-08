# Prod hotel check-in / check-out times (details + prebook)

- Base: `https://api.travelvip.ai`
- Cities: **India**
- Stay: **2026-10-15 → 2026-10-16** (1 night)
- Flow: CITY search → HOTEL details → prebook. **No book / no finalize.**
- Hotels checked: **10**

## Score

| API | Calls OK | Both times present | Times null / empty / missing |
|-----|----------|--------------------|------------------------------|
| Details | 10 | **2** | **8** |
| Prebook | 10 | **5** | **5** |

## Per city

| City | Hotels | Details both times | Details null | Prebook both times | Prebook null | Prebook fail |
|------|--------|--------------------|--------------|--------------------|--------------|--------------|
| Pune | 10 | 2 | 8 | 5 | 5 | 0 |

## Hotels

| # | City | Hotel | Details checkInTime | Details checkOutTime | Prebook checkInTime | Prebook checkOutTime | Note |
|---|------|-------|---------------------|----------------------|---------------------|----------------------|------|
| 1 | Pune | Sheraton Grand Pune Bund Garden Hotel | _missing_ | _missing_ | 2:00 PM | 12:00 PM |  |
| 2 | Pune | JW Marriott Hotel Pune | _missing_ | _missing_ | 3:00 PM | 12:00 PM |  |
| 3 | Pune | Crowne Plaza Pune City Centre | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 4 | Pune | Blue Diamond, Pune - IHCL SeleQtions | 2:00 PM | 12:00 PM | _missing_ | _missing_ |  |
| 5 | Pune | Conrad Pune | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 6 | Pune | E SQUARE THE FERN PUNE | 2:00 PM | 12:00 PM | 2:00 PM | 12:00 PM |  |
| 7 | Pune | The Pride Pune | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 8 | Pune | Tarawade Clarks Inn | _missing_ | _missing_ | 2:00 PM | 12:00 PM |  |
| 9 | Pune | Best Western The Pride | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 10 | Pune | Enrise By Sayaji Pune | _missing_ | _missing_ | 12:00 PM | 10:00 AM |  |