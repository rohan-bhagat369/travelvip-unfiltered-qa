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
| prebook | description | **25** | 0 | 5 |
| prebook | inclusion | **25** | 0 | 5 |
| prebook | exclusion | **0** | 25 | 5 |

## Per city

| City | Hotels | Det desc | Det incl | Det excl | Pre desc | Pre incl | Pre excl |
|------|--------|----------|----------|----------|----------|----------|----------|
| Hyderabad | 10 | 10/10 | 10/10 | 0/10 | 10/10 | 10/10 | 0/10 |
| Chennai | 10 | 10/10 | 10/10 | 0/10 | 6/10 | 6/10 | 0/10 |
| Pune | 10 | 10/10 | 10/10 | 0/10 | 9/10 | 9/10 | 0/10 |

## Details — properties always null or mixed

| Field | Present | Null/empty | Key missing | Pattern | Example present | Example null |
|-------|---------|------------|-------------|---------|-----------------|--------------|
| `hotel.amenities` | 28 | 2 | 0 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) | Mandakini Jaya International (39736131) |
| `hotel.checkInTime` | 2 | 28 | 0 | **MIXED** | Blue Diamond, Pune - IHCL SeleQtions (15403968) | Hyderabad Marriott Hotel & Convention Centre (39711473) |
| `hotel.checkOutTime` | 3 | 27 | 0 | **MIXED** | Hotel TARA International (38807316) | Hyderabad Marriott Hotel & Convention Centre (39711473) |
| `hotel.distance` | 0 | 30 | 0 | **ALWAYS_NULL_OR_EMPTY** |  | Hyderabad Marriott Hotel & Convention Centre (39711473) |
| `hotel.hotelReview` | 0 | 30 | 0 | **ALWAYS_NULL_OR_EMPTY** |  | Hyderabad Marriott Hotel & Convention Centre (39711473) |
| `hotel.price.priceReference` | 0 | 30 | 0 | **ALWAYS_NULL_OR_EMPTY** |  | Hyderabad Marriott Hotel & Convention Centre (39711473) |
| `hotel.refundableNotes` | 27 | 3 | 0 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) | Courtyard by Marriott Hyderabad (39692067) |
| `room.amenitiesIcon` | 25 | 5 | 0 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) | Hotel TARA International (38807316) |
| `room.benefitsIcon` | 28 | 2 | 0 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) | Mandakini Jaya International (39736131) |
| `room.bookingCondition` | 0 | 30 | 0 | **ALWAYS_NULL_OR_EMPTY** |  | Hyderabad Marriott Hotel & Convention Centre (39711473) |
| `room.cancelPolicies` | 29 | 1 | 0 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) | TAJ CLUB HOUSE (16319680) |
| `room.exclusion` | 0 | 30 | 0 | **ALWAYS_NULL_OR_EMPTY** |  | Hyderabad Marriott Hotel & Convention Centre (39711473) |
| `room.price.priceReference` | 0 | 30 | 0 | **ALWAYS_NULL_OR_EMPTY** |  | Hyderabad Marriott Hotel & Convention Centre (39711473) |
| `room.refundableNotes` | 26 | 4 | 0 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) | TAJ CLUB HOUSE (16319680) |

## Prebook — properties always null or mixed

| Field | Present | Null/empty | Key missing | Pattern | Example present | Example null |
|-------|---------|------------|-------------|---------|-----------------|--------------|
| `hotel.address` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `hotel.amenities` | 22 | 3 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) | RADISSON BLU HOTEL CHENNAI CITY CENTRE (39656269) |
| `hotel.available` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `hotel.bookingType` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `hotel.checkInTime` | 11 | 14 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) | Hyatt Place Hyderabad Banjara Hills (39666194) |
| `hotel.checkOutTime` | 11 | 14 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) | Hyatt Place Hyderabad Banjara Hills (39666194) |
| `hotel.city` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `hotel.country` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `hotel.countryCode` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `hotel.description` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `hotel.distance` | 0 | 25 | 5 | **ALWAYS_NULL_OR_EMPTY** |  | Hyderabad Marriott Hotel & Convention Centre (39711473) |
| `hotel.hotelReview` | 0 | 25 | 5 | **ALWAYS_NULL_OR_EMPTY** |  | Hyderabad Marriott Hotel & Convention Centre (39711473) |
| `hotel.id` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `hotel.isGSTClaimable` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `hotel.name` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `hotel.price.baseFare` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `hotel.price.convenienceFee` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `hotel.price.currency` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `hotel.price.currencyConversion` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `hotel.price.gstAmount` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `hotel.price.priceReference` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `hotel.price.taxes` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `hotel.price.totalAmount` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `hotel.rateConditions` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `hotel.refundable` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `hotel.refundableNotes` | 0 | 25 | 5 | **ALWAYS_NULL_OR_EMPTY** |  | Hyderabad Marriott Hotel & Convention Centre (39711473) |
| `hotel.starRating` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `hotel.tags` | 23 | 2 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) | NOVOTEL CHENNAI CHAMIERS ROAD (39671991) |
| `room.amenitiesIcon` | 0 | 25 | 5 | **ALWAYS_NULL_OR_EMPTY** |  | Hyderabad Marriott Hotel & Convention Centre (39711473) |
| `room.benefitsIcon` | 0 | 25 | 5 | **ALWAYS_NULL_OR_EMPTY** |  | Hyderabad Marriott Hotel & Convention Centre (39711473) |
| `room.bookingCondition` | 0 | 25 | 5 | **ALWAYS_NULL_OR_EMPTY** |  | Hyderabad Marriott Hotel & Convention Centre (39711473) |
| `room.cancelPolicies` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `room.exclusion` | 0 | 25 | 5 | **ALWAYS_NULL_OR_EMPTY** |  | Hyderabad Marriott Hotel & Convention Centre (39711473) |
| `room.inclusion` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `room.isCancellable` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `room.isGSTClaimable` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `room.isPANMandatory` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `room.isPassportMandatory` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `room.mealType` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `room.name` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `room.price.baseFare` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `room.price.convenienceFee` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `room.price.currency` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `room.price.currencyConversion` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `room.price.gstAmount` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `room.price.priceReference` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `room.price.taxes` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `room.price.totalAmount` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `room.refundable` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `room.refundableNotes` | 23 | 2 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) | NOVOTEL CHENNAI CHAMIERS ROAD (39671991) |
| `room.roomType` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |
| `room.title` | 25 | 0 | 5 | **MIXED** | Hyderabad Marriott Hotel & Convention Centre (39711473) |  |

