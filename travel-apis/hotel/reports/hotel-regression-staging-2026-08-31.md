# Hotel B2B regression — https://api-staging.travelvip.ai

**For:** Partner B2B APIs (pre-deploy)
**QA:** TravelVIP API Automation
**Ran at:** 2026-08-31T10:17:15.750Z
**Tags:** CHAINBRANDVAL

## Score

| PASS | BUG | NOT TESTED | Total |
|-----:|----:|-----------:|------:|
| 111 | 0 | 0 | 111 |

| Tag | PASS | BUG | NOT TESTED | Total |
|-----|-----:|----:|-----------:|------:|
| CHAINBRANDVAL | 111 | 0 | 0 | 111 |

## Environment

| Field | Value |
|-------|-------|
| Base URL | `https://api-staging.travelvip.ai` |
| Correlation ID | `88232e0f-b8b4-4d6b-8592-02018fc2e1ce` |
| Booking BR | `—` |
| Booking status | — |
| Elapsed | 43430 ms |

## CHAINBRANDVAL

Score: PASS **111** / BUG **0** / NOT TESTED **0**

| # | Rule | How tested | Status |
|---|------|------------|--------|
| 1 | CBV-Taj | fq Chain/Brand Taj on city with Taj inventory (Delhi Chain=Taj Hotels) | **PASS** |
| 2 | CBV-Fab | fq Chain Fabhotels on Delhi/Mumbai (Delhi Chain=Fabhotels) | **PASS** |
| 3 | CBV-Treebo | fq Chain Treebo Hotels (Delhi Chain=Treebo Hotels) | **PASS** |
| 4 | CBV-ZUZU | fq Brand ZUZU HS where facet exists (Delhi Brand=ZUZU HS) | **PASS** |
| 5 | Delhi: Chain="Preferred" results belong to that chain | fq Chain:[Preferred] sample up to 2 hotels | **PASS** |
| 6 | Delhi: Chain="YourRentals" results belong to that chain | fq Chain:[YourRentals] sample up to 8 hotels | **PASS** |
| 7 | Delhi: Chain="Taj Hotels" results belong to that chain | fq Chain:[Taj Hotels] sample up to 6 hotels | **PASS** |
| 8 | Delhi: Chain="The Leading Hotels of the World" results belong to that chain | fq Chain:[The Leading Hotels of the World] sample up to 2 hotels | **PASS** |
| 9 | Delhi: Chain="Moustache" results belong to that chain | fq Chain:[Moustache] sample up to 1 hotels | **PASS** |
| 10 | Delhi: Chain="Fabhotels" results belong to that chain | fq Chain:[Fabhotels] sample up to 40 hotels | **PASS** |
| 11 | Delhi: Chain="Treebo Hotels" results belong to that chain | fq Chain:[Treebo Hotels] sample up to 13 hotels | **PASS** |
| 12 | Delhi: Brand="Orion Hotel Group" results belong to that brand | fq Brand:[Orion Hotel Group] sample up to 1 hotels | **PASS** |
| 13 | Delhi: Brand="SAROVAR" results belong to that brand | fq Brand:[SAROVAR] sample up to 4 hotels | **PASS** |
| 14 | Delhi: Brand="Oberoi Hotels & Resorts" results belong to that brand | fq Brand:[Oberoi Hotels & Resorts] sample up to 2 hotels | **PASS** |
| 15 | Delhi: Brand="Lemon Tree" results belong to that brand | fq Brand:[Lemon Tree] sample up to 3 hotels | **PASS** |
| 16 | Delhi: Brand="Hyatt Hotels" results belong to that brand | fq Brand:[Hyatt Hotels] sample up to 1 hotels | **PASS** |
| 17 | Delhi: Brand="Fabhotels" results belong to that brand | fq Brand:[Fabhotels] sample up to 40 hotels | **PASS** |
| 18 | Delhi: Brand="ZUZU HS" results belong to that brand | fq Brand:[ZUZU HS] sample up to 15 hotels | **PASS** |
| 19 | Mumbai: Chain="Radisson Hotel Group" results belong to that chain | fq Chain:[Radisson Hotel Group] sample up to 3 hotels | **PASS** |
| 20 | Mumbai: Chain="The LaLit" results belong to that chain | fq Chain:[The LaLit] sample up to 1 hotels | **PASS** |
| 21 | Mumbai: Chain="Marriott International" results belong to that chain | fq Chain:[Marriott International] sample up to 15 hotels | **PASS** |
| 22 | Mumbai: Chain="Oberoi Hotels & Resorts" results belong to that chain | fq Chain:[Oberoi Hotels & Resorts] sample up to 3 hotels | **PASS** |
| 23 | Mumbai: Chain="Hyatt Hotels" results belong to that chain | fq Chain:[Hyatt Hotels] sample up to 2 hotels | **PASS** |
| 24 | Mumbai: Chain="Fabhotels" results belong to that chain | fq Chain:[Fabhotels] sample up to 40 hotels | **PASS** |
| 25 | Mumbai: Brand="ibis" results belong to that brand | fq Brand:[ibis] sample up to 3 hotels | **PASS** |
| 26 | Mumbai: Brand="ZUZU HS" results belong to that brand | fq Brand:[ZUZU HS] sample up to 9 hotels | **PASS** |
| 27 | Mumbai: Brand="Four Seasons" results belong to that brand | fq Brand:[Four Seasons] sample up to 1 hotels | **PASS** |
| 28 | Mumbai: Brand="SAROVAR" results belong to that brand | fq Brand:[SAROVAR] sample up to 1 hotels | **PASS** |
| 29 | Mumbai: Brand="Radisson" results belong to that brand | fq Brand:[Radisson] sample up to 2 hotels | **PASS** |
| 30 | Mumbai: Brand="Fabhotels" results belong to that brand | fq Brand:[Fabhotels] sample up to 40 hotels | **PASS** |
| 31 | Mumbai: Brand="Treebo Hotels" results belong to that brand | fq Brand:[Treebo Hotels] sample up to 10 hotels | **PASS** |
| 32 | Bangalore: Chain="Hyatt Hotels" results belong to that chain | fq Chain:[Hyatt Hotels] sample up to 2 hotels | **PASS** |
| 33 | Bangalore: Chain="ITC Hotels" results belong to that chain | fq Chain:[ITC Hotels] sample up to 1 hotels | **PASS** |
| 34 | Bangalore: Chain="JUSTA HOTELS" results belong to that chain | fq Chain:[JUSTA HOTELS] sample up to 2 hotels | **PASS** |
| 35 | Bangalore: Chain="Keys Hotels" results belong to that chain | fq Chain:[Keys Hotels] sample up to 1 hotels | **PASS** |
| 36 | Bangalore: Chain="Louvre Hotels" results belong to that chain | fq Chain:[Louvre Hotels] sample up to 8 hotels | **PASS** |
| 37 | Bangalore: Chain="Fabhotels" results belong to that chain | fq Chain:[Fabhotels] sample up to 40 hotels | **PASS** |
| 38 | Bangalore: Chain="Treebo Hotels" results belong to that chain | fq Chain:[Treebo Hotels] sample up to 40 hotels | **PASS** |
| 39 | Bangalore: Brand="Fabhotels" results belong to that brand | fq Brand:[Fabhotels] sample up to 40 hotels | **PASS** |
| 40 | Bangalore: Brand="DoubleTree" results belong to that brand | fq Brand:[DoubleTree] sample up to 2 hotels | **PASS** |
| 41 | Bangalore: Brand="BEST WESTERN" results belong to that brand | fq Brand:[BEST WESTERN] sample up to 1 hotels | **PASS** |
| 42 | Bangalore: Brand="Hyatt Hotels" results belong to that brand | fq Brand:[Hyatt Hotels] sample up to 1 hotels | **PASS** |
| 43 | Bangalore: Brand="Golden Tulip" results belong to that brand | fq Brand:[Golden Tulip] sample up to 1 hotels | **PASS** |
| 44 | Bangalore: Brand="Treebo Hotels" results belong to that brand | fq Brand:[Treebo Hotels] sample up to 40 hotels | **PASS** |
| 45 | Chennai: Chain="ZUZU HS" results belong to that chain | fq Chain:[ZUZU HS] sample up to 1 hotels | **PASS** |
| 46 | Chennai: Chain="Ascott" results belong to that chain | fq Chain:[Ascott] sample up to 2 hotels | **PASS** |
| 47 | Chennai: Chain="Hyatt Hotels" results belong to that chain | fq Chain:[Hyatt Hotels] sample up to 2 hotels | **PASS** |
| 48 | Chennai: Chain="Pride Hotels" results belong to that chain | fq Chain:[Pride Hotels] sample up to 1 hotels | **PASS** |
| 49 | Chennai: Chain="Accor" results belong to that chain | fq Chain:[Accor] sample up to 5 hotels | **PASS** |
| 50 | Chennai: Chain="Fabhotels" results belong to that chain | fq Chain:[Fabhotels] sample up to 40 hotels | **PASS** |
| 51 | Chennai: Chain="Treebo Hotels" results belong to that chain | fq Chain:[Treebo Hotels] sample up to 16 hotels | **PASS** |
| 52 | Chennai: Brand="Wyndham Hotels" results belong to that brand | fq Brand:[Wyndham Hotels] sample up to 2 hotels | **PASS** |
| 53 | Chennai: Brand="The Park" results belong to that brand | fq Brand:[The Park] sample up to 1 hotels | **PASS** |
| 54 | Chennai: Brand="Pride Hotels" results belong to that brand | fq Brand:[Pride Hotels] sample up to 1 hotels | **PASS** |
| 55 | Chennai: Brand="Somerset" results belong to that brand | fq Brand:[Somerset] sample up to 1 hotels | **PASS** |
| 56 | Chennai: Brand="Westin" results belong to that brand | fq Brand:[Westin] sample up to 1 hotels | **PASS** |
| 57 | Chennai: Brand="Fabhotels" results belong to that brand | fq Brand:[Fabhotels] sample up to 40 hotels | **PASS** |
| 58 | Chennai: Brand="Treebo Hotels" results belong to that brand | fq Brand:[Treebo Hotels] sample up to 16 hotels | **PASS** |
| 59 | Pune: Chain="Accor" results belong to that chain | fq Chain:[Accor] sample up to 2 hotels | **PASS** |
| 60 | Pune: Chain="Marriott International" results belong to that chain | fq Chain:[Marriott International] sample up to 10 hotels | **PASS** |
| 61 | Pune: Chain="Fabhotels" results belong to that chain | fq Chain:[Fabhotels] sample up to 40 hotels | **PASS** |
| 62 | Pune: Chain="Taj Hotels" results belong to that chain | fq Chain:[Taj Hotels] sample up to 1 hotels | **PASS** |
| 63 | Pune: Chain="IHG" results belong to that chain | fq Chain:[IHG] sample up to 1 hotels | **PASS** |
| 64 | Pune: Chain="Treebo Hotels" results belong to that chain | fq Chain:[Treebo Hotels] sample up to 28 hotels | **PASS** |
| 65 | Pune: Brand="Hyatt Regency" results belong to that brand | fq Brand:[Hyatt Regency] sample up to 1 hotels | **PASS** |
| 66 | Pune: Brand="Fairfield Inn" results belong to that brand | fq Brand:[Fairfield Inn] sample up to 1 hotels | **PASS** |
| 67 | Pune: Brand="Crowne Plaza" results belong to that brand | fq Brand:[Crowne Plaza] sample up to 1 hotels | **PASS** |
| 68 | Pune: Brand="Novotel" results belong to that brand | fq Brand:[Novotel] sample up to 1 hotels | **PASS** |
| 69 | Pune: Brand="DoubleTree" results belong to that brand | fq Brand:[DoubleTree] sample up to 1 hotels | **PASS** |
| 70 | Pune: Brand="Fabhotels" results belong to that brand | fq Brand:[Fabhotels] sample up to 40 hotels | **PASS** |
| 71 | Pune: Brand="Treebo Hotels" results belong to that brand | fq Brand:[Treebo Hotels] sample up to 26 hotels | **PASS** |
| 72 | Hyderabad: Chain="Preferred" results belong to that chain | fq Chain:[Preferred] sample up to 1 hotels | **PASS** |
| 73 | Hyderabad: Chain="Sarovar Hotels" results belong to that chain | fq Chain:[Sarovar Hotels] sample up to 2 hotels | **PASS** |
| 74 | Hyderabad: Chain="Belvilla" results belong to that chain | fq Chain:[Belvilla] sample up to 1 hotels | **PASS** |
| 75 | Hyderabad: Chain="Bloomrooms" results belong to that chain | fq Chain:[Bloomrooms] sample up to 2 hotels | **PASS** |
| 76 | Hyderabad: Chain="The Park" results belong to that chain | fq Chain:[The Park] sample up to 1 hotels | **PASS** |
| 77 | Hyderabad: Chain="Fabhotels" results belong to that chain | fq Chain:[Fabhotels] sample up to 40 hotels | **PASS** |
| 78 | Hyderabad: Chain="Treebo Hotels" results belong to that chain | fq Chain:[Treebo Hotels] sample up to 23 hotels | **PASS** |
| 79 | Hyderabad: Brand="Park Hyatt" results belong to that brand | fq Brand:[Park Hyatt] sample up to 1 hotels | **PASS** |
| 80 | Hyderabad: Brand="Lemon Tree" results belong to that brand | fq Brand:[Lemon Tree] sample up to 4 hotels | **PASS** |
| 81 | Hyderabad: Brand="Clarion" results belong to that brand | fq Brand:[Clarion] sample up to 1 hotels | **PASS** |
| 82 | Hyderabad: Brand="The Park" results belong to that brand | fq Brand:[The Park] sample up to 1 hotels | **PASS** |
| 83 | Hyderabad: Brand="BEST WESTERN" results belong to that brand | fq Brand:[BEST WESTERN] sample up to 1 hotels | **PASS** |
| 84 | Hyderabad: Brand="Fabhotels" results belong to that brand | fq Brand:[Fabhotels] sample up to 40 hotels | **PASS** |
| 85 | Hyderabad: Brand="Treebo Hotels" results belong to that brand | fq Brand:[Treebo Hotels] sample up to 23 hotels | **PASS** |
| 86 | Goa: Chain="Hilton Worldwide" results belong to that chain | fq Chain:[Hilton Worldwide] sample up to 1 hotels | **PASS** |
| 87 | Goa: Chain="Royal Orchid" results belong to that chain | fq Chain:[Royal Orchid] sample up to 1 hotels | **PASS** |
| 88 | Goa: Chain="Taj Hotels" results belong to that chain | fq Chain:[Taj Hotels] sample up to 3 hotels | **PASS** |
| 89 | Goa: Chain="Accor" results belong to that chain | fq Chain:[Accor] sample up to 2 hotels | **PASS** |
| 90 | Goa: Chain="Fabhotels" results belong to that chain | fq Chain:[Fabhotels] sample up to 5 hotels | **PASS** |
| 91 | Goa: Brand="Taj" results belong to that brand | fq Brand:[Taj] sample up to 1 hotels | **PASS** |
| 92 | Goa: Brand="ZUZU HS" results belong to that brand | fq Brand:[ZUZU HS] sample up to 1 hotels | **PASS** |
| 93 | Goa: Brand="Fabhotels" results belong to that brand | fq Brand:[Fabhotels] sample up to 4 hotels | **PASS** |
| 94 | Goa: Brand="ITC Hotels" results belong to that brand | fq Brand:[ITC Hotels] sample up to 1 hotels | **PASS** |
| 95 | Goa: Brand="Novotel" results belong to that brand | fq Brand:[Novotel] sample up to 1 hotels | **PASS** |
| 96 | Goa: Brand="marriott" results belong to that brand | fq Brand:[marriott] sample up to 2 hotels | **PASS** |
| 97 | Ahmedabad: Chain="Fabhotels" results belong to that chain | fq Chain:[Fabhotels] sample up to 13 hotels | **PASS** |
| 98 | Ahmedabad: Chain="Wyndham Hotels & Resorts" results belong to that chain | fq Chain:[Wyndham Hotels & Resorts] sample up to 2 hotels | **PASS** |
| 99 | Ahmedabad: Chain="Treebo Hotels" results belong to that chain | fq Chain:[Treebo Hotels] sample up to 7 hotels | **PASS** |
| 100 | Ahmedabad: Chain="Accor" results belong to that chain | fq Chain:[Accor] sample up to 1 hotels | **PASS** |
| 101 | Ahmedabad: Chain="Louvre Hotels" results belong to that chain | fq Chain:[Louvre Hotels] sample up to 2 hotels | **PASS** |
| 102 | Ahmedabad: Chain="Marriott International" results belong to that chain | fq Chain:[Marriott International] sample up to 7 hotels | **PASS** |
| 103 | Ahmedabad: Brand="Novotel" results belong to that brand | fq Brand:[Novotel] sample up to 1 hotels | **PASS** |
| 104 | Ahmedabad: Brand="ITC Hotels" results belong to that brand | fq Brand:[ITC Hotels] sample up to 2 hotels | **PASS** |
| 105 | Ahmedabad: Brand="Luxury Collection" results belong to that brand | fq Brand:[Luxury Collection] sample up to 1 hotels | **PASS** |
| 106 | Ahmedabad: Brand="Pride Hotels" results belong to that brand | fq Brand:[Pride Hotels] sample up to 2 hotels | **PASS** |
| 107 | Ahmedabad: Brand="DoubleTree" results belong to that brand | fq Brand:[DoubleTree] sample up to 1 hotels | **PASS** |
| 108 | Ahmedabad: Brand="Fabhotels" results belong to that brand | fq Brand:[Fabhotels] sample up to 12 hotels | **PASS** |
| 109 | Ahmedabad: Brand="Treebo Hotels" results belong to that brand | fq Brand:[Treebo Hotels] sample up to 5 hotels | **PASS** |
| 110 | CBV-Chain | Per city: 5 random chain facets; fq each; sample up to 40 results | **PASS** |
| 111 | CBV-Brand | Per city: 5 random brand facets; fq each; sample up to 40 results | **PASS** |

## Bugs for Dev

None this run.
