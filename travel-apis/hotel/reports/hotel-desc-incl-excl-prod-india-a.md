# Prod hotel description / inclusion / exclusion (details + prebook)

- Base: `https://api.travelvip.ai`
- Stay: **2026-10-15 → 2026-10-16**
- Flow: CITY search → HOTEL details → prebook. **No book.**
- Hotels checked: **30**

## Score

| API | Field | Present | Null/empty | Missing key |
|-----|-------|---------|------------|-------------|
| details | description | **30** | 0 | 0 |
| details | inclusion | **30** | 0 | 0 |
| details | exclusion | **0** | 30 | 0 |
| prebook | description | **19** | 0 | 11 |
| prebook | inclusion | **19** | 0 | 11 |
| prebook | exclusion | **0** | 19 | 11 |

## Per city

| City | Hotels | Det desc | Det incl | Det excl | Pre desc | Pre incl | Pre excl |
|------|--------|----------|----------|----------|----------|----------|----------|
| Mumbai | 10 | 10/10 | 10/10 | 0/10 | 7/10 | 7/10 | 0/10 |
| Delhi | 10 | 10/10 | 10/10 | 0/10 | 6/10 | 6/10 | 0/10 |
| Bengaluru | 10 | 10/10 | 10/10 | 0/10 | 6/10 | 6/10 | 0/10 |

## Details — properties always null or mixed

| Field | Present | Null/empty | Key missing | Pattern | Example present | Example null |
|-------|---------|------------|-------------|---------|-----------------|--------------|
| `hotel.checkInTime` | 1 | 29 | 0 | **MIXED** | Marriott Executive Apartments Bengaluru UB City (72331350) | Sofitel Mumbai BKC Hotel (39624369) |
| `hotel.checkOutTime` | 1 | 29 | 0 | **MIXED** | Marriott Executive Apartments Bengaluru UB City (72331350) | Sofitel Mumbai BKC Hotel (39624369) |
| `hotel.distance` | 0 | 30 | 0 | **ALWAYS_NULL_OR_EMPTY** |  | Sofitel Mumbai BKC Hotel (39624369) |
| `hotel.hotelReview` | 0 | 30 | 0 | **ALWAYS_NULL_OR_EMPTY** |  | Sofitel Mumbai BKC Hotel (39624369) |
| `hotel.price.priceReference` | 0 | 30 | 0 | **ALWAYS_NULL_OR_EMPTY** |  | Sofitel Mumbai BKC Hotel (39624369) |
| `hotel.refundableNotes` | 28 | 2 | 0 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) | Hyatt Centric Juhu Mumbai (41534276) |
| `room.amenitiesIcon` | 29 | 1 | 0 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) | Grand Hyatt Mumbai Hotel & Residences (39681377) |
| `room.bookingCondition` | 0 | 30 | 0 | **ALWAYS_NULL_OR_EMPTY** |  | Sofitel Mumbai BKC Hotel (39624369) |
| `room.cancelPolicies` | 28 | 2 | 0 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) | ITC Gardenia, a Luxury Collection Hotel, Bengaluru (39346139) |
| `room.exclusion` | 0 | 30 | 0 | **ALWAYS_NULL_OR_EMPTY** |  | Sofitel Mumbai BKC Hotel (39624369) |
| `room.price.priceReference` | 0 | 30 | 0 | **ALWAYS_NULL_OR_EMPTY** |  | Sofitel Mumbai BKC Hotel (39624369) |
| `room.refundableNotes` | 23 | 7 | 0 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) | Ibis Mumbai Bkc (71042622) |

## Prebook — properties always null or mixed

| Field | Present | Null/empty | Key missing | Pattern | Example present | Example null |
|-------|---------|------------|-------------|---------|-----------------|--------------|
| `hotel.address` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `hotel.amenities` | 16 | 3 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) | Taj Santacruz (39621191) |
| `hotel.available` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `hotel.bookingType` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `hotel.checkInTime` | 7 | 12 | 11 | **MIXED** | Ibis Mumbai Bkc (71042622) | Sofitel Mumbai BKC Hotel (39624369) |
| `hotel.checkOutTime` | 7 | 12 | 11 | **MIXED** | Ibis Mumbai Bkc (71042622) | Sofitel Mumbai BKC Hotel (39624369) |
| `hotel.city` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `hotel.country` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `hotel.countryCode` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `hotel.description` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `hotel.distance` | 0 | 19 | 11 | **ALWAYS_NULL_OR_EMPTY** |  | Sofitel Mumbai BKC Hotel (39624369) |
| `hotel.hotelReview` | 0 | 19 | 11 | **ALWAYS_NULL_OR_EMPTY** |  | Sofitel Mumbai BKC Hotel (39624369) |
| `hotel.id` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `hotel.isGSTClaimable` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `hotel.name` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `hotel.price.baseFare` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `hotel.price.convenienceFee` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `hotel.price.currency` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `hotel.price.currencyConversion` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `hotel.price.gstAmount` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `hotel.price.priceReference` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `hotel.price.taxes` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `hotel.price.totalAmount` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `hotel.rateConditions` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `hotel.refundable` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `hotel.refundableNotes` | 0 | 19 | 11 | **ALWAYS_NULL_OR_EMPTY** |  | Sofitel Mumbai BKC Hotel (39624369) |
| `hotel.starRating` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `hotel.tags` | 18 | 1 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) | Hyatt Centric Juhu Mumbai (41534276) |
| `room.amenitiesIcon` | 0 | 19 | 11 | **ALWAYS_NULL_OR_EMPTY** |  | Sofitel Mumbai BKC Hotel (39624369) |
| `room.benefitsIcon` | 0 | 19 | 11 | **ALWAYS_NULL_OR_EMPTY** |  | Sofitel Mumbai BKC Hotel (39624369) |
| `room.bookingCondition` | 0 | 19 | 11 | **ALWAYS_NULL_OR_EMPTY** |  | Sofitel Mumbai BKC Hotel (39624369) |
| `room.cancelPolicies` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `room.exclusion` | 0 | 19 | 11 | **ALWAYS_NULL_OR_EMPTY** |  | Sofitel Mumbai BKC Hotel (39624369) |
| `room.inclusion` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `room.isCancellable` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `room.isGSTClaimable` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `room.isPANMandatory` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `room.isPassportMandatory` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `room.mealType` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `room.name` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `room.price.baseFare` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `room.price.convenienceFee` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `room.price.currency` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `room.price.currencyConversion` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `room.price.gstAmount` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `room.price.priceReference` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `room.price.taxes` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `room.price.totalAmount` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `room.refundable` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `room.refundableNotes` | 15 | 4 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) | Ibis Mumbai Bkc (71042622) |
| `room.roomType` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |
| `room.title` | 19 | 0 | 11 | **MIXED** | Sofitel Mumbai BKC Hotel (39624369) |  |

