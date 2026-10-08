# Hotel search response — Preprod vs Prod (exact diff)

- Preprod: `https://preprod-api.travelvip.ai`
- Prod: `https://api.travelvip.ai`
- Same dates & 1ADT per city; search only

## Paris (2026-11-07 → 2026-11-09)

| | Preprod | Prod |
|-|---------|------|
| Cold first | 7461ms · total=0 | 154ms · total=0 |
| Final total | 0 | 0 |
| Grew early→full | false | false |
| Top20 overlap | 0/20 | order same: true |

### Progressive poll series
| Poll | Preprod ms / total | Prod ms / total |
|------|--------------------|-----------------|
| 0 | 7461/0 | 154/0 |
| 1 | 227/0 | 231/0 |
| 2 | 337/0 | 227/0 |
| 3 | 432/0 | 285/0 |
| 4 | 227/0 | 237/0 |
| 5 | 236/0 | 223/0 |

### Envelope
```
pre:  {"page":0,"size":20,"offset":0,"totalResults":0,"totalPages":0,"availableResults":0,"last":true,"currency":"INR","fromCache":true,"hasProgress":false,"hasPartial":false,"priceRangeFilter":{"key":"price_range","displayName":"Price Range","min":12417.09,"max":29571.94,"currency":"INR"}}
prod: {"page":0,"size":20,"offset":0,"totalResults":0,"totalPages":0,"availableResults":0,"last":true,"currency":"INR","fromCache":true,"hasProgress":false,"hasPartial":false,"priceRangeFilter":{"key":"price_range","displayName":"Price Range","min":12417.09,"max":29571.94,"currency":"INR"}}
```
_No envelope field diffs (excluding cache)._

### Schema / keys
- Top-level keys only on preprod: (none)
- Top-level keys only on prod: (none)
- Hotel fields only on preprod: (none)
- Hotel fields only on prod: (none)
- Filters only on preprod: (none)
- Filters only on prod: (none)
- Sorts only on preprod: (none)
- Sorts only on prod: (none)

### Top 20 hotels
| # | Preprod | Prod |
|-|---------|------|
| 1 | - | - |
| 2 | - | - |
| 3 | - | - |
| 4 | - | - |
| 5 | - | - |
| 6 | - | - |
| 7 | - | - |
| 8 | - | - |
| 9 | - | - |
| 10 | - | - |
| 11 | - | - |
| 12 | - | - |
| 13 | - | - |
| 14 | - | - |
| 15 | - | - |
| 16 | - | - |
| 17 | - | - |
| 18 | - | - |
| 19 | - | - |
| 20 | - | - |


## Dubai (2026-11-11 → 2026-11-13)

| | Preprod | Prod |
|-|---------|------|
| Cold first | 10790ms · total=38 | 929ms · total=1369 |
| Final total | 1369 | 1369 |
| Grew early→full | true | false |
| Top20 overlap | 20/20 | order same: true |

### Progressive poll series
| Poll | Preprod ms / total | Prod ms / total |
|------|--------------------|-----------------|
| 0 | 10790/38 | 929/1369 |
| 1 | 981/38 | 1083/1369 |
| 2 | 1077/64 | 2239/1369 |
| 3 | 1402/1369 | 1056/1369 |
| 4 | 1025/1369 | 1130/1369 |
| 5 | 1242/1369 | 968/1369 |

### Envelope
```
pre:  {"page":0,"size":20,"offset":0,"totalResults":1369,"totalPages":69,"availableResults":1369,"last":false,"currency":"INR","fromCache":true,"hasProgress":false,"hasPartial":false,"priceRangeFilter":{"key":"price_range","displayName":"Price Range","min":1751.06,"max":5273023.03,"currency":"INR"}}
prod: {"page":0,"size":20,"offset":0,"totalResults":1369,"totalPages":69,"availableResults":1369,"last":false,"currency":"INR","fromCache":true,"hasProgress":false,"hasPartial":false,"priceRangeFilter":{"key":"price_range","displayName":"Price Range","min":1751.06,"max":5273023.03,"currency":"INR"}}
```
_No envelope field diffs (excluding cache)._

### Schema / keys
- Top-level keys only on preprod: (none)
- Top-level keys only on prod: (none)
- Hotel fields only on preprod: (none)
- Hotel fields only on prod: (none)
- Filters only on preprod: (none)
- Filters only on prod: (none)
- Sorts only on preprod: (none)
- Sorts only on prod: (none)

