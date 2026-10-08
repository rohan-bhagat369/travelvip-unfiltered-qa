# Hotel Search — Production vs Preprod (B2B, search only)

Ran: 2026-09-02T10:14:29.204Z
Dates: **2026-11-25 → 2026-11-26** · 1 adult · pid=vgm · tier=19597201

| Env | Base URL |
|-----|----------|
| **Production** | `https://api.travelvip.ai` |
| **Preprod** | `https://preprod-api.travelvip.ai` |

## Summary

- Cities compared: **6**
- **totalResults match:** 1/6 cities
- **Same page-1 order:** 6 cities
- **Reordered (same hotels, different rank):** 0 cities
- **Count drift:** 5 cities

## Per-city comparison

| City | Prod total | Preprod total | Δ | Top-10 overlap | Order | Prod premium/10 | Pre premium/10 |
|---|---:|---:|---:|---:|---|---:|---:|
| Mumbai | 1012 | 1005 | 7 | 10/10 | SAME_ORDER | 10 | 10 |
| Delhi | 1673 | 1561 | 112 | 10/10 | SAME_ORDER | 10 | 10 |
| Dubai | 872 | 839 | 33 | 10/10 | SAME_ORDER | 10 | 10 |
| Bangkok | 2609 | 2497 | 112 | 10/10 | SAME_ORDER | 10 | 10 |
| Jaipur | 818 | 817 | 1 | 10/10 | SAME_ORDER | 10 | 10 |
| Kochi | 137 | 137 | 0 | 10/10 | SAME_ORDER | 10 | 10 |

## Page 1 — top 10 side by side

### Mumbai

| Rank | Prod (name · star · ₹) | Preprod (name · star · ₹) |
|---:|---|---|
| 1 | Sofitel Mumbai BKC Hotel · 5★ · ₹33208.4 | Sofitel Mumbai BKC Hotel · 5★ · ₹33208.4 |
| 2 | Ibis Mumbai Bkc · 5★ · ₹19261.07 | Ibis Mumbai Bkc · 5★ · ₹18980.63 |
| 3 | Courtyard by Marriott Mumbai International Airport · 5★ · ₹25410.65 | Courtyard by Marriott Mumbai International Airport · 5★ · ₹25410.65 |
| 4 | Grand Hyatt Mumbai Hotel & Residences · 5★ · ₹26149.49 | Grand Hyatt Mumbai Hotel & Residences · 5★ · ₹26149.49 |
| 5 | Taj The Trees, Mumbai · 5★ · ₹29487.95 | Taj The Trees, Mumbai · 5★ · ₹29487.95 |
| 6 | Hyatt Centric Juhu Mumbai · 5★ · ₹24134.95 | Hyatt Centric Juhu Mumbai · 5★ · ₹24134.95 |
| 7 | JW Marriott Mumbai Sahar · 5★ · ₹35969.04 | JW Marriott Mumbai Sahar · 5★ · ₹35969.04 |
| 8 | Fairmont Mumbai · 5★ · ₹34574 | Fairmont Mumbai · 5★ · ₹34574 |
| 9 | Taj Santacruz · 5★ · ₹23691.02 | Taj Santacruz · 5★ · ₹23691.02 |
| 10 | Roswyn, A Morgans Originals Hotel · 5★ · ₹44739.85 | Roswyn, A Morgans Originals Hotel · 5★ · ₹44739.85 |

### Delhi

| Rank | Prod (name · star · ₹) | Preprod (name · star · ₹) |
|---:|---|---|
| 1 | Le Meridien New Delhi · 5★ · ₹29596.02 | Le Meridien New Delhi · 5★ · ₹29596.02 |
| 2 | Taj Mahal, New Delhi · 5★ · ₹55105.63 | Taj Mahal, New Delhi · 5★ · ₹55105.63 |
| 3 | Taj Palace, New Delhi · 5★ · ₹47135.93 | Taj Palace, New Delhi · 5★ · ₹47135.93 |
| 4 | Ambassador, New Delhi - IHCL SeleQtions · 5★ · ₹21272.97 | Ambassador, New Delhi - IHCL SeleQtions · 5★ · ₹17221.21 |
| 5 | ITC Maurya, a Luxury Collection Hotel, New Delhi · 5★ · ₹35888.5 | ITC Maurya, a Luxury Collection Hotel, New Delhi · 5★ · ₹35888.5 |
| 6 | Novotel New Delhi City Centre · 4★ · ₹24136.22 | Novotel New Delhi City Centre · 4★ · ₹24136.22 |
| 7 | The Connaught, New Delhi - IHCL SeleQtions · 4★ · ₹19144.61 | The Connaught, New Delhi - IHCL SeleQtions · 4★ · ₹19113.61 |
| 8 | Shangri-La Eros, New Delhi · 5★ · ₹29329.86 | Shangri-La Eros, New Delhi · 5★ · ₹29329.86 |
| 9 | The Imperial New Delhi · 5★ · ₹57572.93 | The Imperial New Delhi · 5★ · ₹57572.93 |
| 10 | The Park New Delhi · 5★ · ₹26384.64 | The Park New Delhi · 5★ · ₹26384.64 |