## Hotels (description / inclusion / exclusion)

| # | City | Hotel | entityId | Det desc | Det incl | Det excl | Pre desc | Pre incl | Pre excl |
|---|------|-------|----------|----------|----------|----------|----------|----------|----------|
| 1 | Mumbai | Sofitel Mumbai BKC Hotel | `39624369` | Y | Y | null | Y | Y | null |
| 2 | Mumbai | Ibis Mumbai Bkc | `71042622` | Y | Y | null | Y | Y | null |
| 3 | Mumbai | ITC Maratha Mumbai, a Luxury Collection Hotel, Mumbai | `39659376` | Y | Y | null | Y | Y | null |
| 4 | Mumbai | Courtyard by Marriott Mumbai International Airport | `32799941` | Y | Y | null | Y | Y | null |
| 5 | Mumbai | Grand Hyatt Mumbai Hotel & Residences | `39681377` | Y | Y | null | N | N | N |
| 6 | Mumbai | Taj The Trees, Mumbai | `51117724` | Y | Y | null | Y | Y | null |
| 7 | Mumbai | Hyatt Centric Juhu Mumbai | `41534276` | Y | Y | null | Y | Y | null |
| 8 | Mumbai | JW Marriott Mumbai Sahar | `39691858` | Y | Y | null | N | N | N |
| 9 | Mumbai | Fairmont Mumbai | `70508694` | Y | Y | null | N | N | N |
| 10 | Mumbai | Taj Santacruz | `39621191` | Y | Y | null | Y | Y | null |
| 11 | Delhi | Le Meridien New Delhi | `39676544` | Y | Y | null | Y | Y | null |
| 12 | Delhi | Taj Mahal, New Delhi | `39645070` | Y | Y | null | N | N | N |
| 13 | Delhi | Taj Palace, New Delhi | `39811711` | Y | Y | null | N | N | N |
| 14 | Delhi | ITC Maurya, a Luxury Collection Hotel, New Delhi | `39707491` | Y | Y | null | Y | Y | null |
| 15 | Delhi | Novotel New Delhi City Centre | `70508700` | Y | Y | null | N | N | N |
| 16 | Delhi | The Connaught, New Delhi - IHCL SeleQtions | `39626509` | Y | Y | null | N | N | N |
| 17 | Delhi | Shangri-La Eros, New Delhi | `38415670` | Y | Y | null | Y | Y | null |
| 18 | Delhi | The Imperial New Delhi | `39658270` | Y | Y | null | Y | Y | null |
| 19 | Delhi | The Park New Delhi | `32502802` | Y | Y | null | Y | Y | null |
| 20 | Delhi | The Metropolitan Hotel and Spa New Delhi | `39503514` | Y | Y | null | Y | Y | null |
| 21 | Bengaluru | Taj West End | `39658767` | Y | Y | null | Y | Y | null |
| 22 | Bengaluru | The Ritz-Carlton, Bangalore | `39664223` | Y | Y | null | Y | Y | null |
| 23 | Bengaluru | ITC Gardenia, a Luxury Collection Hotel, Bengaluru | `39346139` | Y | Y | null | N | N | N |
| 24 | Bengaluru | Marriott Executive Apartments Bengaluru UB City | `72331350` | Y | Y | null | Y | Y | null |
| 25 | Bengaluru | JW Marriott Hotel Bengaluru | `39662155` | Y | Y | null | Y | Y | null |
| 26 | Bengaluru | Vivanta Bengaluru Residency Road | `32508303` | Y | Y | null | N | N | N |
| 27 | Bengaluru | Holiday Inn Bengaluru Racecourse by IHG | `39674317` | Y | Y | null | N | N | N |
| 28 | Bengaluru | ibis Bengaluru City Centre Hotel | `39628946` | Y | Y | null | Y | Y | null |
| 29 | Bengaluru | ITC Windsor, A Luxury Collection Hotel, Bengaluru | `39715735` | Y | Y | null | N | N | N |
| 30 | Bengaluru | Conrad Bengaluru | `15632957` | Y | Y | null | Y | Y | null |