### Top 20 hotels
| # | Preprod | Prod |
|-|---------|------|
| 1 | Hyatt Regency Dubai (38688667) ★5 ₹17186.34 | Hyatt Regency Dubai (38688667) ★5 ₹17186.34 |
| 2 | Sheraton Dubai Creek Hotel & Towers (39600369) ★5 ₹30311.44 | Sheraton Dubai Creek Hotel & Towers (39600369) ★5 ₹30311.44 |
| 3 | Swissotel Al Ghurair (39969111) ★5 ₹24958.53 | Swissotel Al Ghurair (39969111) ★5 ₹24958.53 |
| 4 | The Galleria Residence, Hyatt Regency Dubai (39961925) ★5 ₹19123.04 | The Galleria Residence, Hyatt Regency Dubai (39961925) ★5 ₹19123.04 |
| 5 | Hyatt Place Dubai Wasl District (39969134) ★4 ₹24909.33 | Hyatt Place Dubai Wasl District (39969134) ★4 ₹24909.33 |
| 6 | Swissotel Living Al Ghurair Dubai (39969130) ★4 ₹31939.829999999998 | Swissotel Living Al Ghurair Dubai (39969130) ★4 ₹31939.829999999998 |
| 7 | Aparthotel Adagio Dubai Deira (39606396) ★4 ₹18790.41 | Aparthotel Adagio Dubai Deira (39606396) ★4 ₹18790.41 |
| 8 | Hyatt Place Wasl District Residences (60466771) ★4 ₹30169.02 | Hyatt Place Wasl District Residences (60466771) ★4 ₹30169.02 |
| 9 | Al Seef Heritage Hotel Dubai, Curio Collection by Hilton (37653873) ★4 ₹28631.26 | Al Seef Heritage Hotel Dubai, Curio Collection by Hilton (37653873) ★4 ₹28631.26 |
| 10 | Canopy by Hilton Dubai Al Seef (39999172) ★4 ₹28488.13 | Canopy by Hilton Dubai Al Seef (39999172) ★4 ₹28488.13 |
| 11 | Hyatt Regency Dubai Creek Heights (39973335) ★5 ₹26368.2 | Hyatt Regency Dubai Creek Heights (39973335) ★5 ₹26368.2 |
| 12 | Mövenpick Hotel & Apartments Bur Dubai (39522829) ★5 ₹25416.06 | Mövenpick Hotel & Apartments Bur Dubai (39522829) ★5 ₹25416.06 |
| 13 | Marriott Marquis Dubai Creek (61895085) ★5 ₹33515.31 | Marriott Marquis Dubai Creek (61895085) ★5 ₹33515.31 |
| 14 | Elara & Golf Villas - curated by Park Hyatt Dubai (31250405) ★5 ₹309467.84 | Elara & Golf Villas - curated by Park Hyatt Dubai (31250405) ★5 ₹309467.84 |
| 15 | Pullman Dubai City Centre Residences (39963496) ★5 ₹44802.3 | Pullman Dubai City Centre Residences (39963496) ★5 ₹44802.3 |
| 16 | SOFITEL DUBAI THE OBELISK (40005801) ★5 ₹38201.8 | SOFITEL DUBAI THE OBELISK (40005801) ★5 ₹38201.8 |
| 17 | Crowne Plaza Dubai Jumeirah By IHG (41261072) ★5 ₹21687.24 | Crowne Plaza Dubai Jumeirah By IHG (41261072) ★5 ₹21687.24 |
| 18 | Grand Mercure Dubai City  (39683481) ★5 ₹21296.63 | Grand Mercure Dubai City  (39683481) ★5 ₹21296.63 |
| 19 | Hyatt Regency Dubai Creek Heights Residences (41491330) ★5 ₹38283.67 | Hyatt Regency Dubai Creek Heights Residences (41491330) ★5 ₹38283.67 |
| 20 | THE CANVAS HOTEL DUBAI - MGALLERY (39682184) ★5 ₹23643.65 | THE CANVAS HOTEL DUBAI - MGALLERY (39682184) ★5 ₹23643.65 |


## Bangkok (2026-11-15 → 2026-11-17)