### Dubai

| Rank | Prod (name · star · ₹) | Preprod (name · star · ₹) |
|---:|---|---|
| 1 | Hyatt Regency Dubai · 5★ · ₹19280.7 | Hyatt Regency Dubai · 5★ · ₹17674.73 |
| 2 | Hyatt Regency Galleria Residence Dubai · 5★ · ₹15333 | Hyatt Regency Galleria Residence Dubai · 5★ · ₹15926.89 |
| 3 | Sheraton Dubai Creek Hotel & Towers · 5★ · ₹17655.64 | Sheraton Dubai Creek Hotel & Towers · 5★ · ₹17588.88 |
| 4 | Swissotel Living Al Ghurair · 5★ · ₹15062.71 | Swissotel Living Al Ghurair · 5★ · ₹15062.71 |
| 5 | Swissotel Al Ghurair · 5★ · ₹14274.22 | Swissotel Al Ghurair · 5★ · ₹14274.22 |
| 6 | Hyatt Place Wasl District Residences · 4★ · ₹16039 | Hyatt Place Wasl District Residences · 4★ · ₹16039 |
| 7 | Hyatt Place Dubai Wasl District · 4★ · ₹11855.46 | Hyatt Place Dubai Wasl District · 4★ · ₹11855.46 |
| 8 | Al Seef Heritage Hotel Dubai, Curio Collection by Hilton · 4★ · ₹14585.47 | Al Seef Heritage Hotel Dubai, Curio Collection by Hilton · 4★ · ₹14585.47 |
| 9 | Canopy by Hilton Dubai Al Seef · 4★ · ₹18354.33 | Canopy by Hilton Dubai Al Seef · 4★ · ₹15369.32 |
| 10 | Aparthotel Adagio Dubai Deira · 4★ · ₹7829.6 | Aparthotel Adagio Dubai Deira · 4★ · ₹7829.6 |

### Bangkok

| Rank | Prod (name · star · ₹) | Preprod (name · star · ₹) |
|---:|---|---|
| 1 | Renaissance Bangkok Ratchaprasong Hotel by Marriott · 5★ · ₹15646.59 | Renaissance Bangkok Ratchaprasong Hotel by Marriott · 5★ · ₹15646.59 |
| 2 | Four Points by Sheraton Bangkok Ploenchit Sukhumvit · 5★ · ₹10243.49 | Four Points by Sheraton Bangkok Ploenchit Sukhumvit · 5★ · ₹9556.32 |
| 3 | DoubleTree by Hilton Bangkok Ploenchit · 5★ · ₹10755.7 | DoubleTree by Hilton Bangkok Ploenchit · 5★ · ₹10755.7 |
| 4 | InterContinental Bangkok by IHG · 5★ · ₹20302.49 | InterContinental Bangkok by IHG · 5★ · ₹20302.49 |
| 5 | The St. Regis Bangkok · 5★ · ₹29205.83 | The St. Regis Bangkok · 5★ · ₹29205.83 |
| 6 | Kimpton Maa-Lai Bangkok by IHG · 5★ · ₹22319.76 | Kimpton Maa-Lai Bangkok by IHG · 5★ · ₹22319.76 |
| 7 | Sindhorn Midtown Hotel Bangkok, Vignette Collection by IHG · 5★ · ₹12132.56 | Sindhorn Midtown Hotel Bangkok, Vignette Collection by IHG · 5★ · ₹12132.56 |
| 8 | VIE Hotel Bangkok - MGallery · 5★ · ₹17200.31 | VIE Hotel Bangkok - MGallery · 5★ · ₹17200.31 |
| 9 | Andaz One Bangkok · 5★ · ₹32643.5 | Andaz One Bangkok · 5★ · ₹32643.5 |
| 10 | Hotel Indigo Bangkok Wireless Road by IHG · 5★ · ₹11861.97 | Hotel Indigo Bangkok Wireless Road by IHG · 5★ · ₹11385.34 |

