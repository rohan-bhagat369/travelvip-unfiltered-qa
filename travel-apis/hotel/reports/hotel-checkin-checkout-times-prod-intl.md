# Prod hotel check-in / check-out times (details + prebook)

- Base: `https://api.travelvip.ai`
- Stay: **2026-10-15 → 2026-10-16** (1 night)
- Flow: CITY search → HOTEL details → prebook. **No book / no finalize.**
- Hotels checked: **30**

## Score

| API | Calls OK | Both times present | Times null / empty / missing |
|-----|----------|--------------------|------------------------------|
| Details | 30 | **1** | **29** |
| Prebook | 30 | **2** | **28** |

## Per city

| City | Hotels | Details both times | Details null | Prebook both times | Prebook null | Prebook fail |
|------|--------|--------------------|--------------|--------------------|--------------|--------------|
| Dubai | 10 | 1 | 9 | 0 | 10 | 0 |
| Singapore | 10 | 0 | 10 | 2 | 8 | 0 |
| Bangkok | 10 | 0 | 10 | 0 | 10 | 0 |

## Hotels

| # | City | Hotel | Details checkInTime | Details checkOutTime | Prebook checkInTime | Prebook checkOutTime | Note |
|---|------|-------|---------------------|----------------------|---------------------|----------------------|------|
| 1 | Dubai | Hyatt Regency Dubai | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 2 | Dubai | The Galleria Residence, Hyatt Regency Dubai | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 3 | Dubai | Sheraton Dubai Creek Hotel & Towers | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 4 | Dubai | Swissotel Living Al Ghurair | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 5 | Dubai | Swissotel Al Ghurair | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 6 | Dubai | Hyatt Place Wasl District Residences | 3:00 PM | 12:00 PM | _missing_ | _missing_ |  |
| 7 | Dubai | Hyatt Place Dubai Wasl District | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 8 | Dubai | Canopy by Hilton Dubai Al Seef | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 9 | Dubai | Aparthotel Adagio Dubai Deira | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 10 | Dubai | Crowne Plaza Dubai Jumeirah By IHG | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 11 | Singapore | Fairmont Singapore | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 12 | Singapore | Novotel Singapore Robertson Quay | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 13 | Singapore | Maxwell Reserve Singapore, Autograph Collection | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 14 | Singapore | Pullman Singapore Hill Street | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 15 | Singapore | The Westin Singapore | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 16 | Singapore | InterContinental Singapore Robertson Quay by IHG | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 17 | Singapore | Sofitel Singapore City Centre | _missing_ | _missing_ | 3:00 PM | 12:00 PM |  |
| 18 | Singapore | JW Marriott Hotel Singapore South Beach | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 19 | Singapore | Frasers House, a Luxury Collection Hotel, Singapore | _missing_ | _missing_ | 15:00:00 | 12:00:00 |  |
| 20 | Singapore | The Ritz-Carlton, Millenia Singapore | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 21 | Bangkok | Four Points by Sheraton Bangkok Ploenchit Sukhumvit | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 22 | Bangkok | DoubleTree by Hilton Bangkok Ploenchit | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 23 | Bangkok | Hotel Muse Bangkok, Autograph Collection | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 24 | Bangkok | Conrad Bangkok | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 25 | Bangkok | Crowne Plaza Bangkok Lumpini Park by IHG | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 26 | Bangkok | Mövenpick BDMS Wellness Resort Bangkok | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 27 | Bangkok | Grand Hyatt Erawan Bangkok | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 28 | Bangkok | Conrad Bangkok Residences | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 29 | Bangkok | Novotel Bangkok Platinum Pratunam | _missing_ | _missing_ | _missing_ | _missing_ |  |
| 30 | Bangkok | Courtyard by Marriott Bangkok | _missing_ | _missing_ | 2.00 pm | _missing_ |  |