| | Preprod | Prod |
|-|---------|------|
| Cold first | 11380ms · total=38 | 1028ms · total=2602 |
| Final total | 2602 | 2602 |
| Grew early→full | true | false |
| Top20 overlap | 20/20 | order same: true |

### Progressive poll series
| Poll | Preprod ms / total | Prod ms / total |
|------|--------------------|-----------------|
| 0 | 11380/38 | 1028/2602 |
| 1 | 1242/38 | 858/2602 |
| 2 | 1246/38 | 961/2602 |
| 3 | 1362/75 | 931/2602 |
| 4 | 2610/2602 | 1075/2602 |
| 5 | 1092/2602 | 991/2602 |

### Envelope
```
pre:  {"page":0,"size":20,"offset":0,"totalResults":2602,"totalPages":131,"availableResults":2602,"last":false,"currency":"INR","fromCache":true,"hasProgress":false,"hasPartial":false,"priceRangeFilter":{"key":"price_range","displayName":"Price Range","min":742.45,"max":181533.36,"currency":"INR"}}
prod: {"page":0,"size":20,"offset":0,"totalResults":2602,"totalPages":131,"availableResults":2602,"last":false,"currency":"INR","fromCache":true,"hasProgress":false,"hasPartial":false,"priceRangeFilter":{"key":"price_range","displayName":"Price Range","min":742.45,"max":181533.36,"currency":"INR"}}
```
_No envelope field diffs (excluding cache)._

### Schema / keys
- Top-level keys only on preprod: (none)
- Top-level keys only on prod: (none)
- Hotel fields only on preprod: (none)
- Hotel fields only on prod: (none)
- Filters only on preprod: (none)
- Filters only on prod: (none)
- Sorts only on preprod: (none)
- Sorts only on prod: (none)

### Top 20 hotels
| # | Preprod | Prod |
|-|---------|------|
| 1 | Renaissance Bangkok Ratchaprasong Hotel by Marriott (39637311) ★5 ₹28796.02 | Renaissance Bangkok Ratchaprasong Hotel by Marriott (39637311) ★5 ₹28796.02 |
| 2 | Four Points by Sheraton Bangkok Ploenchit Sukhumvit (39660160) ★5 ₹20937.62 | Four Points by Sheraton Bangkok Ploenchit Sukhumvit (39660160) ★5 ₹20937.62 |
| 3 | DoubleTree by Hilton Bangkok Ploenchit (39592347) ★5 ₹19654.03 | DoubleTree by Hilton Bangkok Ploenchit (39592347) ★5 ₹19654.03 |
| 4 | InterContinental Bangkok by IHG (38475392) ★5 ₹48923.43 | InterContinental Bangkok by IHG (38475392) ★5 ₹48923.43 |
| 5 | The St. Regis Bangkok (38475396) ★5 ₹72336.86 | The St. Regis Bangkok (38475396) ★5 ₹72336.86 |
| 6 | Kimpton Maa-Lai Bangkok by IHG (39531770) ★5 ₹42841.82 | Kimpton Maa-Lai Bangkok by IHG (39531770) ★5 ₹42841.82 |
| 7 | Sindhorn Midtown Hotel Bangkok, Vignette Collection by IHG (39669042) ★5 ₹23409.66 | Sindhorn Midtown Hotel Bangkok, Vignette Collection by IHG (39669042) ★5 ₹23409.66 |
| 8 | VIE Hotel Bangkok - MGallery (39636190) ★5 ₹38584.15 | VIE Hotel Bangkok - MGallery (39636190) ★5 ₹38584.15 |
| 9 | Andaz One Bangkok (72335665) ★5 ₹107826.63 | Andaz One Bangkok (72335665) ★5 ₹107826.63 |
| 10 | Hotel Indigo Bangkok Wireless Road by IHG (31352778) ★5 ₹22779.91 | Hotel Indigo Bangkok Wireless Road by IHG (31352778) ★5 ₹22779.91 |
| 11 | Hotel Muse Bangkok, Autograph Collection (Marriott International) (39692789) ★5 ₹20303.57 | Hotel Muse Bangkok, Autograph Collection (Marriott International) (39692789) ★5 ₹20303.57 |
| 12 | Conrad Bangkok (17196228) ★5 ₹38779.1 | Conrad Bangkok (17196228) ★5 ₹38779.1 |
| 13 | Crowne Plaza Bangkok Lumpini Park by IHG (39647341) ★5 ₹26788.85 | Crowne Plaza Bangkok Lumpini Park by IHG (39647341) ★5 ₹26788.85 |
| 14 | JW Marriott Hotel Bangkok (38735301) ★5 ₹62977.35 | JW Marriott Hotel Bangkok (38735301) ★5 ₹62977.35 |
| 15 | The Athenee Hotel, a Luxury Collection Hotel, Bangkok (39592148) ★5 ₹50066.58 | The Athenee Hotel, a Luxury Collection Hotel, Bangkok (39592148) ★5 ₹50066.58 |
| 16 | Mövenpick BDMS Wellness Resort Bangkok (39283725) ★5 ₹26617.34 | Mövenpick BDMS Wellness Resort Bangkok (39283725) ★5 ₹26617.34 |
| 17 | Novotel Bangkok On Siam Square (39654575) ★5 ₹27153.09 | Novotel Bangkok On Siam Square (39654575) ★5 ₹27153.09 |
| 18 | Park Hyatt Bangkok (15333759) ★5 ₹60911.45 | Park Hyatt Bangkok (15333759) ★5 ₹60911.45 |
| 19 | Grand Hyatt Erawan Bangkok (39650619) ★5 ₹67195.03 | Grand Hyatt Erawan Bangkok (39650619) ★5 ₹67195.03 |
| 20 | Conrad Bangkok Residences (39522554) ★5 ₹36697.28 | Conrad Bangkok Residences (39522554) ★5 ₹36697.28 |