### Jaipur

| Rank | Prod (name · star · ₹) | Preprod (name · star · ₹) |
|---:|---|---|
| 1 | Jai Mahal Palace · 5★ · ₹35476.14 | Jai Mahal Palace · 5★ · ₹35476.14 |
| 2 | Hilton Jaipur · 5★ · ₹18671.97 | Hilton Jaipur · 5★ · ₹18671.97 |
| 3 | Holiday Inn Jaipur City Centre by IHG · 5★ · ₹10654.49 | Holiday Inn Jaipur City Centre by IHG · 5★ · ₹10654.49 |
| 4 | ibis Jaipur City Centre · 4★ · ₹4420.6 | ibis Jaipur City Centre · 4★ · ₹4420.6 |
| 5 | Rambagh Palace · 5★ · ₹234325.2 | Rambagh Palace · 5★ · ₹234325.2 |
| 6 | Holiday Inn Express & Suites Jaipur Gopalpura by IHG · 4★ · ₹7833.78 | Holiday Inn Express & Suites Jaipur Gopalpura by IHG · 4★ · ₹7833.78 |
| 7 | Radisson Jaipur City Center · 5★ · ₹25511.87 | Radisson Jaipur City Center · 5★ · ₹25511.87 |
| 8 | Ashok Villa · 5★ · ₹3962.71 | Ashok Villa · 5★ · ₹3962.71 |
| 9 | FORTUNE SELECT METROPOLITAN · 5★ · ₹16616.41 | FORTUNE SELECT METROPOLITAN · 5★ · ₹16616.41 |
| 10 | Dileep Kothi - Boutique Hotel · 5★ · ₹24802.26 | Dileep Kothi - Boutique Hotel · 5★ · ₹24802.26 |

### Kochi

| Rank | Prod (name · star · ₹) | Preprod (name · star · ₹) |
|---:|---|---|
| 1 | Taj Malabar Resort & Spa, Cochin · 5★ · ₹84535.87 | Taj Malabar Resort & Spa, Cochin · 5★ · ₹84535.87 |
| 2 | Abad Fort · 4★ · ₹2804.39 | Abad Fort · 4★ · ₹2804.39 |
| 3 | Ossos Apartment · 4★ · ₹2445.08 | Ossos Apartment · 4★ · ₹2445.08 |
| 4 | Seaking Suites · 4★ · ₹2980.43 | Seaking Suites · 4★ · ₹2980.43 |
| 5 | The Postcard  Mandalay Hall, Kochi · 5★ · ₹31232.16 | The Postcard  Mandalay Hall, Kochi · 5★ · ₹31232.16 |
| 6 | Casino Hotel - Cgh Earth, Cochin · 5★ · ₹4176.7 | Casino Hotel - Cgh Earth, Cochin · 5★ · ₹4176.7 |
| 7 | The Fern Kochi, Series by Marriott · 5★ · ₹13736.36 | The Fern Kochi, Series by Marriott · 5★ · ₹13736.36 |
| 8 | The Malabar House · 4★ · ₹16133.68 | The Malabar House · 4★ · ₹16133.68 |
| 9 | Forte Kochi · 4★ · ₹27735.02 | Forte Kochi · 4★ · ₹27735.02 |
| 10 | Old Lighthouse Bristow Hotel · 4★ · ₹11074.94 | Old Lighthouse Bristow Hotel · 4★ · ₹11074.94 |

## Mumbai deep dive

- **Pagination unique hotels:** prod=1005 preprod=1005 match=true
- **Price ASC cheapest:** prod=New Shahana - Hostel (₹324.41) · preprod=New Shahana - Hostel (₹324.41)

## Filter facets (Mumbai)

| Filter | Prod facets | Preprod facets |
|---|---:|---:|
| star | 3 | 3 |
| chain | 28 | 28 |
| brand | 35 | 35 |
| gst | 1 | 1 |

## Interpretation

- **Count match** = ranking change did not add/remove hotels (test plan case 2).
- **REORDERED** with high overlap = expected if preprod has new Riya ranking and prod does not yet.
- **Price ASC** should differ from default order on both envs (customer sort wins).
- Small total Δ may be inventory/timing, not ranking.