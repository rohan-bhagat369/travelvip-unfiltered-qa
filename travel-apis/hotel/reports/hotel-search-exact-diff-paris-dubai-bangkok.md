# Exact search response diff — Paris / Dubai / Bangkok

- Preprod: `https://preprod-api.travelvip.ai`
- Prod: `https://api.travelvip.ai`

## Paris (`437227:FR`)

### 1) Independent cold progressive (different dates — no cache bleed)
| | Preprod | Prod |
|-|---------|------|
| Dates | 2026-12-22→2026-12-24 | 2026-12-27→2026-12-29 |
| Cold first | 11452ms · t=37 · cache=false | 10561ms · t=37 · cache=false |
| Final | t=2718 | t=2519 |

| Poll | Preprod | Prod |
|------|---------|------|
| 0 | 11452ms/t=37 | 10561ms/t=37 |
| 1 | 1598ms/t=37 | 1218ms/t=37 |
| 2 | 1189ms/t=77 | 1269ms/t=77 |
| 3 | 1370ms/t=77 | 1537ms/t=77 |
| 4 | 1012ms/t=2718 | 1260ms/t=2519 |
| 5 | 1007ms/t=2718 | 1050ms/t=2519 |

### 2) Same-date final response compare (2027-01-31→2027-02-02)
| | Preprod | Prod |
|-|---------|------|
| Final total | 2504 | 2504 |
| Top20 overlap | 20/20 | orderSame=true |

#### Schema
- Top-level only pre: (none)
- Top-level only prod: (none)
- Hotel fields only pre: (none)
- Hotel fields only prod: (none)
- Filters only pre: (none)
- Filters only prod: (none)
- Shared hotel fields: `address, amenities, available, distance, id, image, isGSTClaimable, name, price, refundable, refundableNotes, starRating`

#### Envelope diffs
_none_

#### Top 20
| # | Preprod | Prod |
|-|---------|------|
| 1 | Renaissance Paris Republique Hotel (39780518) ★5 ₹60327.9 | Renaissance Paris Republique Hotel (39780518) ★5 ₹60327.9 |
| 2 | Hotel Du Louvre, Part Of Hyatt (31315794) ★5 ₹95784.58 | Hotel Du Louvre, Part Of Hyatt (31315794) ★5 ₹95784.58 |
| 3 | SO/ Paris Hotel (41217332) ★5 ₹80778.16 | SO/ Paris Hotel (41217332) ★5 ₹80778.16 |
| 4 | MERCURE PARIS GARE DE LYON BASTILLE (39981792) ★4 ₹29560 | MERCURE PARIS GARE DE LYON BASTILLE (39981792) ★4 ₹29560 |
| 5 | Courtyard by Marriott Paris Gare de Lyon (15449340) ★4 ₹36473.119999999995 | Courtyard by Marriott Paris Gare de Lyon (15449340) ★4 ₹36473.119999999995 |
| 6 | Mercure Paris Notre Dame Saint Germain Des Pres (38620481) ★4 ₹28661.44 | Mercure Paris Notre Dame Saint Germain Des Pres (38620481) ★4 ₹28661.44 |
| 7 | Hotel Camille Paris Gare de Lyon, Tapestry Collection by Hilton (39677777) ★4 ₹42389.46 | Hotel Camille Paris Gare de Lyon, Tapestry Collection by Hilton (39677777) ★4 ₹42389.46 |
| 8 | Mercure Paris Montparnasse Raspail (38757394) ★4 ₹28069.25 | Mercure Paris Montparnasse Raspail (38757394) ★4 ₹28069.25 |
| 9 | Novotel Paris Les Halles Hotel (39671902) ★4 ₹45346.96 | Novotel Paris Les Halles Hotel (39671902) ★4 ₹45346.96 |
| 10 | Mercure Paris La Sorbonne Saint Germain des Pres Hotel (38757454) ★4 ₹43059.83 | Mercure Paris La Sorbonne Saint Germain des Pres Hotel (38757454) ★4 ₹43059.83 |
| 11 | The Hoxton - Paris (15760190) ★4 ₹55997.94 | The Hoxton - Paris (15760190) ★4 ₹55997.94 |
| 12 | Crowne Plaza Paris République By IHG (39773931) ★4 ₹30018.14 | Crowne Plaza Paris République By IHG (39773931) ★4 ₹30018.14 |
| 13 | Holiday Inn Paris Gare de Lyon Bastille By IHG (39680994) ★4 ₹27406.08 | Holiday Inn Paris Gare de Lyon Bastille By IHG (39680994) ★4 ₹27406.08 |
| 14 | InterContinental Paris Le Grand By IHG (39714470) ★5 ₹111922.37 | InterContinental Paris Le Grand By IHG (39714470) ★5 ₹111922.37 |
| 15 | Park Hyatt Paris Vendome (39782627) ★5 ₹289219.52 | Park Hyatt Paris Vendome (39782627) ★5 ₹289219.52 |
| 16 | LE FROCHOT HOTEL PIGALLE (39755858) ★5 ₹24783.12 | LE FROCHOT HOTEL PIGALLE (39755858) ★5 ₹24783.12 |
| 17 | Sax Paris, LXR Hotels & Resorts (71181623) ★5 ₹123977.14 | Sax Paris, LXR Hotels & Resorts (71181623) ★5 ₹123977.14 |
| 18 | Le Royal Monceau Hotel Raffles Paris (32553824) ★5 ₹216909.03000000003 | Le Royal Monceau Hotel Raffles Paris (32553824) ★5 ₹216909.03000000003 |
| 19 | Hyatt Paris Madeleine (39690988) ★5 ₹84393.07 | Hyatt Paris Madeleine (39690988) ★5 ₹84393.07 |
| 20 | Sofitel Le Scribe Paris Opéra (39081977) ★5 ₹99426.47 | Sofitel Le Scribe Paris Opéra (39081977) ★5 ₹99426.47 |

