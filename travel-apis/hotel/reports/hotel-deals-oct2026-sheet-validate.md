# Hotel deals Oct 2026 sheet vs API

Ran: 2026-10-12T11:41:25.260Z
CITY: NEW DELHI (131679) — 2 page(s), 5 hotels
Token expired mid-run: **NO**

## Summary

| Metric | Count |
|---|---:|
| sheetRows | 58 |
| uniqueHotels | 29 |
| PASS | 58 |
| PASS_PRICE | 0 |
| ROOM_PRESENT_PRICE_MISMATCH | 0 |
| PRICE_PRESENT_ROOM_MISMATCH | 0 |
| MISSING | 0 |
| HOTEL_API_EMPTY | 0 |
| NOT_TESTED_TOKEN | 0 |
| inCityListing | 10 |
| notInCityListing | 48 |

## CITY pagination

| Page | Offset | HTTP | Count | Last | Hotels |
|---:|---:|---:|---:|---|---|
| 0 | 0 | 200 | 5 | false | 2819563 ITC Grand Bharat, a Luxury Collection Retreat, Gurgaon; 3186820 The Oberoi, New Delhi; 3188832 Taj Mahal, New Delhi; 3248222 ITC Maurya, a Luxury Collection Hotel, New Delhi; 3282559 The Oberoi Gurgaon |
| 1 | 5 | 200 | 0 | true |  |

## Row results