## Delhi (2026-11-19 → 2026-11-21)

| | Preprod | Prod |
|-|---------|------|
| Cold first | 8827ms · total=34 | 617ms · total=1449 |
| Final total | 1449 | 1449 |
| Grew early→full | true | false |
| Top20 overlap | 20/20 | order same: true |

### Progressive poll series
| Poll | Preprod ms / total | Prod ms / total |
|------|--------------------|-----------------|
| 0 | 8827/34 | 617/1449 |
| 1 | 1066/34 | 857/1449 |
| 2 | 1443/62 | 845/1449 |
| 3 | 1339/1449 | 883/1449 |
| 4 | 1008/1449 | 958/1449 |
| 5 | 952/1449 | 947/1449 |

### Envelope
```
pre:  {"page":0,"size":20,"offset":0,"totalResults":1449,"totalPages":73,"availableResults":1449,"last":false,"currency":"INR","fromCache":true,"hasProgress":false,"hasPartial":false,"priceRangeFilter":{"key":"price_range","displayName":"Price Range","min":276.45,"max":9592713.61,"currency":"INR"}}
prod: {"page":0,"size":20,"offset":0,"totalResults":1449,"totalPages":73,"availableResults":1449,"last":false,"currency":"INR","fromCache":true,"hasProgress":false,"hasPartial":false,"priceRangeFilter":{"key":"price_range","displayName":"Price Range","min":276.45,"max":9592713.61,"currency":"INR"}}
```
_No envelope field diffs (excluding cache)._

### Schema / keys
- Top-level keys only on preprod: (none)
- Top-level keys only on prod: (none)
- Hotel fields only on preprod: (none)
- Hotel fields only on prod: (none)
- Filters only on preprod: (none)
- Filters only on prod: (none)
- Sorts only on preprod: (none)
- Sorts only on prod: (none)