## Dubai (`221688:AE`)

### 1) Independent cold progressive (different dates — no cache bleed)
| | Preprod | Prod |
|-|---------|------|
| Dates | 2027-01-02→2027-01-04 | 2027-01-07→2027-01-09 |
| Cold first | 10812ms · t=38 · cache=false | 17779ms · t=37 · cache=false |
| Final | t=1063 | t=1158 |

| Poll | Preprod | Prod |
|------|---------|------|
| 0 | 10812ms/t=38 | 17779ms/t=37 |
| 1 | 1173ms/t=38 | 6468ms/t=1158 |
| 2 | 1260ms/t=63 | 1076ms/t=1158 |
| 3 | 1114ms/t=1063 | - |
| 4 | 941ms/t=1063 | - |

### 2) Same-date final response compare (2027-02-11→2027-02-13)
| | Preprod | Prod |
|-|---------|------|
| Final total | 920 | 920 |
| Top20 overlap | 20/20 | orderSame=true |

#### Schema
- Top-level only pre: (none)
- Top-level only prod: (none)
- Hotel fields only pre: (none)
- Hotel fields only prod: (none)
- Filters only pre: (none)
- Filters only prod: (none)
- Shared hotel fields: `address, amenities, available, distance, id, image, isGSTClaimable, name, price, refundable, refundableNotes, starRating`

#### Envelope diffs
_none_

