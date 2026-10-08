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
| Dubai | 10 | 10/10 | 10/10 | 0/10 | 8/10 | 8/10 | 0/10 |
| Singapore | 10 | 10/10 | 10/10 | 0/10 | 9/10 | 9/10 | 0/10 |
| Bangkok | 10 | 10/10 | 10/10 | 0/10 | 8/10 | 8/10 | 0/10 |

## Details — properties always null or mixed

| Field | Present | Null/empty | Key missing | Pattern | Example present | Example null |
|-------|---------|------------|-------------|---------|-----------------|--------------|
| `hotel.checkInTime` | 1 | 29 | 0 | **MIXED** | Hyatt Place Wasl District Residences (60466771) | Hyatt Regency Dubai (38688667) |
| `hotel.checkOutTime` | 1 | 29 | 0 | **MIXED** | Hyatt Place Wasl District Residences (60466771) | Hyatt Regency Dubai (38688667) |
| `hotel.distance` | 0 | 30 | 0 | **ALWAYS_NULL_OR_EMPTY** |  | Hyatt Regency Dubai (38688667) |
| `hotel.hotelReview` | 0 | 30 | 0 | **ALWAYS_NULL_OR_EMPTY** |  | Hyatt Regency Dubai (38688667) |
| `hotel.price.priceReference` | 0 | 30 | 0 | **ALWAYS_NULL_OR_EMPTY** |  | Hyatt Regency Dubai (38688667) |
| `hotel.refundableNotes` | 24 | 6 | 0 | **MIXED** | Hyatt Regency Dubai (38688667) | Aparthotel Adagio Dubai Deira (39606396) |
| `room.amenitiesIcon` | 28 | 2 | 0 | **MIXED** | Hyatt Regency Dubai (38688667) | Hyatt Place Wasl District Residences (60466771) |
| `room.bookingCondition` | 0 | 30 | 0 | **ALWAYS_NULL_OR_EMPTY** |  | Hyatt Regency Dubai (38688667) |
| `room.cancelPolicies` | 28 | 2 | 0 | **MIXED** | Hyatt Regency Dubai (38688667) | The Galleria Residence, Hyatt Regency Dubai (39961925) |
| `room.exclusion` | 0 | 30 | 0 | **ALWAYS_NULL_OR_EMPTY** |  | Hyatt Regency Dubai (38688667) |
| `room.price.priceReference` | 0 | 30 | 0 | **ALWAYS_NULL_OR_EMPTY** |  | Hyatt Regency Dubai (38688667) |
| `room.refundableNotes` | 8 | 22 | 0 | **MIXED** | Sheraton Dubai Creek Hotel & Towers (39600369) | Hyatt Regency Dubai (38688667) |

## Prebook — properties always null or mixed

| Field | Present | Null/empty | Key missing | Pattern | Example present | Example null |
|-------|---------|------------|-------------|---------|-----------------|--------------|
| `hotel.address` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `hotel.amenities` | 23 | 2 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) | Hyatt Place Wasl District Residences (60466771) |
| `hotel.available` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `hotel.bookingType` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `hotel.checkInTime` | 1 | 24 | 5 | **MIXED** | Frasers House, a Luxury Collection Hotel, Singapore (39657263) | Hyatt Regency Dubai (38688667) |
| `hotel.checkOutTime` | 1 | 24 | 5 | **MIXED** | Frasers House, a Luxury Collection Hotel, Singapore (39657263) | Hyatt Regency Dubai (38688667) |
| `hotel.city` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `hotel.country` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `hotel.countryCode` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `hotel.description` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `hotel.distance` | 0 | 25 | 5 | **ALWAYS_NULL_OR_EMPTY** |  | Hyatt Regency Dubai (38688667) |
| `hotel.hotelReview` | 0 | 25 | 5 | **ALWAYS_NULL_OR_EMPTY** |  | Hyatt Regency Dubai (38688667) |
| `hotel.id` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `hotel.isGSTClaimable` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `hotel.name` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `hotel.price.baseFare` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `hotel.price.convenienceFee` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `hotel.price.currency` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `hotel.price.currencyConversion` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `hotel.price.gstAmount` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `hotel.price.priceReference` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `hotel.price.taxes` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `hotel.price.totalAmount` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `hotel.rateConditions` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `hotel.refundable` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `hotel.refundableNotes` | 0 | 25 | 5 | **ALWAYS_NULL_OR_EMPTY** |  | Hyatt Regency Dubai (38688667) |
| `hotel.starRating` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `hotel.tags` | 9 | 16 | 5 | **MIXED** | The Galleria Residence, Hyatt Regency Dubai (39961925) | Hyatt Regency Dubai (38688667) |
| `room.amenitiesIcon` | 0 | 25 | 5 | **ALWAYS_NULL_OR_EMPTY** |  | Hyatt Regency Dubai (38688667) |
| `room.benefitsIcon` | 0 | 25 | 5 | **ALWAYS_NULL_OR_EMPTY** |  | Hyatt Regency Dubai (38688667) |
| `room.bookingCondition` | 0 | 25 | 5 | **ALWAYS_NULL_OR_EMPTY** |  | Hyatt Regency Dubai (38688667) |
| `room.cancelPolicies` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `room.exclusion` | 0 | 25 | 5 | **ALWAYS_NULL_OR_EMPTY** |  | Hyatt Regency Dubai (38688667) |
| `room.inclusion` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `room.isCancellable` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `room.isGSTClaimable` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `room.isPANMandatory` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `room.isPassportMandatory` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `room.mealType` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `room.name` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `room.price.baseFare` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `room.price.convenienceFee` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `room.price.currency` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `room.price.currencyConversion` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `room.price.gstAmount` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `room.price.priceReference` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `room.price.taxes` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `room.price.totalAmount` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `room.refundable` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `room.refundableNotes` | 8 | 17 | 5 | **MIXED** | The Galleria Residence, Hyatt Regency Dubai (39961925) | Hyatt Regency Dubai (38688667) |
| `room.roomType` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |
| `room.title` | 25 | 0 | 5 | **MIXED** | Hyatt Regency Dubai (38688667) |  |