| Sr | Hotel | City | MetaId | In CITY (page) | Sheet room | Sheet sell | API room | API sell | Status |
|---:|---|---|---|---|---|---:|---|---:|---|
| 1 | Taj Mahal Palace | Mumbai | 5657332 | no | Luxury Room | 463.88597938144335 | Luxury Room | 463.88597938144335 | PASS |
| 2 | Taj Mahal Palace | Mumbai | 5657332 | no | Taj Club room city view king bed | 720.2440206185566 | Taj Club room city view king bed | 720.2440206185566 | PASS |
| 3 | Taj Lands End | Mumbai | 3188877 | no | Deluxe Room Pool View King Bed | 287.42515979381443 | Deluxe Room Pool View King Bed | 287.42515979381443 | PASS |
| 4 | Taj Lands End | Mumbai | 3188877 | no | Bay View Room King Bed | 324.35809793814434 | Bay View Room King Bed | 324.35809793814434 | PASS |
| 5 | Taj Santacruz | Mumbai | 2955308 | no | Luxury Room  facade view | 236.826 | Luxury Room  facade view | 236.826 | PASS |
| 6 | Taj Santacruz | Mumbai | 2955308 | no | Luxury Room city view king bed | 239.87788144329897 | Luxury Room city view king bed | 239.87788144329897 | PASS |
| 7 | Taj Mahal, New Delhi | New Delhi | 3188832 | 0 | Luxury Room city view king bed | 664.0894020618557 | Luxury Room city view king bed | 664.0894020618557 | PASS |
| 8 | Taj Mahal, New Delhi | New Delhi | 3188832 | 0 | Taj club executive room king bed | 721.4647731958763 | Taj club executive room king bed | 721.4647731958763 | PASS |
| 9 | Taj Bengal | Kolkata | 3188631 | no | Deluxe Room Various Views King Bed | 177.00912371134024 | Deluxe Room Various Views King Bed | 177.00912371134024 | PASS |
| 10 | Taj Bengal | Kolkata | 3188631 | no | Taj Club Room King Bed | 268.5655670103093 | Taj Club Room King Bed | 268.5655670103093 | PASS |
| 11 | Taj Falaknuma Palace | Hyderabad | 3388219 | no | Palace room garden view | 573.7537113402062 | Palace room garden view | 573.7537113402062 | PASS |
| 12 | Taj Falaknuma Palace | Hyderabad | 3388219 | no | Historical suite city view | 756.8665979381443 | Historical suite city view | 756.8665979381443 | PASS |
| 13 | Taj Lake Palace | Udaipur | 3188331 | no | Luxury room lake view double bed | 1004.6793711340207 | Luxury room lake view double bed | 1004.6793711340207 | PASS |
| 14 | Taj Lake Palace | Udaipur | 3188331 | no | Luxury room garden non -lake view double | 968.0567938144329 | Luxury room garden non -lake view double | 968.0567938144329 | PASS |
| 15 | Taj Amer | Jaipur | 4817762 | no | Deluxe Room King Bed | 209.96944329896908 | Deluxe Room King Bed | 209.96944329896908 | PASS |
| 16 | Taj Amer | Jaipur | 4817762 | no | Luxury Room King Bed | 234.38449484536082 | Luxury Room King Bed | 234.38449484536082 | PASS |
| 17 | Taj Krishna | Hyderabad | 3189160 | no | Luxury king bed room | 208.41763917525776 | Luxury king bed room | 208.41763917525776 | PASS |
| 18 | Taj Krishna | Hyderabad | 3189160 | no | Taj club king bed room | 268.8448917525773 | Taj club king bed room | 268.8448917525773 | PASS |
| 19 | Taj West End | Bengaluru | 3188433 | no | Luxury room heritage wing | 274.6693298969072 | Luxury room heritage wing | 274.6693298969072 | PASS |
| 20 | Taj West End | Bengaluru | 3188433 | no | luxury rom garden view | 286.8768556701031 | luxury rom garden view | 286.8768556701031 | PASS |
| 21 | ITC Maratha | Mumbai | 3244738 | no | Executive Club, Guest room, King, City v | 189.21664948453608 | Executive Club | 189.21664948453608 | PASS |
| 22 | ITC Maratha | Mumbai | 3244738 | no | Towers, Club lounge access, Guest room,  | 213.63170103092784 | Towers | 213.63170103092784 | PASS |
| 23 | ITC Grand Central | Mumbai | 3247574 | no | Executive Club, Guest room, Queen, City  | 244.15051546391751 | Executive Club | 244.15051546391751 | PASS |
| 24 | ITC Grand Central | Mumbai | 3247574 | no | Run of The House, Guest room, Queen, Mum | 292.980618556701 | Run of The House | 292.980618556701 | PASS |
| 25 | ITC Maurya | New Delhi | 3248222 | 0 | Executive Club Exclusive, Club level, Gu | 347.9144845360824 | Executive Club Exclusive | 347.9144845360824 | PASS |
| 26 | ITC Maurya | New Delhi | 3248222 | 0 | Towers double | 378.43329896907215 | Towers double | 378.43329896907215 | PASS |
| 27 | ITC Grand Bharat | Gurugram | 2819563 | 0 | Luxury Suite, 1 Bedroom 2 room Suite, 1  | 408.9521134020618 | Luxury Suite | 408.9521134020618 | PASS |
| 28 | ITC Grand Bharat | Gurugram | 2819563 | 0 | Deluxe suite with Gazebo, 1 Bedroom 2 ro | 360.1220103092783 | Deluxe suite with Gazebo | 360.1220103092783 | PASS |
| 29 | ITC Grand Chola | Chennai | 3244698 | no | Executive Club, Executive Club Double | 274.6693298969072 | Executive Club | 274.6693298969072 | PASS |
| 30 | ITC Grand Chola | Chennai | 3244698 | no | Towers, Towers Double | 305.1881443298969 | Towers | 305.1881443298969 | PASS |
| 31 | ITC Gardenia | Bengaluru | 3248713 | no | Towers Exclusive, Guest room, 1 Queen, B | 280.77309278350515 | Towers Exclusive | 280.77309278350515 | PASS |
| 32 | ITC Gardenia | Bengaluru | 3248713 | no | ITC One, Luxury Hours, Club level, Guest | 329.6031958762887 | ITC One | 329.6031958762887 | PASS |
| 33 | ITC Windsor | Bengaluru | 3247312 | no | The Towers, Guest room, 1 Queen or Twin | 207.52793814432994 | The Towers | 207.52793814432994 | PASS |
| 34 | ITC Windsor | Bengaluru | 3247312 | no | Run of the House, Guest room, Queen | 219.73546391752578 | Run of the House | 219.73546391752578 | PASS |
| 35 | ITC Kakatiya | Hyderabad | 3038603 | no | ITC One, Club lounge access, Guest room, | 244.15051546391751 | ITC One | 244.15051546391751 | PASS |
| 36 | ITC Kakatiya | Hyderabad | 3038603 | no | Run Of The House, Guest room, 1 Queen or | 183.11288659793814 | Run Of The House | 183.11288659793814 | PASS |
| 37 | ITC Kohenur | Hyderabad | 3808150 | no | Executive Club, Guest room, 1 Queen, Cit | 268.5655670103093 | Executive Club | 268.5655670103093 | PASS |
| 38 | ITC Kohenur | Hyderabad | 3808150 | no | Towers, Club lounge access, Guest room,  | 317.39567010309275 | Towers | 317.39567010309275 | PASS |
| 39 | ITC Rajputana | Jaipur | 3248671 | no | Executive Club Exclusive, Rajputana Cham | 189.21664948453608 | Executive Club Exclusive | 189.21664948453608 | PASS |
| 40 | ITC Rajputana | Jaipur | 3248671 | no | Executive Club, Executive Club Double | 170.90536082474227 | Executive Club | 170.90536082474227 | PASS |
| 41 | The Oberoi, Mumbai | Mumbai | 3191611 | no | Premier Room | 415.0558762886599 | Premier Room | 415.0558762886599 | PASS |
| 42 | The Oberoi, Mumbai | Mumbai | 3191611 | no | Luxury Bay View Rooms | 476.09350515463916 | Luxury Bay View Rooms | 476.09350515463916 | PASS |
| 43 | The Oberoi, New Delhi | New Delhi | 3186820 | 0 | The Oberoi Suite | 1220.7525773195875 | The Oberoi Suite | 1220.7525773195875 | PASS |
| 44 | The Oberoi, New Delhi | New Delhi | 3186820 | 0 | Deluxe Suite | 2441.505154639175 | Deluxe Suite | 2441.505154639175 | PASS |
| 45 | The Oberoi, Bengaluru | Bengaluru | 3191787 | no | Deluxe Suite with Private Balcony | 1220.7525773195875 | Deluxe Suite with Private Balcony | 1220.7525773195875 | PASS |
| 46 | The Oberoi, Bengaluru | Bengaluru | 3191787 | no | Luxury Room with Private Balcony | 500.5085567010309 | Luxury Room with Private Balcony | 500.5085567010309 | PASS |
| 47 | The Oberoi, Gurgaon | Gurugram | 3282559 | 0 | Luxury Room | 567.6499484536082 | Luxury Room | 567.6499484536082 | PASS |
| 48 | The Oberoi, Gurgaon | Gurugram | 3282559 | 0 | Premier Room | 616.4800515463918 | Premier Room | 616.4800515463918 | PASS |
| 49 | The Oberoi Amarvilas | Agra | 3191786 | no | Premier Room with Balcony | 1611.3934020618558 | Premier Room with Balcony | 1611.3934020618558 | PASS |
| 50 | The Oberoi Amarvilas | Agra | 3191786 | no | Deluxe Suite | 2136.3170103092784 | Deluxe Suite | 2136.3170103092784 | PASS |
| 51 | The Oberoi Rajvilas | Jaipur | 3191620 | no | Premier Room | 1245.1676288659794 | Premier Room | 1245.1676288659794 | PASS |
| 52 | The Oberoi Rajvilas | Jaipur | 3191620 | no | Premier Room with Private Garden | 1336.7240721649482 | Premier Room with Private Garden | 1336.7240721649482 | PASS |
| 53 | The Oberoi Udaivilas | Udaipur | 3191593 | no | Premier Room | 634.7913402061855 | Premier Room | 634.7913402061855 | PASS |
| 54 | The Oberoi Udaivilas | Udaipur | 3191593 | no | Premier Pool View Room | 872.8380927835051 | Premier Pool View Room | 872.8380927835051 | PASS |
| 55 | The Oberoi Vanyavilas | Ranthambhore | 3191811 | no | Luxury Tent | 1648.0159793814432 | Luxury Tent | 1648.0159793814432 | PASS |
| 56 | The Oberoi Vanyavilas | Ranthambhore | 3191811 | no | Luxury Tent with Private Pool | 1770.091237113402 | Luxury Tent with Private Pool | 1770.091237113402 | PASS |
| 57 | The Oberoi Cecil | Shimla | 3191568 | no | Deluxe Room | 335.7069587628866 | Deluxe Room | 335.7069587628866 | PASS |
| 58 | The Oberoi Cecil | Shimla | 3191568 | no | Luxury Room | 347.9144845360824 | Luxury Room | 347.9144845360824 | PASS |