#### Top 20
| # | Preprod | Prod |
|-|---------|------|
| 1 | Hyatt Regency Dubai (38688667) ★5 ₹11952.7 | Hyatt Regency Dubai (38688667) ★5 ₹11952.7 |
| 2 | The Galleria Residence, Hyatt Regency Dubai (39961925) ★5 ₹13385.7 | The Galleria Residence, Hyatt Regency Dubai (39961925) ★5 ₹13385.7 |
| 3 | Sheraton Dubai Creek Hotel & Towers (39600369) ★5 ₹18950.33 | Sheraton Dubai Creek Hotel & Towers (39600369) ★5 ₹18950.33 |
| 4 | Swissotel Al Ghurair (39969111) ★5 ₹16908.13 | Swissotel Al Ghurair (39969111) ★5 ₹16908.13 |
| 5 | Hyatt Place Dubai Wasl District (39969134) ★4 ₹18261.27 | Hyatt Place Dubai Wasl District (39969134) ★4 ₹18261.27 |
| 6 | Swissotel Living Al Ghurair Dubai (39969130) ★4 ₹21533.83 | Swissotel Living Al Ghurair Dubai (39969130) ★4 ₹21533.83 |
| 7 | Al Seef Heritage Hotel Dubai, Curio Collection by Hilton (37653873) ★4 ₹16007.25 | Al Seef Heritage Hotel Dubai, Curio Collection by Hilton (37653873) ★4 ₹16007.25 |
| 8 | Canopy by Hilton Dubai Al Seef (39999172) ★4 ₹16007.25 | Canopy by Hilton Dubai Al Seef (39999172) ★4 ₹16007.25 |
| 9 | Aparthotel Adagio Dubai Deira (39606396) ★4 ₹17799.2 | Aparthotel Adagio Dubai Deira (39606396) ★4 ₹17799.2 |
| 10 | Crowne Plaza Dubai Jumeirah By IHG (41261072) ★5 ₹14488.14 | Crowne Plaza Dubai Jumeirah By IHG (41261072) ★5 ₹14488.14 |
| 11 | Grand Mercure Dubai City  (39683481) ★5 ₹11754.73 | Grand Mercure Dubai City  (39683481) ★5 ₹11754.73 |
| 12 | Hyatt Regency Dubai Creek Heights Residences (41491330) ★5 ₹30746.68 | Hyatt Regency Dubai Creek Heights Residences (41491330) ★5 ₹30746.68 |
| 13 | THE CANVAS HOTEL DUBAI - MGALLERY (39682184) ★5 ₹19803.16 | THE CANVAS HOTEL DUBAI - MGALLERY (39682184) ★5 ₹19803.16 |
| 14 | Pullman Dubai Creek City Centre (39967701) ★5 ₹30782.59 | Pullman Dubai Creek City Centre (39967701) ★5 ₹30782.59 |
| 15 | Hyatt Regency Dubai Creek Heights (39973335) ★5 ₹27107.15 | Hyatt Regency Dubai Creek Heights (39973335) ★5 ₹27107.15 |
| 16 | Mövenpick Hotel & Apartments Bur Dubai (39522829) ★5 ₹12909.88 | Mövenpick Hotel & Apartments Bur Dubai (39522829) ★5 ₹12909.88 |
| 17 | Marriott Marquis Dubai Creek (61895085) ★5 ₹31435.86 | Marriott Marquis Dubai Creek (61895085) ★5 ₹31435.86 |
| 18 | Sheraton Grand Hotel, Dubai (39354709) ★5 ₹42553.97 | Sheraton Grand Hotel, Dubai (39354709) ★5 ₹42553.97 |
| 19 | DoubleTree by Hilton Dubai M Square Hotel & Residences (38040865) ★5 ₹35197.46 | DoubleTree by Hilton Dubai M Square Hotel & Residences (38040865) ★5 ₹35197.46 |
| 20 | Elara & Golf Villas - curated by Park Hyatt Dubai (31250405) ★5 ₹425923.83 | Elara & Golf Villas - curated by Park Hyatt Dubai (31250405) ★5 ₹425923.83 |

## Bangkok (`328619:TH`)

### 1) Independent cold progressive (different dates — no cache bleed)
| | Preprod | Prod |
|-|---------|------|
| Dates | 2027-01-13→2027-01-15 | 2027-01-18→2027-01-20 |
| Cold first | 10601ms · t=38 · cache=false | 14184ms · t=38 · cache=false |
| Final | t=2180 | t=2494 |

| Poll | Preprod | Prod |
|------|---------|------|
| 0 | 10601ms/t=38 | 14184ms/t=38 |
| 1 | 1129ms/t=38 | 920ms/t=38 |
| 2 | 1244ms/t=74 | 1098ms/t=74 |
| 3 | 2363ms/t=2180 | 1605ms/t=2494 |
| 4 | 875ms/t=2180 | 986ms/t=2494 |

### 2) Same-date final response compare (2027-02-22→2027-02-24)
| | Preprod | Prod |
|-|---------|------|
| Final total | 2512 | 2512 |
| Top20 overlap | 20/20 | orderSame=true |

#### Schema
- Top-level only pre: (none)
- Top-level only prod: (none)
- Hotel fields only pre: (none)
- Hotel fields only prod: (none)
- Filters only pre: (none)
- Filters only prod: (none)
- Shared hotel fields: `address, amenities, available, distance, id, image, isGSTClaimable, name, price, refundable, refundableNotes, starRating`

