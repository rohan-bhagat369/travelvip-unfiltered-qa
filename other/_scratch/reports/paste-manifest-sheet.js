async (page) => {
  const executed = [
    ['Manifest and protection DB test', 'Database: travelx_migration_testing', 'Run date: 2026-09-28', 'Score: 3 PASS, 5 BUG, 1 PARTIAL, 5 NOT TESTED', '', '', '', '', ''],
    ['Devs: filter the Status column. PASS rows matched the smoke doc. BUG rows are the failures. NOT TESTED was not booked. Known C05 is protection age_group NULL and is called out in the Issues sheet.', '', '', '', '', '', '', '', ''],
    [],
    ['Test case ID', 'Service', 'Status', 'Booking ref', 'DB id', 'What we tested', 'Expected', 'Actual', 'DB tables'],
    ['T1', 'Lounge', 'PASS', 'BR1790584972465518', 'booking 1147, item 1100', '1 adult + 1 child lounge, after vendor callback', '2 manifest rows. Child age_group CHILD. Exactly 1 lead. Own vendor ref and QR per traveller.', 'Confirmed 2026-09-28 09:04:13. Lounge item 300 CONFIRMED, total Rs 6498.73. PAX1 Atul Ugale ADULT lead, vendor MS20260928BK3NKOP, QR yes. PAX2 Ridhish Ugale CHILD, vendor MS20260928BKCOWIV, QR yes.', 'booking, booking_item, booking_status_mapping, booking_passenger, booking_item_passenger'],
    ['T2', 'Cab', 'NOT TESTED', '', '', '1 adult cab', '1 manifest row. age_group ADULT and is_lead 1.', 'Not booked.', 'booking, booking_item, booking_item_passenger'],
    ['T3', 'Flight + all 3 add-ons', 'BUG', 'BR1790593661506511', 'booking 1158, items 1117-1120', 'One-way, 1 adult + 1 child, bag assure, delay care, trip concierge. Wait for airline confirm.', 'After confirm: flight 300. Bag assure 200 Pending. Delay care and concierge 300 Active. Same PNR on every cover.', 'Flight 1117 is 300 CONFIRMED (DEL-BLR) at 2026-09-28 11:09:46. Bag 1118 Rs 3000, delay 1119 Rs 1000, concierge 1120 Rs 300 stayed 120 payment_completed. pnr NULL. flight_number UNKNOWN. flight_journey empty. Protection age_group NULL (known C05). Header total Rs 24460 is the flight line only.', 'booking, booking_item, booking_status_mapping, flight_journey, booking_item_passenger, booking_item_bag_assure, booking_item_delay_care, booking_item_trip_concierge'],
    ['T4', 'Flight + add-ons, failed', 'BUG', 'BR1790593507605796', 'booking 1157, items 1113-1116', 'Same add-ons, ticket ends Failed', 'Flight Failed. Every add-on 500 Cancelled. None left at 120 or 300.', 'Flight 1113 is 400 FAILED. cancelled_at 2026-09-28 11:05:48. Bag 1114, delay 1115, concierge 1116 stayed 120 payment_completed. None moved to 500.', 'booking, booking_item, booking_status_mapping, booking_item_bag_assure, booking_item_delay_care, booking_item_trip_concierge'],
    ['T5', 'Flight round trip', 'BUG', 'BR1790594251815779', 'booking 1159, items 1121-1125', 'Round trip. Bag assure and delay care on onward and return.', 'Separate item per leg. Onward cover gets onward PNR. Return cover gets return PNR. Bag assure 200 Pending. Delay care 300 Active.', 'Flight 1121 is 300 CONFIRMED at 2026-09-28 11:20:13. Two bag_assure (1122, 1124) and two delay_care (1123, 1125) exist but all stayed 120. flight_journey empty. vendor_reference NULL.', 'booking, booking_item, booking_status_mapping, flight_journey, booking_item_passenger, booking_item_bag_assure, booking_item_delay_care'],
    ['T6', 'Flight, mixed price', 'NOT TESTED', '', '', '2 adults. Bag assure paid for traveller 1 only.', 'One bag_assure item. Total charges only the paying traveller. Both travellers on the manifest.', 'Not booked.', 'booking, booking_item, booking_item_bag_assure, booking_item_passenger'],
    ['T7', 'Flight, replayed callback', 'NOT TESTED', '', '', 'Confirmed delay care, then the same CONFIRMED callback sent twice.', 'Second callback must not change status.', 'UI cannot send the replay. Not booked.', 'booking, booking_item, booking_item_delay_care'],
    ['T8', 'Fast track', 'PASS', 'BR1790589689393047', 'booking 1151, item 1104', '2 travellers, after vendor callback', '2 manifest rows, 1 lead, vendor ref and QR per traveller, age_group filled.', 'Confirmed. fast_track 300 CONFIRMED, total Rs 9450.95. PAX1 Atul Ugale ADULT lead, vendor MS20260928BL1BGQ0, QR yes. PAX2 Rohan Bhagat ADULT, vendor MS20260928BLX8G0A, QR yes.', 'booking, booking_item, booking_status_mapping, booking_passenger, booking_item_passenger'],
    ['T9', 'eSIM', 'PASS', 'BR1790592551455819', 'booking 1155, item 1111', '1 traveller, after vendor update', 'Exactly 1 manifest row and 1 lead.', 'Confirmed 2026-09-28 10:49:23. esim 300 CONFIRMED, total Rs 257.89. PAX1 Atul Ugale ADULT is_lead 1. Vendor ref, QR, and valid_from are empty. T9 does not require them.', 'booking, booking_item, booking_status_mapping, booking_passenger, booking_item_passenger'],
    ['T10', 'Porter', 'NOT TESTED', '', '', 'Porter with the travellers the UI allows', '1 manifest row per traveller, 1 lead.', 'Not booked.', 'booking, booking_item, booking_item_passenger'],
    ['T11', 'Hotel', 'BUG', '1790592811588745', 'hotel_bookings 1462', '1 room, 2 guests', 'A row in booking. Both guests on booking_item_passenger. room_index still on booking_passenger.', 'Only hotel_bookings id 1462. Voucher Successful, confirmation 874729010, 1 room, fare 182.37, check-in 2026-10-02. booking has 0 rows. No manifest and no room_index.', 'hotel_bookings, booking, booking_item, booking_passenger, booking_item_passenger'],
    ['T12', 'Attractions', 'NOT TESTED', '', '', 'Attraction booked as a quantity', 'No manifest rows. That is correct. C02 is N/A.', 'Not booked.', 'booking, booking_item, booking_item_passenger'],
    ['T3a', 'Flight + add-ons, checkout only', 'PARTIAL', 'BR1790591615251208', 'booking 1154, items 1107-1110', 'One-way, 2 pax, all 3 add-ons paid. Checked before airline confirm.', 'At checkout, 4 items exist and add-ons are 120 payment_completed. PNR checks wait for confirm.', 'Items and manifest were written. Flight 1107 still 200 Pending. Add-ons 1108-1110 stayed 120. Protection age_group NULL (known C05). PAX2 DOB 2024-10-18 stored as CHILD. Header total Rs 20059 is the flight line only.', 'booking, booking_item, booking_status_mapping, booking_item_passenger, booking_item_bag_assure, booking_item_delay_care, booking_item_trip_concierge'],
    ['T0', 'Flight, add-ons not saved', 'BUG', 'BR1790590554279914', 'flight item 1106', 'One-way, 2 pax, add-ons expected', 'Flight plus the three add-on items.', 'Only the flight item, status 200 Pending. No add-on items, no journey, no PNR. PAX2 DOB 2024-10-18 stored as CHILD.', 'booking, booking_item, flight_journey, booking_item_passenger, booking_item_bag_assure, booking_item_delay_care, booking_item_trip_concierge'],
  ];

  const issues = [
    ['Issues for developers', 'Database: travelx_migration_testing', '28 Sep 2026', 'Passed cases T1, T8, T9 are not listed here.', '', ''],
    [],
    ['Test case ID', 'Booking ref', 'Issue', 'Expected', 'Actual', 'DB tables'],
    ['T0', 'BR1790590554279914', 'Add-ons were not written', 'Flight plus bag assure, delay care, and trip concierge, each with a manifest', 'Only the flight item 1106, status 200 Pending. No add-on items and no flight_journey.', 'booking, booking_item, booking_item_bag_assure, booking_item_delay_care, booking_item_trip_concierge, flight_journey'],
    ['T0, T3a', 'BR1790590554279914, BR1790591615251208', 'Traveller under 2 stored as CHILD', 'age_group INFANT when date of birth is still under 2', 'PAX2 DOB 2024-10-18 stored as CHILD on the flight manifest.', 'booking_passenger, booking_item_passenger'],
    ['T3', 'BR1790593661506511', 'Confirmed flight did not activate add-ons or copy the PNR', 'Bag assure 200 Pending. Delay care and trip concierge 300 Active. Same airline PNR on every cover.', 'Flight item 1117 is 300 CONFIRMED. Bag 1118, delay 1119, and concierge 1120 stayed 120 payment_completed. pnr NULL, flight_number UNKNOWN, activated_at NULL. flight_journey has no rows.', 'booking, booking_item, booking_status_mapping, flight_journey, booking_item_bag_assure, booking_item_delay_care, booking_item_trip_concierge'],
    ['T4', 'BR1790593507605796', 'Failed flight did not cancel the add-ons', 'Flight Failed, and every add-on 500 Cancelled.', 'Flight item 1113 is 400 FAILED. Bag 1114, delay 1115, and concierge 1116 stayed 120 payment_completed.', 'booking, booking_item, booking_status_mapping, booking_item_bag_assure, booking_item_delay_care, booking_item_trip_concierge'],
    ['T5', 'BR1790594251815779', 'Round-trip confirm did not activate each leg or copy that leg PNR', 'Onward cover gets the onward PNR. Return cover gets the return PNR. Bag assure 200 Pending. Delay care 300 Active.', 'Flight 1121 is 300 CONFIRMED. Two bag_assure (1122, 1124) and two delay_care (1123, 1125) stayed 120. flight_journey has no rows. vendor_reference NULL.', 'booking, booking_item, booking_status_mapping, flight_journey, booking_item_passenger, booking_item_bag_assure, booking_item_delay_care'],
    ['T3, T3a, T4, T5', 'BR1790593661506511, BR1790591615251208, BR1790593507605796, BR1790594251815779', 'Known C05: protection manifest has no age group', 'age_group is ADULT, CHILD, or INFANT on every add-on row.', 'age_group is NULL on bag assure, delay care, and trip concierge. Flight rows are filled.', 'booking_item_passenger'],
    ['T3, T3a, T4, T5', 'BR1790593661506511, BR1790591615251208, BR1790593507605796, BR1790594251815779', 'Booking header total is the flight line only', 'The smoke doc scores each item total. The header was observed without the add-on amounts.', 'booking.total_amount equals the flight item. Add-on money is only on booking_item.total_amount (about Rs 4300 on T3, T3a, and T4; Rs 4000 on T5).', 'booking, booking_item'],
    ['T11', '1790592811588745', 'Hotel did not write the shared manifest', 'A booking row, both guests on the manifest, room_index still on booking_passenger.', 'Only hotel_bookings id 1462 (voucher, confirmation 874729010). booking has 0 rows for this reference.', 'hotel_bookings, booking, booking_item, booking_passenger, booking_item_passenger'],
  ];

  const toTsv = (rows) => rows.map((r) => r.map((c) => String(c ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ')).join('\t')).join('\n');

  async function paste(text) {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(async (value) => {
      await navigator.clipboard.writeText(value);
    }, text);
    await page.keyboard.press('Control+Home');
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+v');
    await page.waitForTimeout(1500);
  }

  await paste(toTsv(executed));
  await page.getByRole('button', { name: 'Add Sheet' }).click();
  await page.waitForTimeout(800);
  await paste(toTsv(issues));
  return 'pasted executed and issues';
}