## Hotels (description / inclusion / exclusion)

| # | City | Hotel | entityId | Det desc | Det incl | Det excl | Pre desc | Pre incl | Pre excl |
|---|------|-------|----------|----------|----------|----------|----------|----------|----------|
| 1 | Dubai | Hyatt Regency Dubai | `38688667` | Y | Y | null | Y | Y | null |
| 2 | Dubai | The Galleria Residence, Hyatt Regency Dubai | `39961925` | Y | Y | null | Y | Y | null |
| 3 | Dubai | Sheraton Dubai Creek Hotel & Towers | `39600369` | Y | Y | null | Y | Y | null |
| 4 | Dubai | Swissotel Living Al Ghurair | `39969130` | Y | Y | null | N | N | N |
| 5 | Dubai | Swissotel Al Ghurair | `39969111` | Y | Y | null | Y | Y | null |
| 6 | Dubai | Hyatt Place Wasl District Residences | `60466771` | Y | Y | null | Y | Y | null |
| 7 | Dubai | Hyatt Place Dubai Wasl District | `39969134` | Y | Y | null | N | N | N |
| 8 | Dubai | Canopy by Hilton Dubai Al Seef | `39999172` | Y | Y | null | Y | Y | null |
| 9 | Dubai | Aparthotel Adagio Dubai Deira | `39606396` | Y | Y | null | Y | Y | null |
| 10 | Dubai | Crowne Plaza Dubai Jumeirah By IHG | `41261072` | Y | Y | null | Y | Y | null |
| 11 | Singapore | Fairmont Singapore | `39637357` | Y | Y | null | Y | Y | null |
| 12 | Singapore | Novotel Singapore Robertson Quay | `39641207` | Y | Y | null | Y | Y | null |
| 13 | Singapore | Maxwell Reserve Singapore, Autograph Collection | `39788153` | Y | Y | null | Y | Y | null |
| 14 | Singapore | Pullman Singapore Hill Street | `41638867` | Y | Y | null | Y | Y | null |
| 15 | Singapore | The Westin Singapore | `39640194` | Y | Y | null | Y | Y | null |
| 16 | Singapore | InterContinental Singapore Robertson Quay by IHG | `39356724` | Y | Y | null | Y | Y | null |
| 17 | Singapore | Sofitel Singapore City Centre | `39636779` | Y | Y | null | Y | Y | null |
| 18 | Singapore | JW Marriott Hotel Singapore South Beach | `39693758` | Y | Y | null | Y | Y | null |
| 19 | Singapore | Frasers House, a Luxury Collection Hotel, Singapore | `39657263` | Y | Y | null | Y | Y | null |
| 20 | Singapore | The Ritz-Carlton, Millenia Singapore | `39649621` | Y | Y | null | N | N | N |
| 21 | Bangkok | Four Points by Sheraton Bangkok Ploenchit Sukhumvit | `39660160` | Y | Y | null | Y | Y | null |
| 22 | Bangkok | DoubleTree by Hilton Bangkok Ploenchit | `39592347` | Y | Y | null | Y | Y | null |
| 23 | Bangkok | Hotel Muse Bangkok, Autograph Collection | `39692789` | Y | Y | null | Y | Y | null |
| 24 | Bangkok | Conrad Bangkok | `17196228` | Y | Y | null | N | N | N |
| 25 | Bangkok | Crowne Plaza Bangkok Lumpini Park by IHG | `39647341` | Y | Y | null | Y | Y | null |
| 26 | Bangkok | Mövenpick BDMS Wellness Resort Bangkok | `39283725` | Y | Y | null | Y | Y | null |
| 27 | Bangkok | Grand Hyatt Erawan Bangkok | `39650619` | Y | Y | null | N | N | N |
| 28 | Bangkok | Conrad Bangkok Residences | `39522554` | Y | Y | null | Y | Y | null |
| 29 | Bangkok | Novotel Bangkok Platinum Pratunam | `39526094` | Y | Y | null | Y | Y | null |
| 30 | Bangkok | Courtyard by Marriott Bangkok | `39658642` | Y | Y | null | Y | Y | null |