## Hotels (description / inclusion / exclusion)

| # | City | Hotel | entityId | Det desc | Det incl | Det excl | Pre desc | Pre incl | Pre excl |
|---|------|-------|----------|----------|----------|----------|----------|----------|----------|
| 1 | Hyderabad | Hyderabad Marriott Hotel & Convention Centre | `39711473` | Y | Y | null | Y | Y | null |
| 2 | Hyderabad | Hyatt Place Hyderabad Banjara Hills | `39666194` | Y | Y | null | Y | Y | null |
| 3 | Hyderabad | Courtyard by Marriott Hyderabad | `39692067` | Y | Y | null | Y | Y | null |
| 4 | Hyderabad | Mercure Hyderabad KCP Hotel | `39973043` | Y | Y | null | Y | Y | null |
| 5 | Hyderabad | Hotel TARA International | `38807316` | Y | Y | null | Y | Y | null |
| 6 | Hyderabad | Royalton Hyderabad | `39613651` | Y | Y | null | Y | Y | null |
| 7 | Hyderabad | Mandakini Jaya International | `39736131` | Y | Y | null | Y | Y | null |
| 8 | Hyderabad | Lemon Tree Hotel Banjara Hills | `15745703` | Y | Y | null | Y | Y | null |
| 9 | Hyderabad | The Golkonda Hyderabad | `39755646` | Y | Y | null | Y | Y | null |
| 10 | Hyderabad | Best Western Ashoka | `39671779` | Y | Y | null | Y | Y | null |
| 11 | Chennai | TAJ CLUB HOUSE | `16319680` | Y | Y | null | N | N | N |
| 12 | Chennai | TAJ COROMANDEL | `39616184` | Y | Y | null | Y | Y | null |
| 13 | Chennai | RADISSON BLU HOTEL CHENNAI CITY CENTRE | `39656269` | Y | Y | null | Y | Y | null |
| 14 | Chennai | THE PARK CHENNAI | `15259403` | Y | Y | null | Y | Y | null |
| 15 | Chennai | AMBASSADOR PALLAVA | `39654787` | Y | Y | null | Y | Y | null |
| 16 | Chennai | HYATT REGENCY CHENNAI | `15339517` | Y | Y | null | N | N | N |
| 17 | Chennai | SOMERSET GREENWAYS CHENNAI | `39653620` | Y | Y | null | N | N | N |
| 18 | Chennai | PARK HYATT CHENNAI | `39645717` | Y | Y | null | N | N | N |
| 19 | Chennai | NOVOTEL CHENNAI CHAMIERS ROAD | `39671991` | Y | Y | null | Y | Y | null |
| 20 | Chennai | THE ACCORD METROPOLITAN | `39632518` | Y | Y | null | Y | Y | null |
| 21 | Pune | Sheraton Grand Pune Bund Garden Hotel | `39644515` | Y | Y | null | N | N | N |
| 22 | Pune | JW Marriott Hotel Pune | `15350438` | Y | Y | null | Y | Y | null |
| 23 | Pune | Crowne Plaza Pune City Centre | `39785387` | Y | Y | null | Y | Y | null |
| 24 | Pune | Blue Diamond, Pune - IHCL SeleQtions | `15403968` | Y | Y | null | Y | Y | null |
| 25 | Pune | Conrad Pune | `40007147` | Y | Y | null | Y | Y | null |
| 26 | Pune | E SQUARE THE FERN PUNE | `31638453` | Y | Y | null | Y | Y | null |
| 27 | Pune | The Pride Pune | `39610131` | Y | Y | null | Y | Y | null |
| 28 | Pune | Tarawade Clarks Inn | `39624786` | Y | Y | null | Y | Y | null |
| 29 | Pune | Best Western The Pride | `39872566` | Y | Y | null | Y | Y | null |
| 30 | Pune | Enrise By Sayaji Pune | `15149939` | Y | Y | null | Y | Y | null |