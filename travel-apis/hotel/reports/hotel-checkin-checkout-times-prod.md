# Prod hotel check-in / check-out times (details + prebook)

- Base: `https://api.travelvip.ai`
- Stay: **2026-10-15 → 2026-10-16** (1 night)
- Flow: CITY search → HOTEL details → prebook. **No book / no finalize.**
- Hotels checked: **40**

## Score

| API | Calls OK | Both times present | Times null / empty / missing |
|-----|----------|--------------------|------------------------------|
| Details | 40 | **1** | **39** |
| Prebook | 40 | **17** | **23** |

## Per city

| City | Hotels | Details both times | Details null | Prebook both times | Prebook null | Prebook fail |
|------|--------|--------------------|--------------|--------------------|--------------|--------------|
| Mumbai | 10 | 0 | 10 | 3 | 7 | 0 |
| Delhi | 10 | 0 | 10 | 5 | 5 | 0 |
| Bengaluru | 10 | 1 | 9 | 3 | 7 | 0 |
| Hyderabad | 10 | 0 | 10 | 6 | 4 | 0 |
| Pune | 0 | 0 | 0 | 0 | 0 | 0 |

## Hotels

| # | City | Hotel | Details checkInTime | Details checkOutTime | Prebook checkInTime | Prebook checkOutTime | Note |
|---|------|-------|---------------------|----------------------|---------------------|----------------------|------|
| 1 | Mumbai | Sofitel Mumbai BKC Hotel | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 2 | Mumbai | Ibis Mumbai Bkc | _missing_ | _missing_ | 2:00 PM | 12:00 PM |  |
| 3 | Mumbai | ITC Maratha Mumbai, a Luxury Collection Hotel, Mumbai | _missing_ | _missing_ | 3:00 PM | 12:00 PM |  |
| 4 | Mumbai | Courtyard by Marriott Mumbai International Airport | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 5 | Mumbai | Grand Hyatt Mumbai Hotel & Residences | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 6 | Mumbai | Taj The Trees, Mumbai | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 7 | Mumbai | Hyatt Centric Juhu Mumbai | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 8 | Mumbai | JW Marriott Mumbai Sahar | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 9 | Mumbai | Fairmont Mumbai | _missing_ | _missing_ | 3:00 PM | 12:00 PM |  |
| 10 | Mumbai | Taj Santacruz | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 11 | Delhi | Le Meridien New Delhi | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 12 | Delhi | Taj Mahal, New Delhi | _missing_ | _missing_ | 14:00:00 | 12:00:00 |  |
| 13 | Delhi | Taj Palace, New Delhi | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 14 | Delhi | ITC Maurya, a Luxury Collection Hotel, New Delhi | _missing_ | _missing_ | 3:00 PM | 12:00 PM |  |
| 15 | Delhi | Novotel New Delhi City Centre | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 16 | Delhi | The Connaught, New Delhi - IHCL SeleQtions | _missing_ | _missing_ | 2:00 PM | 12:00 PM |  |
| 17 | Delhi | Shangri-La Eros, New Delhi | _missing_ | _missing_ | 14:00:00 | 12:00:00 |  |
| 18 | Delhi | The Imperial New Delhi | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 19 | Delhi | The Park New Delhi | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 20 | Delhi | The Metropolitan Hotel and Spa New Delhi | _missing_ | _missing_ | 12:00 PM | 12:00 PM |  |
| 21 | Bengaluru | Taj West End | _missing_ | _missing_ | 2:00 PM | 12:00 PM |  |
| 22 | Bengaluru | The Ritz-Carlton, Bangalore | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 23 | Bengaluru | ITC Gardenia, a Luxury Collection Hotel, Bengaluru | _missing_ | _missing_ | 12:00 PM | 12:00 PM |  |
| 24 | Bengaluru | Marriott Executive Apartments Bengaluru UB City | 3:00 PM | 12:00 PM | _missing_ | _missing_ |  |
| 25 | Bengaluru | JW Marriott Hotel Bengaluru | _missing_ | _missing_ | 3:00 PM | 12:00 PM |  |
| 26 | Bengaluru | Vivanta Bengaluru Residency Road | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 27 | Bengaluru | Holiday Inn Bengaluru Racecourse by IHG | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 28 | Bengaluru | ibis Bengaluru City Centre Hotel | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 29 | Bengaluru | ITC Windsor, A Luxury Collection Hotel, Bengaluru | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 30 | Bengaluru | Conrad Bengaluru | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 31 | Hyderabad | Hyderabad Marriott Hotel & Convention Centre | _missing_ | _missing_ | 3:00 PM | 12:00 PM |  |
| 32 | Hyderabad | Hyatt Place Hyderabad Banjara Hills | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 33 | Hyderabad | Courtyard by Marriott Hyderabad | _missing_ | _missing_ | 2:00 PM | 12:00 PM |  |
| 34 | Hyderabad | Mercure Hyderabad KCP Hotel | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 35 | Hyderabad | Hotel TARA International | _missing_ | 12:00 PM | 2:00 PM | 12:00 PM |  |
| 36 | Hyderabad | Royalton Hyderabad | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 37 | Hyderabad | Mandakini Jaya International | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 38 | Hyderabad | Lemon Tree Hotel Banjara Hills | _missing_ | _missing_ | 2:00 PM | 11:00 AM |  |
| 39 | Hyderabad | The Golkonda Hyderabad | _missing_ | _missing_ | 1:00 PM | 11:00 AM |  |
| 40 | Hyderabad | Best Western Ashoka | _missing_ | _missing_ | 1:00 PM | 11:00 AM |  |