### Top 20 hotels
| # | Preprod | Prod |
|-|---------|------|
| 1 | Le Méridien New Delhi (39676544) ★5 ₹57073.18 | Le Méridien New Delhi (39676544) ★5 ₹57073.18 |
| 2 | Taj Mahal, New Delhi (39645070) ★5 ₹83474.08 | Taj Mahal, New Delhi (39645070) ★5 ₹83474.08 |
| 3 | NOVOTEL NEW DELHI CITY CENTRE (70508700) ★5 ₹30861.33 | NOVOTEL NEW DELHI CITY CENTRE (70508700) ★5 ₹30861.33 |
| 4 | Taj Palace, New Delhi (39811711) ★5 ₹58939.26 | Taj Palace, New Delhi (39811711) ★5 ₹58939.26 |
| 5 | Ambassador, New Delhi - IHCL SeleQtions (16261325) ★5 ₹42487.73 | Ambassador, New Delhi - IHCL SeleQtions (16261325) ★5 ₹42487.73 |
| 6 | ITC Maurya, a Luxury Collection Hotel, New Delhi (39707491) ★5 ₹126967.67 | ITC Maurya, a Luxury Collection Hotel, New Delhi (39707491) ★5 ₹126967.67 |
| 7 | The Connaught New Delhi (39626509) ★4 ₹39279.6 | The Connaught New Delhi (39626509) ★4 ₹39279.6 |
| 8 | Shangri-La's Eros Hotel (38415670) ★5 ₹61936.06 | Shangri-La's Eros Hotel (38415670) ★5 ₹61936.06 |
| 9 | The Imperial New Delhi (39658270) ★5 ₹161159.19999999998 | The Imperial New Delhi (39658270) ★5 ₹161159.19999999998 |
| 10 | The Claridges New Delhi (39624387) ★5 ₹98130.75 | The Claridges New Delhi (39624387) ★5 ₹98130.75 |
| 11 | BREEZY HEIGHTS (55157820) ★5 ₹7422.05 | BREEZY HEIGHTS (55157820) ★5 ₹7422.05 |
| 12 | The Park New Delhi Hotel (32502802) ★5 ₹52034.81 | The Park New Delhi Hotel (32502802) ★5 ₹52034.81 |
| 13 | The Metropolitan Hotel & Spa (39503514) ★5 ₹39373.76 | The Metropolitan Hotel & Spa (39503514) ★5 ₹39373.76 |
| 14 | Hotel The Royal Plaza (39705974) ★4 ₹32517.17 | Hotel The Royal Plaza (39705974) ★4 ₹32517.17 |
| 15 | UDS Villa - Next to VFS, Walking to Connaught Place (41617511) ★4 ₹25377.84 | UDS Villa - Next to VFS, Walking to Connaught Place (41617511) ★4 ₹25377.84 |
| 16 | Delhi Downtown Stay B&B (72333670) ★4 ₹25377.84 | Delhi Downtown Stay B&B (72333670) ★4 ₹25377.84 |
| 17 | Asar Connaught Place by Orion Hotels (71598919) ★4 ₹23090 | Asar Connaught Place by Orion Hotels (71598919) ★4 ₹23090 |
| 18 | Radisson Blu Marina Hotel Connaught Place (39775455) ★5 ₹48358.979999999996 | Radisson Blu Marina Hotel Connaught Place (39775455) ★5 ₹48358.979999999996 |
| 19 | The Lodhi - A member of The Leading Hotels Of The World (39761186) ★5 ₹95501 | The Lodhi - A member of The Leading Hotels Of The World (39761186) ★5 ₹95501 |
| 20 | HOTEL LE CASHEW BY A1ROOMS (70495742) ★5 ₹2657.03 | HOTEL LE CASHEW BY A1ROOMS (70495742) ★5 ₹2657.03 |


## Mumbai (2026-11-23 → 2026-11-25)

| | Preprod | Prod |
|-|---------|------|
| Cold first | 9006ms · total=34 | 536ms · total=901 |
| Final total | 901 | 901 |
| Grew early→full | true | false |
| Top20 overlap | 20/20 | order same: true |

### Progressive poll series
| Poll | Preprod ms / total | Prod ms / total |
|------|--------------------|-----------------|
| 0 | 9006/34 | 536/901 |
| 1 | 769/34 | 681/901 |
| 2 | 930/901 | 682/901 |
| 3 | 882/901 | 714/901 |
| 4 | 772/901 | 701/901 |
| 5 | 635/901 | 713/901 |

### Envelope
```
pre:  {"page":0,"size":20,"offset":0,"totalResults":901,"totalPages":46,"availableResults":901,"last":false,"currency":"INR","fromCache":true,"hasProgress":false,"hasPartial":false,"priceRangeFilter":{"key":"price_range","displayName":"Price Range","min":548.69,"max":1472468.21,"currency":"INR"}}
prod: {"page":0,"size":20,"offset":0,"totalResults":901,"totalPages":46,"availableResults":901,"last":false,"currency":"INR","fromCache":true,"hasProgress":false,"hasPartial":false,"priceRangeFilter":{"key":"price_range","displayName":"Price Range","min":548.69,"max":1472468.21,"currency":"INR"}}
```
_No envelope field diffs (excluding cache)._