#### Envelope diffs
_none_

#### Top 20
| # | Preprod | Prod |
|-|---------|------|
| 1 | Renaissance Bangkok Ratchaprasong Hotel by Marriott (39637311) ★5 ₹30039.99 | Renaissance Bangkok Ratchaprasong Hotel by Marriott (39637311) ★5 ₹30039.99 |
| 2 | Four Points by Sheraton Bangkok Ploenchit Sukhumvit (39660160) ★5 ₹18605.84 | Four Points by Sheraton Bangkok Ploenchit Sukhumvit (39660160) ★5 ₹18605.84 |
| 3 | DoubleTree by Hilton Bangkok Ploenchit (39592347) ★5 ₹19634.12 | DoubleTree by Hilton Bangkok Ploenchit (39592347) ★5 ₹19634.12 |
| 4 | InterContinental Bangkok by IHG (38475392) ★5 ₹37553.39 | InterContinental Bangkok by IHG (38475392) ★5 ₹37553.39 |
| 5 | The St. Regis Bangkok (38475396) ★5 ₹76652.91 | The St. Regis Bangkok (38475396) ★5 ₹76652.91 |
| 6 | Kimpton Maa-Lai Bangkok by IHG (39531770) ★5 ₹36578.01 | Kimpton Maa-Lai Bangkok by IHG (39531770) ★5 ₹36578.01 |
| 7 | Sindhorn Midtown Hotel Bangkok, Vignette Collection by IHG (39669042) ★5 ₹23102.41 | Sindhorn Midtown Hotel Bangkok, Vignette Collection by IHG (39669042) ★5 ₹23102.41 |
| 8 | VIE Hotel Bangkok - MGallery (39636190) ★5 ₹33513.56 | VIE Hotel Bangkok - MGallery (39636190) ★5 ₹33513.56 |
| 9 | Andaz One Bangkok (72335665) ★5 ₹62349.79 | Andaz One Bangkok (72335665) ★5 ₹62349.79 |
| 10 | Hotel Indigo Bangkok Wireless Road by IHG (31352778) ★5 ₹22779.91 | Hotel Indigo Bangkok Wireless Road by IHG (31352778) ★5 ₹22779.91 |
| 11 | Hotel Muse Bangkok, Autograph Collection (Marriott International) (39692789) ★5 ₹22401.22 | Hotel Muse Bangkok, Autograph Collection (Marriott International) (39692789) ★5 ₹22401.22 |
| 12 | Conrad Bangkok (17196228) ★5 ₹29063.77 | Conrad Bangkok (17196228) ★5 ₹29063.77 |
| 13 | Crowne Plaza Bangkok Lumpini Park by IHG (39647341) ★5 ₹25612.86 | Crowne Plaza Bangkok Lumpini Park by IHG (39647341) ★5 ₹25612.86 |
| 14 | JW Marriott Hotel Bangkok (38735301) ★5 ₹35633.39 | JW Marriott Hotel Bangkok (38735301) ★5 ₹35633.39 |
| 15 | The Athenee Hotel, a Luxury Collection Hotel, Bangkok (39592148) ★5 ₹42548.92 | The Athenee Hotel, a Luxury Collection Hotel, Bangkok (39592148) ★5 ₹42548.92 |
| 16 | Mövenpick BDMS Wellness Resort Bangkok (39283725) ★5 ₹24721.71 | Mövenpick BDMS Wellness Resort Bangkok (39283725) ★5 ₹24721.71 |
| 17 | Novotel Bangkok On Siam Square (39654575) ★5 ₹24042.17 | Novotel Bangkok On Siam Square (39654575) ★5 ₹24042.17 |
| 18 | Park Hyatt Bangkok (15333759) ★5 ₹61394.91 | Park Hyatt Bangkok (15333759) ★5 ₹61394.91 |
| 19 | Grand Hyatt Erawan Bangkok (39650619) ★5 ₹38289.86 | Grand Hyatt Erawan Bangkok (39650619) ★5 ₹38289.86 |
| 20 | Conrad Bangkok Residences (39522554) ★5 ₹27645.1 | Conrad Bangkok Residences (39522554) ★5 ₹27645.1 |