### Schema / keys
- Top-level keys only on preprod: (none)
- Top-level keys only on prod: (none)
- Hotel fields only on preprod: (none)
- Hotel fields only on prod: (none)
- Filters only on preprod: (none)
- Filters only on prod: (none)
- Sorts only on preprod: (none)
- Sorts only on prod: (none)

### Top 20 hotels
| # | Preprod | Prod |
|-|---------|------|
| 1 | Sofitel Mumbai BKC  (39624369) ★5 ₹68056.3 | Sofitel Mumbai BKC  (39624369) ★5 ₹68056.3 |
| 2 | ibis Mumbai BKC (71042622) ★4 ₹29082.36 | ibis Mumbai BKC (71042622) ★4 ₹29082.36 |
| 3 | ITC Maratha, a Luxury Collection Hotel, Mumbai (39659376) ★5 ₹56061.21 | ITC Maratha, a Luxury Collection Hotel, Mumbai (39659376) ★5 ₹56061.21 |
| 4 | Courtyard by Marriott Mumbai International Airport (32799941) ★5 ₹46427.13 | Courtyard by Marriott Mumbai International Airport (32799941) ★5 ₹46427.13 |
| 5 | Grand Hyatt Mumbai (39681377) ★5 ₹50569 | Grand Hyatt Mumbai (39681377) ★5 ₹50569 |
| 6 | Taj The Trees, Mumbai (51117724) ★5 ₹70015.3 | Taj The Trees, Mumbai (51117724) ★5 ₹70015.3 |
| 7 | JW Marriott Mumbai Sahar (39691858) ★5 ₹68961.59 | JW Marriott Mumbai Sahar (39691858) ★5 ₹68961.59 |
| 8 | FAIRMONT MUMBAI (70508694) ★5 ₹60298 | FAIRMONT MUMBAI (70508694) ★5 ₹60298 |
| 9 | TAJ SANTACRUZ, MUMBAI (39621191) ★5 ₹57422.6 | TAJ SANTACRUZ, MUMBAI (39621191) ★5 ₹57422.6 |
| 10 | ROSWYN, A MORGANS ORIGINALS HOTEL (72331941) ★5 ₹71383.35 | ROSWYN, A MORGANS ORIGINALS HOTEL (72331941) ★5 ₹71383.35 |
| 11 | Novotel Mumbai International Airport (41546861) ★5 ₹40680.6 | Novotel Mumbai International Airport (41546861) ★5 ₹40680.6 |
| 12 | Hilton Mumbai International Airport (39774210) ★5 ₹47265.05 | Hilton Mumbai International Airport (39774210) ★5 ₹47265.05 |
| 13 | Fairfield by Marriott Mumbai International Airport (41442163) ★4 ₹36845.17 | Fairfield by Marriott Mumbai International Airport (41442163) ★4 ₹36845.17 |
| 14 | The Fern Residency Mumbai, The Acres Chembur, Series by Marriott (39639355) ★4 ₹25494.36 | The Fern Residency Mumbai, The Acres Chembur, Series by Marriott (39639355) ★4 ₹25494.36 |
| 15 | Hilton Garden Inn Mumbai International Airport (41512292) ★4 ₹28213.42 | Hilton Garden Inn Mumbai International Airport (41512292) ★4 ₹28213.42 |
| 16 | HOLIDAY INN MUMBAI INTERNATIONAL AIRPORT (39769793) ★4 ₹36614.28 | HOLIDAY INN MUMBAI INTERNATIONAL AIRPORT (39769793) ★4 ₹36614.28 |
| 17 | Hotel Beverly Palace Santacruz (70440801) ★5 ₹7156.34 | Hotel Beverly Palace Santacruz (70440801) ★5 ₹7156.34 |
| 18 | CozyKey Rooms Kalina (72408835) ★5 ₹9432.95 | CozyKey Rooms Kalina (72408835) ★5 ₹9432.95 |
| 19 | HOTEL METROPLEX (72465612) ★5 ₹3634.28 | HOTEL METROPLEX (72465612) ★5 ₹3634.28 |
| 20 | Niranta Airport Transit Hotel & Lounge Terminal 2 Arrivals/Landside (70445708) ★4 ₹21286.22 | Niranta Airport Transit Hotel & Lounge Terminal 2 Arrivals/Landside (70445708) ★4 ₹21286.22 |

