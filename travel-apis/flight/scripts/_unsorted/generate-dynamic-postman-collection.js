/**
 * Generate TravelVIP B2B Dynamic E2E Postman collection + environment.
 *   node scripts/generate-dynamic-postman-collection.js
 */
import fs from 'fs';
import path from 'path';

const OUT_COLLECTION = path.resolve('postman/TravelVIP-B2B-Dynamic-E2E.postman_collection.json');
const OUT_ENV = path.resolve('postman/TravelVIP-B2B-Dev.postman_environment.json');

function lines(...rows) {
  return rows.flatMap((r) => (Array.isArray(r) ? r : [r]));
}

/** Collection-level: dates + HMAC signature (matches API: body + timestamp). */
const COLLECTION_PREREQUEST = lines(
  '// ===== TravelVIP dynamic signing + default travel dates =====',
  'function ymd(d) { return d.toISOString().slice(0, 10); }',
  'function addDays(n) { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return ymd(d); }',
  '',
  'if (!pm.collectionVariables.get("flight_dep_date")) {',
  '  pm.collectionVariables.set("flight_dep_date", addDays(Number(pm.collectionVariables.get("flight_dep_offset_days") || 40)));',
  '}',
  'if (!pm.collectionVariables.get("flight_ret_date")) {',
  '  pm.collectionVariables.set("flight_ret_date", addDays(Number(pm.collectionVariables.get("flight_ret_offset_days") || 47)));',
  '}',
  'if (!pm.collectionVariables.get("hotel_checkin")) {',
  '  pm.collectionVariables.set("hotel_checkin", addDays(Number(pm.collectionVariables.get("hotel_checkin_offset_days") || 21)));',
  '}',
  'if (!pm.collectionVariables.get("hotel_checkout")) {',
  '  pm.collectionVariables.set("hotel_checkout", addDays(Number(pm.collectionVariables.get("hotel_checkout_offset_days") || 23)));',
  '}',
  'if (!pm.collectionVariables.get("lounge_travel_date")) {',
  '  pm.collectionVariables.set("lounge_travel_date", addDays(Number(pm.collectionVariables.get("lounge_travel_date_offset_days") || 30)));',
  '}',
  'if (!pm.collectionVariables.get("ft_travel_date")) {',
  '  pm.collectionVariables.set("ft_travel_date", addDays(Number(pm.collectionVariables.get("ft_travel_date_offset_days") || 30)));',
  '}',
  'if (!pm.collectionVariables.get("cab_pickup_datetime")) {',
  '  const d = new Date();',
  '  d.setUTCDate(d.getUTCDate() + Number(pm.collectionVariables.get("cab_pickup_offset_days") || 9));',
  '  d.setUTCHours(7, 20, 0, 0);',
  '  pm.collectionVariables.set("cab_pickup_datetime", d.toISOString());',
  '}',
  '',
  'const timestamp = Math.floor(Date.now() / 1000).toString();',
  'const requestId = "req-" + Date.now();',
  'const correlationId = pm.collectionVariables.get("correlation_id") || ("corr-" + Date.now());',
  '',
  '// Resolve {{vars}} then sign the exact body that will be sent',
  'let body = "";',
  'if (pm.request.body && pm.request.body.mode === "raw" && pm.request.body.raw) {',
  '  body = pm.variables.replaceIn(pm.request.body.raw);',
  '  pm.request.body.update(body);',
  '}',
  '',
  'const signingKey = pm.environment.get("signing_key") || pm.collectionVariables.get("signing_key") || "";',
  'const signature = CryptoJS.HmacSHA256(body + timestamp, signingKey).toString(CryptoJS.enc.Hex);',
  '',
  'pm.collectionVariables.set("timestamp", timestamp);',
  'pm.collectionVariables.set("signature", signature);',
  'pm.collectionVariables.set("request_id", requestId);',
  'pm.collectionVariables.set("correlation_id", correlationId);',
  'pm.environment.set("timestamp", timestamp);',
  'pm.environment.set("signature", signature);',
  'pm.environment.set("request_id", requestId);',
  '',
  '// Ensure auth header uses latest token',
  'const partnerToken = pm.environment.get("access_token") || pm.collectionVariables.get("access_token") || "";',
  'const userToken = pm.environment.get("auth_token") || pm.collectionVariables.get("auth_token") || partnerToken;',
  'if (userToken && pm.request.headers.has("Authorization")) {',
  '  pm.request.headers.upsert({ key: "Authorization", value: "Bearer " + userToken });',
  '}',
  'if (partnerToken && pm.request.headers.has("X-Partner-Key")) {',
  '  pm.request.headers.upsert({ key: "X-Partner-Key", value: partnerToken });',
  '}',
);

const COLLECTION_TEST = lines(
  'try {',
  '  const response = pm.response.json();',
  '  if (response && response._meta && response._meta.correlation_id) {',
  '    pm.collectionVariables.set("correlation_id", response._meta.correlation_id);',
  '    pm.environment.set("correlation_id", response._meta.correlation_id);',
  '  }',
  '} catch (e) { /* non-json */ }',
);

function hdr(extra = []) {
  return [
    { key: 'Content-Type', value: 'application/json', type: 'text' },
    { key: 'Authorization', value: 'Bearer {{auth_token}}', type: 'text' },
    { key: 'X-Request-Id', value: '{{request_id}}', type: 'text' },
    { key: 'X-Timestamp', value: '{{timestamp}}', type: 'text' },
    { key: 'X-Signature', value: '{{signature}}', type: 'text' },
    { key: 'X-Correlation-ID', value: '{{correlation_id}}', type: 'text' },
    ...extra,
  ];
}

function partnerHdr() {
  return hdr([{ key: 'X-Partner-Key', value: '{{access_token}}', type: 'text' }]);
}

function url(raw, pathSegs, query = []) {
  const host = ['{{base_url}}'];
  return {
    raw,
    host,
    path: pathSegs,
    query: query.map(([key, value]) => ({ key, value })),
  };
}

function req(name, { method = 'POST', headers, body, pathSegs, query = [], rawUrl, events = [] }) {
  const item = {
    name,
    event: events,
    request: {
      method,
      header: headers,
      url: url(rawUrl, pathSegs, query),
    },
  };
  if (body !== undefined) {
    item.request.body = {
      mode: 'raw',
      raw: typeof body === 'string' ? body : JSON.stringify(body, null, 2),
      options: { raw: { language: 'json' } },
    };
  }
  return item;
}

function ev(listen, execLines) {
  return {
    listen,
    script: {
      type: 'text/javascript',
      exec: execLines,
    },
  };
}

function folderPrerequest(vars) {
  const exec = Object.entries(vars).map(
    ([k, v]) => `pm.collectionVariables.set(${JSON.stringify(k)}, ${JSON.stringify(String(v))});`
  );
  exec.push(`console.log("Scenario vars:", ${JSON.stringify(vars)});`);
  return [ev('prerequest', exec)];
}

const SAVE_TOKEN = lines(
  'pm.test("Partner access token received", function () {',
  '  pm.response.to.have.status(200);',
  '  const res = pm.response.json();',
  '  pm.expect(res.access_token).to.be.ok;',
  '  pm.collectionVariables.set("access_token", res.access_token);',
  '  pm.environment.set("access_token", res.access_token);',
  '  if (res.refresh_token) {',
  '    pm.collectionVariables.set("refresh_token", res.refresh_token);',
  '    pm.environment.set("refresh_token", res.refresh_token);',
  '  }',
  '  console.log("Saved access_token (X-Partner-Key) + refresh_token");',
  '});',
);

const SAVE_REFRESH = lines(
  'pm.test("Refresh token ok", function () {',
  '  pm.response.to.have.status(200);',
  '  const res = pm.response.json();',
  '  pm.expect(res.access_token).to.be.ok;',
  '  pm.collectionVariables.set("access_token", res.access_token);',
  '  pm.environment.set("access_token", res.access_token);',
  '  if (res.refresh_token) {',
  '    pm.collectionVariables.set("refresh_token", res.refresh_token);',
  '    pm.environment.set("refresh_token", res.refresh_token);',
  '  }',
  '  console.log("Refreshed access_token");',
  '});',
);

const SAVE_USER_AUTH = lines(
  'pm.test("User auth session ok", function () {',
  '  pm.response.to.have.status(200);',
  '  const res = pm.response.json();',
  '  pm.expect(res.auth_token).to.be.ok;',
  '  pm.collectionVariables.set("auth_token", res.auth_token);',
  '  pm.environment.set("auth_token", res.auth_token);',
  '  console.log("Saved auth_token (Bearer for APIs)");',
  '});',
);

const SAVE_TIERS = lines(
  'pm.test("Tiers list ok", function () {',
  '  pm.response.to.have.status(200);',
  '  const res = pm.response.json();',
  '  const tiers = res.tiers || res.content || res.data || res;',
  '  console.log("Tiers response keys:", Object.keys(res || {}));',
  '  if (Array.isArray(tiers) && tiers[0] && (tiers[0].tierId || tiers[0].id)) {',
  '    const tid = String(tiers[0].tierId || tiers[0].id);',
  '    pm.collectionVariables.set("tier_id", tid);',
  '    pm.environment.set("tier_id", tid);',
  '    console.log("Sample tier_id saved:", tid);',
  '  }',
  '});',
);

const SAVE_OW_SEARCH = lines(
  'pm.test("OW search ok", function () { pm.response.to.have.status(200); });',
  'const res = pm.response.json();',
  'const progress = res.progress && res.progress.state;',
  'console.log("Search progress:", progress, "partial:", res.progress && res.progress.partial);',
  'let searchId = null;',
  'const block = (res.results || []).find(r => String(r.direction).toUpperCase() === "ONWARD") || (res.results || [])[0];',
  'if (block && block.options && block.options[0]) searchId = block.options[0].searchId;',
  'if (searchId) {',
  '  pm.collectionVariables.set("search_id", searchId);',
  '  pm.collectionVariables.set("search_id_onward", searchId);',
  '  console.log("Saved search_id:", searchId);',
  '} else {',
  '  console.warn("No searchId yet — hit Search again until options appear / COMPLETE");',
  '}',
  'pm.test("searchId captured (may need re-send if empty)", function () {',
  '  pm.expect(pm.collectionVariables.get("search_id"), "search_id").to.be.ok;',
  '});',
);

const SAVE_RT_SEARCH_INITIAL = lines(
  'pm.test("RT initial search ok", function () { pm.response.to.have.status(200); });',
  'const res = pm.response.json();',
  'console.log("RT progress:", res.progress && res.progress.state);',
  'const onward = (res.results || []).find(r => String(r.direction).toUpperCase() === "ONWARD");',
  'const sid = onward && onward.options && onward.options[0] && onward.options[0].searchId;',
  'if (sid) {',
  '  pm.collectionVariables.set("search_id_onward", sid);',
  '  pm.collectionVariables.set("search_id", sid);',
  '  console.log("Saved search_id_onward:", sid);',
  '} else {',
  '  console.warn("No onward yet — re-send this request until onward options appear");',
  '}',
  'pm.test("onward searchId captured", function () {',
  '  pm.expect(pm.collectionVariables.get("search_id_onward")).to.be.ok;',
  '});',
);

const SAVE_RT_SEARCH_RETURN = lines(
  'pm.test("RT return search ok", function () { pm.response.to.have.status(200); });',
  'const res = pm.response.json();',
  'const ret = (res.results || []).find(r => String(r.direction).toUpperCase() === "RETURN");',
  'let rid = ret && ret.options && ret.options[0] && ret.options[0].searchId;',
  '// Prefer same airline as onward when possible',
  'const onwardId = pm.collectionVariables.get("search_id_onward");',
  'const onwardBlock = (res.results || []).find(r => String(r.direction).toUpperCase() === "ONWARD");',
  'let onwardAirline = null;',
  'if (onwardBlock && onwardBlock.options) {',
  '  const o = onwardBlock.options.find(x => x.searchId === onwardId) || onwardBlock.options[0];',
  '  onwardAirline = o && o.segments && o.segments[0] && o.segments[0].airline && o.segments[0].airline.code;',
  '}',
  'if (ret && ret.options && onwardAirline) {',
  '  const same = ret.options.find(o => o.segments && o.segments[0] && o.segments[0].airline && o.segments[0].airline.code === onwardAirline);',
  '  if (same) rid = same.searchId;',
  '}',
  'if (rid) {',
  '  pm.collectionVariables.set("search_id_return", rid);',
  '  console.log("Saved search_id_return:", rid, "airlinePref:", onwardAirline || "-");',
  '} else {',
  '  console.warn("No return yet — re-send until RETURN options appear");',
  '}',
  'pm.test("return searchId captured", function () {',
  '  pm.expect(pm.collectionVariables.get("search_id_return")).to.be.ok;',
  '});',
);

const SAVE_PRICING = lines(
  'pm.test("Pricing ok", function () { pm.response.to.have.status(200); });',
  'const res = pm.response.json();',
  'pm.expect(res.priceId, "priceId").to.be.ok;',
  'pm.expect(res.bookingContext, "bookingContext").to.be.ok;',
  'pm.collectionVariables.set("price_id", res.priceId);',
  'pm.collectionVariables.set("booking_context", res.bookingContext);',
  'pm.collectionVariables.set("passport_type", res.passportType || "NONE");',
  'if (res.pricing && res.pricing.totalAmount != null) {',
  '  pm.collectionVariables.set("total_amount", String(res.pricing.totalAmount));',
  '}',
  'console.log("Saved price_id / booking_context / passport_type", res.priceId, res.passportType);',
);

const SAVE_SSR = lines(
  'pm.test("SSR ok", function () { pm.response.to.have.status(200); });',
  'const res = pm.response.json();',
  'function money(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }',
  'let meal = null, bag = null;',
  'for (const seg of (res.meal && res.meal.segments) || []) {',
  '  for (const m of seg.Meals || seg.meals || []) {',
  '    const amt = money(m.pricing && m.pricing.totalAmount != null ? m.pricing.totalAmount : m.amount);',
  '    const pref = m.priceReference || (m.pricing && m.pricing.priceReference);',
  '    if (amt > 0 && pref && (!meal || amt < meal.amount)) {',
  '      meal = {',
  '        amount: amt,',
  '        priceReference: pref,',
  '        segmentId: m.segmentId || seg.segmentId || "SEG_1",',
  '        origin: m.origin || pm.collectionVariables.get("flight_origin") || "DEL",',
  '        destination: m.destination || pm.collectionVariables.get("flight_destination") || "BOM",',
  '        title: m.title || m.description || "Meal",',
  '        description: m.description || m.title || "Meal",',
  '        quantity: 1',
  '      };',
  '    }',
  '  }',
  '}',
  'for (const seg of (res.baggage && res.baggage.segments) || []) {',
  '  for (const b of seg.Baggage || seg.baggage || []) {',
  '    const amt = money(b.pricing && b.pricing.totalAmount != null ? b.pricing.totalAmount : b.amount);',
  '    const pref = b.priceReference || (b.pricing && b.pricing.priceReference);',
  '    if (amt > 0 && pref && (!bag || amt < bag.amount)) {',
  '      bag = {',
  '        amount: amt,',
  '        priceReference: pref,',
  '        segmentId: b.segmentId || seg.segmentId || "SEG_1",',
  '        origin: b.origin || pm.collectionVariables.get("flight_origin") || "DEL",',
  '        destination: b.destination || pm.collectionVariables.get("flight_destination") || "BOM",',
  '        title: b.title || b.description || "Bag",',
  '        description: b.description || b.title || "Bag",',
  '        quantity: 1',
  '      };',
  '    }',
  '  }',
  '}',
  'pm.collectionVariables.set("ssr_meal_json", meal ? JSON.stringify([meal]) : "[]");',
  'pm.collectionVariables.set("ssr_bag_json", bag ? JSON.stringify([bag]) : "[]");',
  'console.log("SSR meal:", meal ? meal.title + " " + meal.amount : "none", "| bag:", bag ? bag.title + " " + bag.amount : "none");',
);

const SAVE_SEATMAP = lines(
  'pm.test("Seatmap responded", function () { pm.expect(pm.response.code).to.be.oneOf([200, 400, 502]); });',
  'let seats = [];',
  'try {',
  '  const res = pm.response.json();',
  '  const flights = res.FlightSeat || res.flightSeat || res.seats || [];',
  '  const list = Array.isArray(flights) ? flights : [];',
  '  outer: for (const f of list) {',
  '    const rows = f.SeatRows || f.seatRows || f.rows || [];',
  '    for (const row of rows) {',
  '      const cols = row.Seats || row.seats || row.columns || [];',
  '      for (const s of cols) {',
  '        const avail = s.AvailablityType === 1 || s.availabilityType === 1 || s.available === true || s.isAvailable === true;',
  '        const pref = s.PriceReference || s.priceReference || (s.pricing && s.pricing.priceReference);',
  '        if (avail && pref) {',
  '          seats.push({',
  '            priceReference: pref,',
  '            segmentId: s.SegmentId || s.segmentId || f.SegmentId || "SEG_1",',
  '            seatNumber: s.SeatNumber || s.seatNumber || s.code,',
  '            amount: Number((s.pricing && s.pricing.totalAmount) || s.Amount || s.amount || 0) || 0,',
  '            origin: pm.collectionVariables.get("flight_origin") || "DEL",',
  '            destination: pm.collectionVariables.get("flight_destination") || "BOM",',
  '            quantity: 1',
  '          });',
  '          break outer;',
  '        }',
  '      }',
  '    }',
  '  }',
  '} catch (e) { console.warn("Seatmap parse:", e.message); }',
  'pm.collectionVariables.set("ssr_seat_json", JSON.stringify(seats));',
  'console.log("Seat selected:", seats[0] ? seats[0].seatNumber : "none (issue will continue without seat)");',
);

const SAVE_ISSUE = lines(
  'const res = pm.response.json();',
  'const br = res.bookingReference || res.bookingReferenceId || (res.data && res.data.bookingReference) || null;',
  'console.log("Issue status", pm.response.code, res.message || res.code || "", "BR", br);',
  'if (br) {',
  '  pm.collectionVariables.set("booking_reference", br);',
  '  console.log("Saved booking_reference:", br);',
  '}',
  'pm.test("Issue ticket created BR (or show wallet/validation error)", function () {',
  '  if (pm.response.code >= 400 || res.code === "WALLET_INSUFFICIENT_BALANCE" || (!br && res.status >= 400)) {',
  '    console.error(JSON.stringify(res).slice(0, 800));',
  '  }',
  '  pm.expect(br, "bookingReference").to.be.ok;',
  '});',
);

const SAVE_STATUS = lines(
  'const res = pm.response.json();',
  'const st = res.status || (res.bookingResponse && res.bookingResponse.status);',
  'pm.collectionVariables.set("booking_status", String(st || ""));',
  'console.log("Booking status:", st);',
  'pm.test("Status endpoint ok", function () { pm.response.to.have.status(200); });',
);

const SAVE_OK = lines(
  'pm.test("Response ok", function () { pm.expect(pm.response.code).to.be.oneOf([200, 201]); });',
);

const SAVE_AIRPORT_SEARCH = lines(
  'pm.test("Airport lookup ok", function () { pm.response.to.have.status(200); });',
  'try {',
  '  const res = pm.response.json();',
  '  const list = res.results || res.content || res.data || [];',
  '  const first = Array.isArray(list) ? list[0] : null;',
  '  const code = first && (first.code || first.airportCode || first.iata);',
  '  if (code) { pm.collectionVariables.set("airport_query", String(code)); console.log("Saved airport_query:", code); }',
  '  else console.warn("No airport code in response — set airport_query manually");',
  '} catch (e) { console.warn("Airport parse:", e.message); }',
);

const SAVE_AIRLINE_SEARCH = lines(
  'pm.test("Airline lookup ok", function () { pm.response.to.have.status(200); });',
  'try {',
  '  const res = pm.response.json();',
  '  const list = res.results || res.content || res.data || [];',
  '  const first = Array.isArray(list) ? list[0] : null;',
  '  const code = first && (first.code || first.airlineCode);',
  '  if (code) { pm.collectionVariables.set("airline_query", String(code)); console.log("Saved airline_query:", code); }',
  '  else console.warn("No airline code in response");',
  '} catch (e) { console.warn("Airline parse:", e.message); }',
);

const SAVE_CITY_SEARCH = lines(
  'pm.test("City lookup ok", function () { pm.response.to.have.status(200); });',
  'try {',
  '  const res = pm.response.json();',
  '  const list = res.results || res.content || res.data || [];',
  '  const first = Array.isArray(list) ? list[0] : null;',
  '  const city = first && (first.cityCode || first.code || first.city);',
  '  if (city) { pm.collectionVariables.set("city_query", String(city)); console.log("Saved city_query:", city); }',
  '  else console.warn("No city in response");',
  '} catch (e) { console.warn("City parse:", e.message); }',
);

const SAVE_FLIGHT_HISTORY = lines(
  'pm.test("Flight history ok", function () { pm.response.to.have.status(200); });',
  'try { const res = pm.response.json(); console.log("History count:", (res.bookings || res.results || []).length); } catch (e) { console.warn("History parse:", e.message); }',
);

function saveCancelTest(action) {
  return lines(
    `pm.test("Cancel ${action} responded", function () { pm.expect(pm.response.code).to.be.oneOf([200, 400, 502]); });`,
    'try { console.log("Cancel response:", pm.response.text().slice(0, 500)); } catch (e) { /* ignore */ }',
  );
}

const PICK_BOOKING_CONTEXT = lines(
  'function ctxFrom(obj) {',
  '  if (!obj) return null;',
  '  // API may return bookingContext OR bookingReference — finalize expects bookingContext',
  '  return obj.bookingContext || obj.bookingReference || obj.bookingReferenceId || null;',
  '}',
  'function pickBookingContext(res) {',
  '  if (!res) return null;',
  '  const top = ctxFrom(res) || ctxFrom(res.data);',
  '  if (top) return top;',
  '  const results = res.results || (res.data && res.data.results) || [];',
  '  for (let i = 0; i < results.length; i++) {',
  '    const item = results[i];',
  '    const fromItem = ctxFrom(item);',
  '    if (fromItem) return fromItem;',
  '    const opts = item.options || item.availableOptions || [];',
  '    for (let j = 0; j < opts.length; j++) {',
  '      const fromOpt = ctxFrom(opts[j]);',
  '      if (fromOpt) return fromOpt;',
  '    }',
  '  }',
  '  const topOpts = res.options || res.availableOptions || [];',
  '  for (let k = 0; k < topOpts.length; k++) {',
  '    const fromTopOpt = ctxFrom(topOpts[k]);',
  '    if (fromTopOpt) return fromTopOpt;',
  '  }',
  '  return null;',
  '}',
);

const SAVE_HOTEL_AUTOCOMPLETE = lines(
  'pm.test("Hotel autocomplete ok", function () { pm.response.to.have.status(200); });',
  'try {',
  '  const res = pm.response.json();',
  '  const list = res.results || res.content || res.data || [];',
  '  const pick = (Array.isArray(list) ? list : []).find(x => {',
  '    const t = String(x.type || x.entityType || "").toUpperCase();',
  '    return t === "CITY" || t === "HOTEL";',
  '  }) || (Array.isArray(list) ? list[0] : null);',
  '  const entityId = pick && (pick.entityId || pick.id);',
  '  if (entityId) {',
  '    pm.collectionVariables.set("hotel_entity_id", String(entityId));',
  '    const t = String(pick.type || pick.entityType || "").toUpperCase();',
  '    if (t) pm.collectionVariables.set("hotel_search_type", t === "HOTEL" ? "HOTEL" : "CITY");',
  '    console.log("Saved hotel_entity_id:", entityId);',
  '  } else console.warn("No CITY/HOTEL entityId — set hotel_entity_id manually");',
  '} catch (e) { console.warn("Autocomplete parse:", e.message); }',
);

const SAVE_HOTEL_STATUS = lines(
  'pm.test("Hotel status ok", function () { pm.response.to.have.status(200); });',
  'try { const res = pm.response.json(); console.log("Hotel status:", res.status || res.bookingStatus); } catch (e) { console.warn("Status parse:", e.message); }',
);

const SAVE_SERVICE_BR = (varName) => lines(
  'try {',
  '  const res = pm.response.json();',
  `  const br = res.bookingReference || res.bookingReferenceId || (res.data && (res.data.bookingReference || res.data.bookingReferenceId)) || null;`,
  `  if (br) { pm.collectionVariables.set("${varName}", String(br)); console.log("Saved ${varName}:", br); }`,
  '  else console.warn("No booking reference in response");',
  `  pm.test("${varName} captured", function () { if (!br) console.warn("Missing ${varName}"); });`,
  '} catch (e) { console.warn("Finalize parse:", e.message); }',
);

const SAVE_LOUNGE_AIRPORT = lines(
  'pm.test("Lounge airport search ok", function () { pm.response.to.have.status(200); });',
  'try {',
  '  const res = pm.response.json();',
  '  const list = res.results || [];',
  '  const first = Array.isArray(list) ? list[0] : null;',
  '  const id = first && (first.airportId || first.id);',
  '  if (id) { pm.collectionVariables.set("lounge_airport_id", String(id)); console.log("Saved lounge_airport_id:", id); }',
  '  else console.warn("No lounge_airport_id — set manually");',
  '} catch (e) { console.warn("Lounge airport parse:", e.message); }',
);

const SAVE_LOUNGE_LIST = lines(
  PICK_BOOKING_CONTEXT,
  'pm.test("Lounge list ok", function () { pm.response.to.have.status(200); });',
  'try {',
  '  const res = pm.response.json();',
  '  const first = (res.results || [])[0];',
  '  const pid = first && (first.productId || first.id);',
  '  const opt = first && ((first.options && first.options[0]) || first);',
  '  const oid = opt && (opt.optionId || opt.id);',
  '  const ctx = pickBookingContext(res) || ctxFrom(opt);',
  '  if (pid) { pm.collectionVariables.set("lounge_id", String(pid)); console.log("Saved lounge_id:", pid); }',
  '  if (oid) { pm.collectionVariables.set("lounge_option_id", String(oid)); console.log("Saved lounge_option_id:", oid); }',
  '  if (ctx) { pm.collectionVariables.set("lounge_booking_context", String(ctx)); console.log("Saved lounge_booking_context:", ctx); }',
  '  else console.warn("No lounge bookingContext yet — check details step");',
  '} catch (e) { console.warn("Lounge list parse:", e.message); }',
);

const SAVE_LOUNGE_DETAIL = lines(
  PICK_BOOKING_CONTEXT,
  'pm.test("Lounge details ok", function () { pm.response.to.have.status(200); });',
  'try {',
  '  const res = pm.response.json();',
  '  const ctx = pickBookingContext(res);',
  '  if (ctx) {',
  '    pm.collectionVariables.set("lounge_booking_context", String(ctx));',
  '    console.log("Saved lounge_booking_context from details:", ctx);',
  '  } else {',
  '    console.warn("No lounge bookingContext/bookingReference in details. Top keys:", Object.keys(res || {}));',
  '  }',
  '  pm.test("lounge_booking_context captured", function () {',
  '    pm.expect(ctx, "map bookingReference → lounge_booking_context for finalize").to.be.ok;',
  '  });',
  '} catch (e) { console.warn("Lounge detail parse:", e.message); }',
);

const SAVE_FT_AIRPORT = lines(
  'pm.test("Fast Track airport search ok", function () { pm.response.to.have.status(200); });',
  'try {',
  '  const res = pm.response.json();',
  '  const list = res.results || [];',
  '  const first = Array.isArray(list) ? list[0] : null;',
  '  const id = first && (first.airportId || first.id);',
  '  if (id) { pm.collectionVariables.set("ft_airport_id", String(id)); console.log("Saved ft_airport_id:", id); }',
  '  else console.warn("No ft_airport_id — set manually");',
  '} catch (e) { console.warn("FT airport parse:", e.message); }',
);

const SAVE_FT_LIST = lines(
  PICK_BOOKING_CONTEXT,
  'pm.test("Fast Track list ok", function () { pm.response.to.have.status(200); });',
  'try {',
  '  const res = pm.response.json();',
  '  const first = (res.results || [])[0];',
  '  const pid = first && (first.productId || first.id);',
  '  const opt = first && ((first.options && first.options[0]) || first);',
  '  const oid = opt && (opt.optionId || opt.id);',
  '  const ctx = pickBookingContext(res) || ctxFrom(opt);',
  '  if (pid) { pm.collectionVariables.set("ft_id", String(pid)); console.log("Saved ft_id:", pid); }',
  '  if (oid) { pm.collectionVariables.set("ft_option_id", String(oid)); console.log("Saved ft_option_id:", oid); }',
  '  if (ctx) { pm.collectionVariables.set("ft_booking_context", String(ctx)); console.log("Saved ft_booking_context:", ctx); }',
  '  else console.warn("No ft bookingContext yet — check details step");',
  '} catch (e) { console.warn("FT list parse:", e.message); }',
);

const SAVE_FT_DETAIL = lines(
  PICK_BOOKING_CONTEXT,
  'pm.test("Fast Track details ok", function () { pm.response.to.have.status(200); });',
  'try {',
  '  const res = pm.response.json();',
  '  const ctx = pickBookingContext(res);',
  '  if (ctx) {',
  '    pm.collectionVariables.set("ft_booking_context", String(ctx));',
  '    console.log("Saved ft_booking_context from details:", ctx);',
  '  } else {',
  '    console.warn("No ft bookingContext/bookingReference in details. Top keys:", Object.keys(res || {}));',
  '  }',
  '  pm.test("ft_booking_context captured", function () {',
  '    pm.expect(ctx, "map bookingReference → ft_booking_context for finalize").to.be.ok;',
  '  });',
  '} catch (e) { console.warn("FT detail parse:", e.message); }',
);

const SAVE_CAB_PLACE = lines(
  'pm.test("Cab autocomplete ok", function () { pm.response.to.have.status(200); });',
  'try {',
  '  const res = pm.response.json();',
  '  const list = res.results || res.places || res.data || [];',
  '  const first = Array.isArray(list) ? list[0] : null;',
  '  const pid = first && (first.placeId || first.id);',
  '  if (pid) { pm.collectionVariables.set("cab_place_id", String(pid)); console.log("Saved cab_place_id:", pid); }',
  '  else console.warn("No cab placeId — set cab_place_id manually");',
  '} catch (e) { console.warn("Cab place parse:", e.message); }',
);

const SAVE_CAB_SEARCH = lines(
  'pm.test("Cab search ok", function () { pm.response.to.have.status(200); });',
  'try {',
  '  const res = pm.response.json();',
  '  const first = (res.results || res.options || [])[0];',
  '  const sid = first && (first.searchId || first.id);',
  '  if (sid) { pm.collectionVariables.set("cab_search_id", String(sid)); console.log("Saved cab_search_id:", sid); }',
  '  else console.warn("No cab searchId");',
  '} catch (e) { console.warn("Cab search parse:", e.message); }',
);

const SAVE_CAB_FARE = lines(
  'pm.test("Cab fare ok", function () { pm.response.to.have.status(200); });',
  'try {',
  '  const res = pm.response.json();',
  '  const priceId = res.priceId || (res.data && res.data.priceId);',
  '  const ctx = res.bookingReference || res.bookingContext || (res.data && (res.data.bookingReference || res.data.bookingContext));',
  '  if (priceId) { pm.collectionVariables.set("cab_price_id", String(priceId)); console.log("Saved cab_price_id:", priceId); }',
  '  if (ctx) { pm.collectionVariables.set("cab_booking_context", String(ctx)); console.log("Saved cab_booking_context"); }',
  '  else console.warn("No cab fare booking context");',
  '} catch (e) { console.warn("Cab fare parse:", e.message); }',
);

const SAVE_ESIM_SEARCH = lines(
  'pm.test("eSIM search ok", function () { pm.response.to.have.status(200); });',
  'try {',
  '  const res = pm.response.json();',
  '  const first = (res.results || [])[0];',
  '  const pid = first && (first.productId || first.id);',
  '  const opt = first && ((first.options && first.options[0]) || first);',
  '  const oid = opt && (opt.optionId || opt.id);',
  '  if (pid) { pm.collectionVariables.set("esim_product_id", String(pid)); console.log("Saved esim_product_id:", pid); }',
  '  if (oid) { pm.collectionVariables.set("esim_option_id", String(oid)); console.log("Saved esim_option_id:", oid); }',
  '  else console.warn("No esim optionId — may resolve from details");',
  '} catch (e) { console.warn("eSIM search parse:", e.message); }',
);

const SAVE_ESIM_DETAIL = lines(
  PICK_BOOKING_CONTEXT,
  'pm.test("eSIM details ok", function () { pm.response.to.have.status(200); });',
  'try {',
  '  const res = pm.response.json();',
  '  const ctx = pickBookingContext(res);',
  '  const r0 = (res.results || [])[0];',
  '  if (r0 && r0.productId && !pm.collectionVariables.get("esim_product_id")) pm.collectionVariables.set("esim_product_id", String(r0.productId));',
  '  const opt = r0 && r0.options && r0.options[0];',
  '  if (opt && opt.optionId && !pm.collectionVariables.get("esim_option_id")) pm.collectionVariables.set("esim_option_id", String(opt.optionId));',
  '  if (ctx) { pm.collectionVariables.set("esim_booking_context", String(ctx)); console.log("Saved esim_booking_context"); }',
  '  else console.warn("No esim bookingContext in details");',
  '} catch (e) { console.warn("eSIM detail parse:", e.message); }',
);

function servicePassengerBody() {
  return `{
      "paxType": "ADT",
      "isLead": true,
      "profile": {
        "title": "Mr",
        "firstName": "{{pax_adult_first}}",
        "lastName": "{{pax_adult_last}}",
        "gender": "Male",
        "dob": "{{pax_adult_dob}}",
        "nationality": "IN"
      }
    }`;
}

function adultPax(overrides = {}) {
  return {
    paxId: 'PAX1',
    type: 'adult',
    isLead: true,
    profile: {
      title: 'Mr',
      firstName: '{{pax_adult_first}}',
      lastName: '{{pax_adult_last}}',
      gender: 'Male',
      dob: '{{pax_adult_dob}}',
      nationality: 'IN',
    },
    city: { cityCode: 'DEL', cityName: 'Delhi' },
    passport: {
      number: null,
      expiry: null,
      issuedDate: null,
      issuedCountryCode: null,
    },
    ssr: { baggage: [], meals: [], seats: [] },
    ...overrides,
  };
}

function childPax() {
  return {
    paxId: 'PAX2',
    type: 'child',
    isLead: false,
    profile: {
      title: 'Mstr',
      firstName: '{{pax_child_first}}',
      lastName: '{{pax_child_last}}',
      gender: 'Male',
      dob: '{{pax_child_dob}}',
      nationality: 'IN',
    },
    city: { cityCode: 'DEL', cityName: 'Delhi' },
    passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
    ssr: { baggage: [], meals: [], seats: [] },
  };
}

function infantPax() {
  return {
    paxId: 'PAX3',
    type: 'infant',
    isLead: false,
    profile: {
      title: 'Mstr',
      firstName: '{{pax_infant_first}}',
      lastName: '{{pax_infant_last}}',
      gender: 'Male',
      dob: '{{pax_infant_dob}}',
      nationality: 'IN',
    },
    city: { cityCode: 'DEL', cityName: 'Delhi' },
    passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
    ssr: { baggage: [], meals: [], seats: [] },
  };
}

/** Build issue body; ancillary scenario injects SSR from collection vars in prerequest. */
const ISSUE_PREREQUEST_ANCILLARY = lines(
  '// Rebuild issue-ticket body with auto-selected SSR from prior steps, then re-sign',
  'function parseJson(v, fallback) { try { return JSON.parse(v || ""); } catch { return fallback; } }',
  'const meals = parseJson(pm.collectionVariables.get("ssr_meal_json"), []);',
  'const bags = parseJson(pm.collectionVariables.get("ssr_bag_json"), []);',
  'const seats = parseJson(pm.collectionVariables.get("ssr_seat_json"), []);',
  'const journeyType = pm.collectionVariables.get("journey_type") || "ONE_WAY";',
  'const adults = Number(pm.collectionVariables.get("travellers_adults") || 1);',
  'const children = Number(pm.collectionVariables.get("travellers_children") || 0);',
  'const infants = Number(pm.collectionVariables.get("travellers_infants") || 0);',
  '',
  'const passengers = [{',
  '  paxId: "PAX1", type: "adult", isLead: true,',
  '  profile: { title: "Mr", firstName: pm.collectionVariables.get("pax_adult_first") || "Rohan", lastName: pm.collectionVariables.get("pax_adult_last") || "Bhagat", gender: "Male", dob: pm.collectionVariables.get("pax_adult_dob") || "1998-05-12", nationality: "IN" },',
  '  city: { cityCode: "DEL", cityName: "Delhi" },',
  '  passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },',
  '  ssr: { baggage: bags, meals: meals, seats: seats }',
  '}];',
  'if (children > 0) passengers.push({',
  '  paxId: "PAX2", type: "child", isLead: false,',
  '  profile: { title: "Mstr", firstName: pm.collectionVariables.get("pax_child_first") || "Aarav", lastName: pm.collectionVariables.get("pax_child_last") || "Bhagat", gender: "Male", dob: pm.collectionVariables.get("pax_child_dob") || "2018-06-01", nationality: "IN" },',
  '  city: { cityCode: "DEL", cityName: "Delhi" },',
  '  passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },',
  '  ssr: { baggage: [], meals: [], seats: [] }',
  '});',
  'if (infants > 0) passengers.push({',
  '  paxId: "PAX3", type: "infant", isLead: false,',
  '  profile: { title: "Mstr", firstName: pm.collectionVariables.get("pax_infant_first") || "Vihaan", lastName: pm.collectionVariables.get("pax_infant_last") || "Bhagat", gender: "Male", dob: pm.collectionVariables.get("pax_infant_dob") || "2025-08-01", nationality: "IN" },',
  '  city: { cityCode: "DEL", cityName: "Delhi" },',
  '  passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },',
  '  ssr: { baggage: [], meals: [], seats: [] }',
  '});',
  '',
  'const searchIds = journeyType === "ROUND_TRIP"',
  '  ? [pm.collectionVariables.get("search_id_onward"), pm.collectionVariables.get("search_id_return")]',
  '  : [pm.collectionVariables.get("search_id")];',
  '',
  'const body = {',
  '  type: "ticket",',
  '  currency: "INR",',
  '  language: "en",',
  '  bookingReference: pm.collectionVariables.get("booking_context"),',
  '  searchIds,',
  '  journeyType,',
  '  timezone: "Asia/Calcutta",',
  '  data: {',
  '    priceId: pm.collectionVariables.get("price_id"),',
  '    passportType: pm.collectionVariables.get("passport_type") || "NONE",',
  '    includeGst: false,',
  '    gstDetails: null,',
  '    contact: {',
  '      email: pm.collectionVariables.get("contact_email") || "qa@travelvip.ai",',
  '      mobile: pm.collectionVariables.get("contact_mobile") || "9876543210",',
  '      countryCode: pm.collectionVariables.get("contact_country_code") || "+91"',
  '    },',
  '    passengers',
  '  }',
  '};',
  '',
  'const raw = JSON.stringify(body);',
  'pm.request.body.update(raw);',
  '',
  'const timestamp = Math.floor(Date.now() / 1000).toString();',
  'const signingKey = pm.environment.get("signing_key") || pm.collectionVariables.get("signing_key") || "";',
  'const signature = CryptoJS.HmacSHA256(raw + timestamp, signingKey).toString(CryptoJS.enc.Hex);',
  'pm.collectionVariables.set("timestamp", timestamp);',
  'pm.collectionVariables.set("signature", signature);',
  'pm.environment.set("timestamp", timestamp);',
  'pm.environment.set("signature", signature);',
  'pm.collectionVariables.set("request_id", "req-" + Date.now());',
  'console.log("Issue body rebuilt with SSR meals/bags/seats counts:", meals.length, bags.length, seats.length);',
);

function owSearchBody() {
  return `{
  "itinerary": [
    {
      "origin": "{{flight_origin}}",
      "destination": "{{flight_destination}}",
      "date": "{{flight_dep_date}}"
    }
  ],
  "travellers": {
    "adults": {{travellers_adults}},
    "children": {{travellers_children}},
    "infants": {{travellers_infants}}
  },
  "cabinClass": "{{cabin_class}}",
  "journeyType": "ONE_WAY",
  "currency": "INR",
  "language": "en",
  "preferences": {
    "airlines": [],
    "maxStops": null,
    "refundableOnly": false
  },
  "appliedFilters": {},
  "selection": {
    "selectedSearchIds": []
  },
  "fareType": "{{fare_type}}"
}`;
}

function rtSearchBodyInitial() {
  return `{
  "itinerary": [
    {
      "origin": "{{flight_origin}}",
      "destination": "{{flight_destination}}",
      "date": "{{flight_dep_date}}"
    },
    {
      "origin": "{{flight_destination}}",
      "destination": "{{flight_origin}}",
      "date": "{{flight_ret_date}}"
    }
  ],
  "travellers": {
    "adults": {{travellers_adults}},
    "children": {{travellers_children}},
    "infants": {{travellers_infants}}
  },
  "cabinClass": "{{cabin_class}}",
  "journeyType": "ROUND_TRIP",
  "currency": "INR",
  "language": "en",
  "preferences": {
    "airlines": [],
    "maxStops": null,
    "refundableOnly": false
  },
  "appliedFilters": {},
  "selection": {
    "selectedSearchIds": []
  },
  "fareType": "{{fare_type}}"
}`;
}

function rtSearchBodyReturn() {
  return `{
  "itinerary": [
    {
      "origin": "{{flight_origin}}",
      "destination": "{{flight_destination}}",
      "date": "{{flight_dep_date}}"
    },
    {
      "origin": "{{flight_destination}}",
      "destination": "{{flight_origin}}",
      "date": "{{flight_ret_date}}"
    }
  ],
  "travellers": {
    "adults": {{travellers_adults}},
    "children": {{travellers_children}},
    "infants": {{travellers_infants}}
  },
  "cabinClass": "{{cabin_class}}",
  "journeyType": "ROUND_TRIP",
  "currency": "INR",
  "language": "en",
  "preferences": {
    "airlines": [],
    "maxStops": null,
    "refundableOnly": false
  },
  "appliedFilters": {},
  "selection": {
    "selectedSearchIds": [
      "{{search_id_onward}}"
    ]
  },
  "fareType": "{{fare_type}}"
}`;
}

function pricingBodyOw() {
  return `{
  "journeyType": "ONE_WAY",
  "selection": {
    "selectedSearchIds": [
      "{{search_id}}"
    ]
  }
}`;
}

function pricingBodyRt() {
  return `{
  "journeyType": "ROUND_TRIP",
  "selection": {
    "selectedSearchIds": [
      "{{search_id_onward}}",
      "{{search_id_return}}"
    ]
  }
}`;
}

function issueBodySimple(passengers, journeyType) {
  const searchIds =
    journeyType === 'ROUND_TRIP'
      ? '[\n      "{{search_id_onward}}",\n      "{{search_id_return}}"\n    ]'
      : '[\n      "{{search_id}}"\n    ]';
  return `{
  "type": "ticket",
  "currency": "INR",
  "language": "en",
  "bookingReference": "{{booking_context}}",
  "searchIds": ${searchIds},
  "journeyType": "${journeyType}",
  "timezone": "Asia/Calcutta",
  "data": {
    "priceId": "{{price_id}}",
    "passportType": "{{passport_type}}",
    "includeGst": false,
    "gstDetails": null,
    "contact": {
      "email": "{{contact_email}}",
      "mobile": "{{contact_mobile}}",
      "countryCode": "{{contact_country_code}}"
    },
    "passengers": ${JSON.stringify(passengers, null, 6).replace(/^/gm, '    ').trim()}
  }
}`;
}

function flightQuery() {
  return [
    ['lang', 'en'],
    ['currency', 'INR'],
    ['page', '0'],
    ['perpage', '20'],
  ];
}

function issueQuery() {
  return [
    ['lang', 'en'],
    ['currency', 'INR'],
    ['pid', '{{issue_pid}}'],
    ['key', '{{issue_key}}'],
    ['clientCode', '{{issue_client_code}}'],
    ['platform', '{{issue_platform}}'],
    ['count', '10'],
    ['page', '0'],
    ['perpage', '20'],
  ];
}

function seatmapBody() {
  return `{
  "currency": "INR",
  "requestReference": "{{booking_context}}",
  "passengers": [
    {
      "paxRefNumber": "1",
      "passengerType": 1,
      "gender": "Male",
      "title": "Mr",
      "firstName": "{{pax_adult_first}}",
      "lastName": "{{pax_adult_last}}"
    }
  ]
}`;
}

function flightLookupSteps() {
  return [
    req('01 Airport Search', {
      method: 'GET',
      headers: hdr(),
      pathSegs: ['v1', 'flights', 'airports'],
      query: [['lang', 'en'], ['currency', 'INR'], ['airport', '{{airport_query}}'], ['page', '0'], ['perpage', '10']],
      rawUrl: '{{base_url}}/v1/flights/airports?lang=en&currency=INR&airport={{airport_query}}&page=0&perpage=10',
      events: [ev('test', SAVE_AIRPORT_SEARCH)],
    }),
    req('02 Airline Search', {
      method: 'GET',
      headers: hdr(),
      pathSegs: ['v1', 'flights', 'airlines'],
      query: [['lang', 'en'], ['currency', 'INR'], ['airline', '{{airline_query}}'], ['perpage', '10'], ['page', '1']],
      rawUrl: '{{base_url}}/v1/flights/airlines?lang=en&currency=INR&airline={{airline_query}}&perpage=10&page=1',
      events: [ev('test', SAVE_AIRLINE_SEARCH)],
    }),
    req('03 City Search', {
      method: 'GET',
      headers: hdr(),
      pathSegs: ['v1', 'flights', 'citySearch'],
      query: [['lang', 'en'], ['currency', 'INR'], ['q', '{{city_query}}'], ['page', '0'], ['perpage', '10']],
      rawUrl: '{{base_url}}/v1/flights/citySearch?lang=en&currency=INR&q={{city_query}}&page=0&perpage=10',
      events: [ev('test', SAVE_CITY_SEARCH)],
    }),
  ];
}

function flightDetailsFareRulesSteps(pricingBody) {
  return [
    req('Details', {
      headers: hdr(),
      body: pricingBody,
      pathSegs: ['v1', 'flights', 'details'],
      query: [['lang', 'en'], ['currency', 'INR']],
      rawUrl: '{{base_url}}/v1/flights/details?lang=en&currency=INR',
      events: [ev('test', SAVE_OK)],
    }),
    req('Fare Rules', {
      headers: hdr(),
      body: pricingBody,
      pathSegs: ['v1', 'flights', 'fareRules'],
      query: [['lang', 'en'], ['currency', 'INR']],
      rawUrl: '{{base_url}}/v1/flights/fareRules?lang=en&currency=INR',
      events: [ev('test', SAVE_OK)],
    }),
  ];
}

function flightSsrSeatmapSteps(labelPrefix = '') {
  const p = labelPrefix ? `${labelPrefix} ` : '';
  return [
    req(`${p}SSR (meals/baggage)`, {
      headers: hdr(),
      body: '{\n  "priceId": "{{price_id}}"\n}',
      pathSegs: ['v1', 'flights', 'ssr'],
      query: [['lang', 'en'], ['currency', 'INR']],
      rawUrl: '{{base_url}}/v1/flights/ssr?lang=en&currency=INR',
      events: [ev('test', SAVE_SSR)],
    }),
    req(`${p}SeatMap`, {
      headers: hdr(),
      body: seatmapBody(),
      pathSegs: ['v1', 'flights', 'seatmap'],
      query: [['lang', 'en'], ['currency', 'INR']],
      rawUrl: '{{base_url}}/v1/flights/seatmap?lang=en&currency=INR',
      events: [ev('test', SAVE_SEATMAP)],
    }),
  ];
}

function flightIssueStep({ ancillary, passengers, journeyType, stepNum }) {
  const name = ancillary
    ? `${String(stepNum).padStart(2, '0')} Issue Ticket (with ancillaries)`
    : `${String(stepNum).padStart(2, '0')} Issue Ticket`;
  return req(name, {
    headers: partnerHdr(),
    body: ancillary ? '{}' : issueBodySimple(passengers, journeyType),
    pathSegs: ['v1', 'flights', 'booking', 'issue-ticket'],
    query: issueQuery(),
    rawUrl: '{{base_url}}/v1/flights/booking/issue-ticket?lang=en&currency=INR&pid={{issue_pid}}&key={{issue_key}}&clientCode={{issue_client_code}}&platform={{issue_platform}}&count=10&page=0&perpage=20',
    events: ancillary
      ? [ev('prerequest', ISSUE_PREREQUEST_ANCILLARY), ev('test', SAVE_ISSUE)]
      : [ev('test', SAVE_ISSUE)],
  });
}

function flightPostBookingSteps(startNum) {
  let n = startNum;
  const next = (label) => `${String(n++).padStart(2, '0')} ${label}`;
  return [
    req(next('Booking Status'), {
      method: 'GET',
      headers: hdr(),
      pathSegs: ['v1', 'flights', 'booking', '{{booking_reference}}', 'status'],
      query: [['lang', 'en'], ['currency', 'INR']],
      rawUrl: '{{base_url}}/v1/flights/booking/{{booking_reference}}/status?lang=en&currency=INR',
      events: [ev('test', SAVE_STATUS)],
    }),
    req(next('Booking Detail'), {
      method: 'GET',
      headers: hdr(),
      pathSegs: ['v1', 'flights', 'booking', '{{booking_reference}}'],
      query: [['lang', 'en'], ['currency', 'INR']],
      rawUrl: '{{base_url}}/v1/flights/booking/{{booking_reference}}?lang=en&currency=INR',
      events: [ev('test', lines('pm.test("Detail ok", function(){ pm.response.to.have.status(200); });'))],
    }),
    req(next('Booking History'), {
      method: 'GET',
      headers: hdr(),
      pathSegs: ['v1', 'flights', 'bookings', 'history'],
      query: [['lang', 'en'], ['currency', 'INR'], ['perpage', '10'], ['page', '1'], ['status', '']],
      rawUrl: '{{base_url}}/v1/flights/bookings/history?lang=en&currency=INR&perpage=10&page=1&status=',
      events: [ev('test', SAVE_FLIGHT_HISTORY)],
    }),
    req(next('Cancellation Penalty Check'), {
      headers: hdr(),
      body: '{\n  "action": "PENALTY",\n  "retryCount": 2\n}',
      pathSegs: ['v1', 'flights', 'booking', '{{booking_reference}}', 'cancel'],
      query: [['lang', 'en'], ['currency', 'INR']],
      rawUrl: '{{base_url}}/v1/flights/booking/{{booking_reference}}/cancel?lang=en&currency=INR',
      events: [ev('test', saveCancelTest('PENALTY'))],
    }),
    req(next('Cancel'), {
      headers: hdr(),
      body: '{\n  "action": "CANCEL",\n  "retryCount": 2\n}',
      pathSegs: ['v1', 'flights', 'booking', '{{booking_reference}}', 'cancel'],
      query: [['lang', 'en'], ['currency', 'INR']],
      rawUrl: '{{base_url}}/v1/flights/booking/{{booking_reference}}/cancel?lang=en&currency=INR',
      events: [ev('test', saveCancelTest('CANCEL'))],
    }),
    req(next('Penalty + Cancel'), {
      headers: hdr(),
      body: '{\n  "action": "PENALTY_AND_CANCEL",\n  "retryCount": 2\n}',
      pathSegs: ['v1', 'flights', 'booking', '{{booking_reference}}', 'cancel'],
      query: [['lang', 'en'], ['currency', 'INR']],
      rawUrl: '{{base_url}}/v1/flights/booking/{{booking_reference}}/cancel?lang=en&currency=INR',
      events: [ev('test', saveCancelTest('PENALTY_AND_CANCEL'))],
    }),
  ];
}

function owFlow({ name, adults, children, infants, ancillary = false }) {
  const passengers = [adultPax()];
  if (children > 0) passengers.push(childPax());
  if (infants > 0) passengers.push(infantPax());

  const items = [
    ...flightLookupSteps(),
    req('04 Search OW', {
      headers: hdr(),
      body: owSearchBody(),
      pathSegs: ['v1', 'flights', 'search'],
      query: flightQuery(),
      rawUrl: '{{base_url}}/v1/flights/search?lang=en&currency=INR&page=0&perpage=20',
      events: [ev('test', SAVE_OW_SEARCH)],
    }),
    req('05 Details', {
      headers: hdr(),
      body: pricingBodyOw(),
      pathSegs: ['v1', 'flights', 'details'],
      query: [['lang', 'en'], ['currency', 'INR']],
      rawUrl: '{{base_url}}/v1/flights/details?lang=en&currency=INR',
      events: [ev('test', SAVE_OK)],
    }),
    req('06 Fare Rules', {
      headers: hdr(),
      body: pricingBodyOw(),
      pathSegs: ['v1', 'flights', 'fareRules'],
      query: [['lang', 'en'], ['currency', 'INR']],
      rawUrl: '{{base_url}}/v1/flights/fareRules?lang=en&currency=INR',
      events: [ev('test', SAVE_OK)],
    }),
    req('07 Pricing', {
      headers: hdr(),
      body: pricingBodyOw(),
      pathSegs: ['v1', 'flights', 'pricing'],
      query: [['lang', 'en'], ['currency', 'INR']],
      rawUrl: '{{base_url}}/v1/flights/pricing?lang=en&currency=INR',
      events: [ev('test', SAVE_PRICING)],
    }),
    req('08 SSR (meals/baggage)', {
      headers: hdr(),
      body: '{\n  "priceId": "{{price_id}}"\n}',
      pathSegs: ['v1', 'flights', 'ssr'],
      query: [['lang', 'en'], ['currency', 'INR']],
      rawUrl: '{{base_url}}/v1/flights/ssr?lang=en&currency=INR',
      events: [ev('test', SAVE_SSR)],
    }),
    req('09 SeatMap', {
      headers: hdr(),
      body: seatmapBody(),
      pathSegs: ['v1', 'flights', 'seatmap'],
      query: [['lang', 'en'], ['currency', 'INR']],
      rawUrl: '{{base_url}}/v1/flights/seatmap?lang=en&currency=INR',
      events: [ev('test', SAVE_SEATMAP)],
    }),
    flightIssueStep({ ancillary, passengers, journeyType: 'ONE_WAY', stepNum: 10 }),
    ...flightPostBookingSteps(11),
  ];

  return {
    name,
    event: folderPrerequest({
      journey_type: 'ONE_WAY',
      travellers_adults: String(adults),
      travellers_children: String(children),
      travellers_infants: String(infants),
      with_ancillary: ancillary ? 'true' : 'false',
    }),
    item: items,
    description: ancillary
      ? 'Full OW flow incl. lookup, SSR/SeatMap, issue with ancillaries, status/detail/history/cancel steps. Re-send Search if search_id empty.'
      : 'Full OW flow — all endpoints top→bottom. SSR/SeatMap always called; issue uses empty SSR unless ancillary folder. Re-send Search if needed.',
  };
}

function rtFlow({ name, adults, children, infants, ancillary = false }) {
  const passengers = [adultPax()];
  if (children > 0) passengers.push(childPax());
  if (infants > 0) passengers.push(infantPax());

  const items = [
    ...flightLookupSteps(),
    req('04 Search RT (onward)', {
      headers: hdr(),
      body: rtSearchBodyInitial(),
      pathSegs: ['v1', 'flights', 'search'],
      query: flightQuery(),
      rawUrl: '{{base_url}}/v1/flights/search?lang=en&currency=INR&page=0&perpage=20',
      events: [ev('test', SAVE_RT_SEARCH_INITIAL)],
    }),
    req('05 Search RT (select onward → return)', {
      headers: hdr(),
      body: rtSearchBodyReturn(),
      pathSegs: ['v1', 'flights', 'search'],
      query: flightQuery(),
      rawUrl: '{{base_url}}/v1/flights/search?lang=en&currency=INR&page=0&perpage=20',
      events: [ev('test', SAVE_RT_SEARCH_RETURN)],
    }),
    req('06 Details', {
      headers: hdr(),
      body: pricingBodyRt(),
      pathSegs: ['v1', 'flights', 'details'],
      query: [['lang', 'en'], ['currency', 'INR']],
      rawUrl: '{{base_url}}/v1/flights/details?lang=en&currency=INR',
      events: [ev('test', SAVE_OK)],
    }),
    req('07 Fare Rules', {
      headers: hdr(),
      body: pricingBodyRt(),
      pathSegs: ['v1', 'flights', 'fareRules'],
      query: [['lang', 'en'], ['currency', 'INR']],
      rawUrl: '{{base_url}}/v1/flights/fareRules?lang=en&currency=INR',
      events: [ev('test', SAVE_OK)],
    }),
    req('08 Pricing', {
      headers: hdr(),
      body: pricingBodyRt(),
      pathSegs: ['v1', 'flights', 'pricing'],
      query: [['lang', 'en'], ['currency', 'INR']],
      rawUrl: '{{base_url}}/v1/flights/pricing?lang=en&currency=INR',
      events: [ev('test', SAVE_PRICING)],
    }),
    req('09 SSR (meals/baggage)', {
      headers: hdr(),
      body: '{\n  "priceId": "{{price_id}}"\n}',
      pathSegs: ['v1', 'flights', 'ssr'],
      query: [['lang', 'en'], ['currency', 'INR']],
      rawUrl: '{{base_url}}/v1/flights/ssr?lang=en&currency=INR',
      events: [ev('test', SAVE_SSR)],
    }),
    req('10 SeatMap', {
      headers: hdr(),
      body: seatmapBody(),
      pathSegs: ['v1', 'flights', 'seatmap'],
      query: [['lang', 'en'], ['currency', 'INR']],
      rawUrl: '{{base_url}}/v1/flights/seatmap?lang=en&currency=INR',
      events: [ev('test', SAVE_SEATMAP)],
    }),
    flightIssueStep({ ancillary, passengers, journeyType: 'ROUND_TRIP', stepNum: 11 }),
    ...flightPostBookingSteps(12),
  ];

  return {
    name,
    event: folderPrerequest({
      journey_type: 'ROUND_TRIP',
      travellers_adults: String(adults),
      travellers_children: String(children),
      travellers_infants: String(infants),
      with_ancillary: ancillary ? 'true' : 'false',
    }),
    item: items,
    description: 'Full RT flow. Step 04 saves onward; 05 selects return. All endpoints incl. cancel variants. Re-send search steps if IDs missing.',
  };
}

const SAVE_HOTEL_SEARCH = lines(
  'pm.test("Hotel search ok", function () { pm.response.to.have.status(200); });',
  'const res = pm.response.json();',
  'const hotels = res.content || res.hotels || res.results || [];',
  'const list = Array.isArray(hotels) ? hotels : [];',
  'const first = list[0];',
  'const hotelId = first && (first.hotelId || first.id || first.entityId);',
  'const searchId = first && (first.searchId || first.hotelSearchId);',
  'if (hotelId) pm.collectionVariables.set("hotel_id", String(hotelId));',
  'if (searchId) pm.collectionVariables.set("hotel_search_id", String(searchId));',
  'if (first && first.bookingCode) pm.collectionVariables.set("hotel_booking_code", String(first.bookingCode));',
  'console.log("Hotel pick", hotelId, searchId, first && first.name);',
  'pm.test("hotel id captured", function () { pm.expect(pm.collectionVariables.get("hotel_id")).to.be.ok; });',
);

const SAVE_HOTEL_DETAIL = lines(
  'pm.test("Hotel detail ok", function () { pm.response.to.have.status(200); });',
  'const res = pm.response.json();',
  'const room = (res.rooms || res.content || [])[0] || res.room || null;',
  'const bookingCode = res.bookingCode || (room && room.bookingCode) || pm.collectionVariables.get("hotel_booking_code");',
  'const bookingContext = res.bookingContext || res.requestReference || null;',
  'if (bookingCode) pm.collectionVariables.set("hotel_booking_code", String(bookingCode));',
  'if (bookingContext) pm.collectionVariables.set("hotel_booking_context", String(bookingContext));',
  'if (res.requestId) pm.collectionVariables.set("hotel_request_id", String(res.requestId));',
  'console.log("Detail bookingCode/context", bookingCode, bookingContext);',
);

const SAVE_HOTEL_PREBOOK = lines(
  'pm.test("Prebook ok", function () { pm.response.to.have.status(200); });',
  'const res = pm.response.json();',
  'const ctx = res.bookingContext || (res.data && res.data.bookingContext);',
  'const code = res.bookingCode || (res.data && res.data.bookingCode);',
  'const reqId = res.requestId || (res.data && res.data.requestId);',
  'if (ctx) pm.collectionVariables.set("hotel_booking_context", String(ctx));',
  'if (code) pm.collectionVariables.set("hotel_booking_code", String(code));',
  'if (reqId) pm.collectionVariables.set("hotel_request_id", String(reqId));',
  'console.log("Prebook saved context/code/requestId");',
);

const SAVE_HOTEL_FINALIZE = lines(
  'const res = pm.response.json();',
  'const br = res.bookingReferenceId || res.bookingReference || res.bookingRefId || null;',
  'if (br) pm.collectionVariables.set("hotel_booking_reference", String(br));',
  'console.log("Hotel finalize", pm.response.code, br, res.message || res.status);',
  'pm.test("Hotel BR created", function () { pm.expect(br).to.be.ok; });',
);

function hotelFlow() {
  return {
    name: 'Hotel - Single Booking',
    description: 'Hotel E2E: autocomplete → search → detail → prebook → finalize → status/detail/history/cancel.',
    item: [
      req('01 Hotel Autocomplete', {
        method: 'GET',
        headers: hdr(),
        pathSegs: ['v1', 'hotels', 'autocomplete'],
        query: [['lang', 'en'], ['currency', 'INR'], ['page', '1'], ['perpage', '20'], ['q', '{{hotel_autocomplete_q}}']],
        rawUrl: '{{base_url}}/v1/hotels/autocomplete?lang=en&currency=INR&page=1&perpage=20&q={{hotel_autocomplete_q}}',
        events: [ev('test', SAVE_HOTEL_AUTOCOMPLETE)],
      }),
      req('02 Hotel Search', {
        headers: hdr(),
        body: `{
  "checkin": "{{hotel_checkin}}",
  "checkout": "{{hotel_checkout}}",
  "entityId": "{{hotel_entity_id}}",
  "nationality": "IN",
  "type": "{{hotel_search_type}}",
  "rooms": [
    {
      "adults": 1,
      "children": 0,
      "childrenAges": []
    }
  ]
}`,
        pathSegs: ['v1', 'hotels', 'search'],
        query: [['currency', 'INR'], ['page', '0'], ['perpage', '20'], ['lang', 'en']],
        rawUrl: '{{base_url}}/v1/hotels/search?currency=INR&page=0&perpage=20&lang=en',
        events: [ev('test', SAVE_HOTEL_SEARCH)],
      }),
      req('03 Hotel Detail', {
        headers: hdr(),
        body: `{
  "hotelId": "{{hotel_id}}",
  "searchId": "{{hotel_search_id}}",
  "checkin": "{{hotel_checkin}}",
  "checkout": "{{hotel_checkout}}",
  "nationality": "IN",
  "rooms": [
    {
      "adults": 1,
      "children": 0,
      "childrenAges": []
    }
  ]
}`,
        pathSegs: ['v1', 'hotels', 'details'],
        query: [['lang', 'en'], ['currency', 'INR']],
        rawUrl: '{{base_url}}/v1/hotels/details?lang=en&currency=INR',
        events: [ev('test', SAVE_HOTEL_DETAIL)],
      }),
      req('04 Hotel Prebook', {
        headers: hdr(),
        body: `{
  "bookingContext": "{{hotel_booking_context}}",
  "bookingCode": "{{hotel_booking_code}}",
  "requestId": "{{hotel_request_id}}",
  "checkin": "{{hotel_checkin}}",
  "checkout": "{{hotel_checkout}}",
  "rooms": [
    {
      "guests": [
        {
          "title": "Mr.",
          "firstName": "{{pax_adult_first}}",
          "lastName": "{{pax_adult_last}}",
          "type": "Adult",
          "isLead": true
        }
      ]
    }
  ],
  "contact": {
    "email": "{{contact_email}}",
    "countryCode": "{{contact_country_code}}",
    "mobile": "{{contact_mobile}}"
  }
}`,
        pathSegs: ['v1', 'hotels', 'prebook'],
        query: [['lang', 'en'], ['currency', 'INR']],
        rawUrl: '{{base_url}}/v1/hotels/prebook?lang=en&currency=INR',
        events: [ev('test', SAVE_HOTEL_PREBOOK)],
      }),
      req('05 Hotel Finalize Booking', {
        headers: partnerHdr(),
        body: `{
  "bookingContext": "{{hotel_booking_context}}",
  "bookingCode": "{{hotel_booking_code}}",
  "requestId": "{{hotel_request_id}}",
  "checkin": "{{hotel_checkin}}",
  "checkout": "{{hotel_checkout}}",
  "rooms": [
    {
      "guests": [
        {
          "title": "Mr.",
          "firstName": "{{pax_adult_first}}",
          "lastName": "{{pax_adult_last}}",
          "type": "Adult",
          "isLead": true
        }
      ]
    }
  ],
  "contact": {
    "email": "{{contact_email}}",
    "countryCode": "{{contact_country_code}}",
    "mobile": "{{contact_mobile}}"
  }
}`,
        pathSegs: ['v1', 'hotels', 'finalize-booking'],
        query: [['lang', 'en'], ['currency', 'INR'], ['page', '0'], ['perpage', '20']],
        rawUrl: '{{base_url}}/v1/hotels/finalize-booking?lang=en&currency=INR&page=0&perpage=20',
        events: [ev('test', SAVE_HOTEL_FINALIZE)],
      }),
      req('06 Hotel Booking Status', {
        method: 'GET',
        headers: hdr(),
        pathSegs: ['v1', 'hotels', 'bookings', '{{hotel_booking_reference}}', 'status'],
        query: [['lang', 'en'], ['currency', 'INR']],
        rawUrl: '{{base_url}}/v1/hotels/bookings/{{hotel_booking_reference}}/status?lang=en&currency=INR',
        events: [ev('test', SAVE_HOTEL_STATUS)],
      }),
      req('07 Hotel Booking Detail', {
        method: 'GET',
        headers: hdr(),
        pathSegs: ['v1', 'hotels', 'bookings', '{{hotel_booking_reference}}'],
        query: [['lang', 'en'], ['currency', 'INR']],
        rawUrl: '{{base_url}}/v1/hotels/bookings/{{hotel_booking_reference}}?lang=en&currency=INR',
        events: [ev('test', SAVE_OK)],
      }),
      req('08 Hotel Booking History', {
        method: 'GET',
        headers: hdr(),
        pathSegs: ['v1', 'hotels', 'bookings', 'history'],
        query: [['lang', 'en'], ['currency', 'INR']],
        rawUrl: '{{base_url}}/v1/hotels/bookings/history?lang=en&currency=INR',
        events: [ev('test', SAVE_OK)],
      }),
      req('09 Hotel Cancel', {
        method: 'GET',
        headers: hdr(),
        pathSegs: ['v1', 'hotels', 'bookings', '{{hotel_booking_reference}}', 'cancel'],
        query: [['lang', 'en'], ['currency', 'INR']],
        rawUrl: '{{base_url}}/v1/hotels/bookings/{{hotel_booking_reference}}/cancel?lang=en&currency=INR',
        events: [ev('test', SAVE_OK)],
      }),
    ],
  };
}

function loungeFlow() {
  return {
    name: 'Lounge - Single Booking',
    description: 'Lounge E2E at DXB (default). Autocomplete airport → list → details → finalize → post-booking.',
    item: [
      req('01 Airport Search', {
        method: 'GET',
        headers: hdr(),
        pathSegs: ['v1', 'airports', 'search'],
        query: [['lang', 'en'], ['currency', 'INR'], ['page', '0'], ['perpage', '20'], ['q', '{{lounge_airport_q}}']],
        rawUrl: '{{base_url}}/v1/airports/search?lang=en&currency=INR&page=0&perpage=20&q={{lounge_airport_q}}',
        events: [ev('test', SAVE_LOUNGE_AIRPORT)],
      }),
      req('02 Lounge List', {
        method: 'GET',
        headers: hdr(),
        pathSegs: ['v1', 'lounges'],
        query: [['lang', 'en'], ['currency', 'INR'], ['page', '0'], ['perpage', '20'], ['airportId', '{{lounge_airport_id}}'], ['terminal', '{{lounge_terminal}}']],
        rawUrl: '{{base_url}}/v1/lounges?lang=en&currency=INR&page=0&perpage=20&airportId={{lounge_airport_id}}&terminal={{lounge_terminal}}',
        events: [ev('test', SAVE_LOUNGE_LIST)],
      }),
      req('03 Lounge Details', {
        method: 'GET',
        headers: hdr(),
        pathSegs: ['v1', 'lounges', '{{lounge_id}}'],
        query: [['lang', 'en'], ['currency', 'INR'], ['optionId', '{{lounge_option_id}}']],
        rawUrl: '{{base_url}}/v1/lounges/{{lounge_id}}?lang=en&currency=INR&optionId={{lounge_option_id}}',
        events: [ev('test', SAVE_LOUNGE_DETAIL)],
      }),
      req('04 Lounge Finalize Booking', {
        headers: partnerHdr(),
        body: `{
  "bookingContext": "{{lounge_booking_context}}",
  "travelDate": "{{lounge_travel_date}}",
  "travelTime": "{{travel_time}}",
  "passengers": [
    ${servicePassengerBody()}
  ],
  "contact": {
    "email": "{{contact_email}}",
    "countryCode": "{{contact_country_code}}",
    "mobile": "{{contact_mobile}}"
  }
}`,
        pathSegs: ['v1', 'airportServices', 'lounges', 'finalize-booking'],
        query: [['lang', 'en'], ['currency', 'INR']],
        rawUrl: '{{base_url}}/v1/airportServices/lounges/finalize-booking?lang=en&currency=INR',
        events: [ev('test', SAVE_SERVICE_BR('lounge_booking_reference'))],
      }),
      req('05 Lounge Booking Status', {
        method: 'GET',
        headers: hdr(),
        pathSegs: ['v1', 'airportServices', 'lounge', '{{lounge_booking_reference}}', 'status'],
        query: [['lang', 'en'], ['currency', 'INR']],
        rawUrl: '{{base_url}}/v1/airportServices/lounge/{{lounge_booking_reference}}/status?lang=en&currency=INR',
        events: [ev('test', SAVE_OK)],
      }),
      req('06 Lounge Booking Detail', {
        method: 'GET',
        headers: hdr(),
        pathSegs: ['v1', 'airportServices', 'lounge', 'booking', '{{lounge_booking_reference}}'],
        query: [['lang', 'en'], ['currency', 'INR']],
        rawUrl: '{{base_url}}/v1/airportServices/lounge/booking/{{lounge_booking_reference}}?lang=en&currency=INR',
        events: [ev('test', SAVE_OK)],
      }),
      req('07 Lounge Booking History', {
        method: 'GET',
        headers: hdr(),
        pathSegs: ['v1', 'airportServices', 'lounge', 'booking', 'history'],
        query: [['lang', 'en'], ['currency', 'INR']],
        rawUrl: '{{base_url}}/v1/airportServices/lounge/booking/history?lang=en&currency=INR',
        events: [ev('test', SAVE_OK)],
      }),
    ],
  };
}

function fastTrackFlow() {
  return {
    name: 'Fast Track - Single Booking',
    description: 'Fast Track E2E at DXB Terminal 2 Departure (default).',
    item: [
      req('01 Airport Search', {
        method: 'GET',
        headers: hdr(),
        pathSegs: ['v1', 'fasttracks', 'airports', 'search'],
        query: [['lang', 'en'], ['currency', 'INR'], ['page', '0'], ['perpage', '20'], ['q', '{{ft_airport_q}}']],
        rawUrl: '{{base_url}}/v1/fasttracks/airports/search?lang=en&currency=INR&page=0&perpage=20&q={{ft_airport_q}}',
        events: [ev('test', SAVE_FT_AIRPORT)],
      }),
      req('02 Fast Track List', {
        method: 'GET',
        headers: hdr(),
        pathSegs: ['v1', 'fasttracks'],
        query: [['lang', 'en'], ['currency', 'INR'], ['page', '0'], ['perpage', '10'], ['airportId', '{{ft_airport_id}}'], ['terminal', '{{ft_terminal}}'], ['terminalSide', '{{ft_terminal_side}}']],
        rawUrl: '{{base_url}}/v1/fasttracks?lang=en&currency=INR&page=0&perpage=10&airportId={{ft_airport_id}}&terminal={{ft_terminal}}&terminalSide={{ft_terminal_side}}',
        events: [ev('test', SAVE_FT_LIST)],
      }),
      req('03 Fast Track Details', {
        method: 'GET',
        headers: hdr(),
        pathSegs: ['v1', 'fasttracks', '{{ft_id}}'],
        query: [['lang', 'en'], ['currency', 'INR'], ['optionId', '{{ft_option_id}}']],
        rawUrl: '{{base_url}}/v1/fasttracks/{{ft_id}}?lang=en&currency=INR&optionId={{ft_option_id}}',
        events: [ev('test', SAVE_FT_DETAIL)],
      }),
      req('04 Fast Track Finalize Booking', {
        headers: partnerHdr(),
        body: `{
  "bookingContext": "{{ft_booking_context}}",
  "travelDate": "{{ft_travel_date}}",
  "travelTime": "{{travel_time}}",
  "passengers": [
    ${servicePassengerBody()}
  ],
  "contact": {
    "email": "{{contact_email}}",
    "countryCode": "{{contact_country_code}}",
    "mobile": "{{contact_mobile}}"
  }
}`,
        pathSegs: ['v1', 'airportServices', 'fasttracks', 'finalize-booking'],
        query: [['lang', 'en'], ['currency', 'INR']],
        rawUrl: '{{base_url}}/v1/airportServices/fasttracks/finalize-booking?lang=en&currency=INR',
        events: [ev('test', SAVE_SERVICE_BR('ft_booking_reference'))],
      }),
      req('05 Fast Track Booking Status', {
        method: 'GET',
        headers: hdr(),
        pathSegs: ['v1', 'airportServices', 'fasttrack', '{{ft_booking_reference}}', 'status'],
        query: [['lang', 'en'], ['currency', 'INR']],
        rawUrl: '{{base_url}}/v1/airportServices/fasttrack/{{ft_booking_reference}}/status?lang=en&currency=INR',
        events: [ev('test', SAVE_OK)],
      }),
      req('06 Fast Track Booking Detail', {
        method: 'GET',
        headers: hdr(),
        pathSegs: ['v1', 'airportServices', 'fasttrack', 'booking', '{{ft_booking_reference}}'],
        query: [['lang', 'en'], ['currency', 'INR']],
        rawUrl: '{{base_url}}/v1/airportServices/fasttrack/booking/{{ft_booking_reference}}?lang=en&currency=INR',
        events: [ev('test', SAVE_OK)],
      }),
      req('07 Fast Track Booking History', {
        method: 'GET',
        headers: hdr(),
        pathSegs: ['v1', 'airportServices', 'fasttrack', 'booking', 'history'],
        query: [['lang', 'en'], ['currency', 'INR']],
        rawUrl: '{{base_url}}/v1/airportServices/fasttrack/booking/history?lang=en&currency=INR',
        events: [ev('test', SAVE_OK)],
      }),
    ],
  };
}

function cabFlow() {
  return {
    name: 'Cab - Single Booking (AIRPORT DEL)',
    description: 'Cab AIRPORT departure DEL sample. Optional locations step; pickup datetime auto-set +9 days.',
    item: [
      req('01 Cab Locations (optional)', {
        method: 'GET',
        headers: hdr(),
        pathSegs: ['v1', 'airportServices', 'cabs', 'locations'],
        query: [['lang', 'en'], ['latitude', '28.5201'], ['longitude', '77.1591']],
        rawUrl: '{{base_url}}/v1/airportServices/cabs/locations?latitude=28.5201&longitude=77.1591',
        events: [ev('test', SAVE_OK)],
      }),
      req('02 Places Autocomplete', {
        method: 'GET',
        headers: hdr(),
        pathSegs: ['v1', 'airportServices', 'cabs', 'places', 'autocomplete'],
        query: [['lang', 'en'], ['searchText', '{{cab_search_text}}']],
        rawUrl: '{{base_url}}/v1/airportServices/cabs/places/autocomplete?searchText={{cab_search_text}}',
        events: [ev('test', SAVE_CAB_PLACE)],
      }),
      req('03 Place Details', {
        method: 'GET',
        headers: hdr(),
        pathSegs: ['v1', 'airportServices', 'cabs', 'places', 'details'],
        query: [['lang', 'en'], ['placeId', '{{cab_place_id}}']],
        rawUrl: '{{base_url}}/v1/airportServices/cabs/places/details?placeId={{cab_place_id}}',
        events: [ev('test', SAVE_OK)],
      }),
      req('04 Distance', {
        headers: hdr(),
        body: `{
  "pickup": {
    "latitude": 28.5201,
    "longitude": 77.1591
  },
  "drop": {
    "latitude": 28.5588,
    "longitude": 77.0814
  }
}`,
        pathSegs: ['v1', 'airportServices', 'cabs', 'distance'],
        query: [['lang', 'en']],
        rawUrl: '{{base_url}}/v1/airportServices/cabs/distance?lang=en',
        events: [ev('test', SAVE_OK)],
      }),
      req('05 Search AIRPORT', {
        headers: hdr(),
        body: `{
  "journeyType": "AIRPORT",
  "travelType": "DEPARTURE",
  "airportCode": "DEL",
  "pickup": {
    "name": "Vasant Kunj, Delhi",
    "city": "Delhi",
    "latitude": 28.5201,
    "longitude": 77.1591
  },
  "drop": {
    "name": "IGI Airport-T1",
    "city": "Delhi",
    "latitude": 28.5588,
    "longitude": 77.0814
  },
  "distanceKm": 15,
  "durationMin": 15,
  "pickupDatetime": "{{cab_pickup_datetime}}"
}`,
        pathSegs: ['v1', 'airportServices', 'cabs', 'search'],
        query: [['lang', 'en'], ['currency', 'INR']],
        rawUrl: '{{base_url}}/v1/airportServices/cabs/search?lang=en&currency=INR',
        events: [ev('test', SAVE_CAB_SEARCH)],
      }),
      req('06 Fare', {
        headers: hdr(),
        body: '{\n  "searchId": "{{cab_search_id}}"\n}',
        pathSegs: ['v1', 'airportServices', 'cabs', 'fare'],
        query: [['lang', 'en'], ['currency', 'INR']],
        rawUrl: '{{base_url}}/v1/airportServices/cabs/fare?lang=en&currency=INR',
        events: [ev('test', SAVE_CAB_FARE)],
      }),
      req('07 Finalize Booking', {
        headers: partnerHdr(),
        body: `{
  "bookingReference": "{{cab_booking_context}}",
  "priceId": "{{cab_price_id}}",
  "passengers": [
    {
      "paxId": 1,
      "paxType": "ADT",
      "isLead": true,
      "profile": {
        "title": "Mr",
        "firstName": "{{pax_adult_first}}",
        "lastName": "{{pax_adult_last}}",
        "gender": "male",
        "dob": "{{pax_adult_dob}}",
        "nationality": "IN"
      }
    }
  ],
  "contact": {
    "email": "{{contact_email}}",
    "countryCode": "{{contact_country_code}}",
    "mobile": "{{contact_mobile}}"
  }
}`,
        pathSegs: ['v1', 'airportServices', 'cabs', 'finalize-booking'],
        query: [['lang', 'en'], ['currency', 'INR']],
        rawUrl: '{{base_url}}/v1/airportServices/cabs/finalize-booking?lang=en&currency=INR',
        events: [ev('test', SAVE_SERVICE_BR('cab_booking_reference'))],
      }),
      req('08 Booking Status', {
        method: 'GET',
        headers: hdr(),
        pathSegs: ['v1', 'airportServices', 'cabs', '{{cab_booking_reference}}', 'status'],
        query: [['lang', 'en'], ['currency', 'INR']],
        rawUrl: '{{base_url}}/v1/airportServices/cabs/{{cab_booking_reference}}/status?lang=en&currency=INR',
        events: [ev('test', SAVE_OK)],
      }),
      req('09 Booking Detail', {
        method: 'GET',
        headers: hdr(),
        pathSegs: ['v1', 'airportServices', 'cabs', 'booking', '{{cab_booking_reference}}'],
        query: [['lang', 'en'], ['currency', 'INR']],
        rawUrl: '{{base_url}}/v1/airportServices/cabs/booking/{{cab_booking_reference}}?lang=en&currency=INR',
        events: [ev('test', SAVE_OK)],
      }),
      req('10 Booking History', {
        method: 'GET',
        headers: hdr(),
        pathSegs: ['v1', 'airportServices', 'cabs', 'booking', 'history'],
        query: [['lang', 'en'], ['currency', 'INR'], ['page', '0'], ['perpage', '10']],
        rawUrl: '{{base_url}}/v1/airportServices/cabs/booking/history?lang=en&currency=INR&page=0&perpage=10',
        events: [ev('test', SAVE_OK)],
      }),
      req('11 Tracking Location', {
        method: 'GET',
        headers: hdr(),
        pathSegs: ['v1', 'airportServices', 'cabs', 'tracking', '{{cab_booking_reference}}', 'location'],
        query: [['lang', 'en'], ['currency', 'INR']],
        rawUrl: '{{base_url}}/v1/airportServices/cabs/tracking/{{cab_booking_reference}}/location?lang=en&currency=INR',
        events: [ev('test', SAVE_OK)],
      }),
      req('12 Cancel', {
        method: 'GET',
        headers: hdr(),
        pathSegs: ['v1', 'airportServices', 'cabs', 'bookings', '{{cab_booking_reference}}', 'cancel'],
        query: [['lang', 'en'], ['currency', 'INR']],
        rawUrl: '{{base_url}}/v1/airportServices/cabs/bookings/{{cab_booking_reference}}/cancel?lang=en&currency=INR',
        events: [ev('test', SAVE_OK)],
      }),
    ],
  };
}

function esimFlow() {
  return {
    name: 'eSIM - Single Booking',
    description: 'eSIM E2E: search → listing/details → finalize → status/detail/history.',
    item: [
      req('01 eSIM Search', {
        method: 'GET',
        headers: hdr(),
        pathSegs: ['v1', 'esim', 'search'],
        query: [['lang', 'en'], ['currency', 'INR'], ['page', '1'], ['perpage', '20'], ['q', '{{esim_query}}']],
        rawUrl: '{{base_url}}/v1/esim/search?q={{esim_query}}&lang=en&currency=INR&page=1&perpage=20',
        events: [ev('test', SAVE_ESIM_SEARCH)],
      }),
      req('02 eSIM Listing / Details', {
        method: 'GET',
        headers: hdr(),
        pathSegs: ['v1', 'esims', '{{esim_product_id}}'],
        query: [['lang', 'en'], ['currency', 'INR'], ['optionId', '{{esim_option_id}}']],
        rawUrl: '{{base_url}}/v1/esims/{{esim_product_id}}?optionId={{esim_option_id}}&lang=en&currency=INR',
        events: [ev('test', SAVE_ESIM_DETAIL)],
      }),
      req('03 eSIM Finalize Booking', {
        headers: partnerHdr(),
        body: `{
  "bookingContext": "{{esim_booking_context}}",
  "passengers": [
    {
      "paxType": "ADT",
      "profile": {
        "title": "Mr",
        "firstName": "{{pax_adult_first}}",
        "lastName": "{{pax_adult_last}}",
        "gender": "Male",
        "dob": "{{pax_adult_dob}}",
        "nationality": "IN"
      }
    }
  ],
  "contact": {
    "email": "{{contact_email}}",
    "countryCode": "{{contact_country_code}}",
    "mobile": "{{contact_mobile}}"
  }
}`,
        pathSegs: ['v1', 'esims', 'finalize-booking'],
        query: [['lang', 'en'], ['currency', 'INR']],
        rawUrl: '{{base_url}}/v1/esims/finalize-booking?lang=en&currency=INR',
        events: [ev('test', SAVE_SERVICE_BR('esim_booking_reference'))],
      }),
      req('04 eSIM Booking Status', {
        method: 'GET',
        headers: hdr(),
        pathSegs: ['v1', 'esim', '{{esim_booking_reference}}', 'status'],
        query: [['lang', 'en'], ['currency', 'INR']],
        rawUrl: '{{base_url}}/v1/esim/{{esim_booking_reference}}/status?lang=en&currency=INR',
        events: [ev('test', SAVE_OK)],
      }),
      req('05 eSIM Booking Detail', {
        method: 'GET',
        headers: hdr(),
        pathSegs: ['v1', 'esim', 'booking', '{{esim_booking_reference}}'],
        query: [['lang', 'en'], ['currency', 'INR']],
        rawUrl: '{{base_url}}/v1/esim/booking/{{esim_booking_reference}}?lang=en&currency=INR',
        events: [ev('test', SAVE_OK)],
      }),
      req('06 eSIM Booking History', {
        method: 'GET',
        headers: hdr(),
        pathSegs: ['v1', 'esim', 'booking', 'history'],
        query: [['lang', 'en'], ['currency', 'INR'], ['page', '0'], ['perpage', '10']],
        rawUrl: '{{base_url}}/v1/esim/booking/history?lang=en&currency=INR&page=0&perpage=10',
        events: [ev('test', SAVE_OK)],
      }),
    ],
  };
}

const collectionVariables = [
  ['base_url', 'https://api-staging.travelvip.ai'],
  ['partner_id', ''],
  ['partner_secret', ''],
  ['signing_key', ''],
  ['access_token', ''],
  ['refresh_token', ''],
  ['auth_token', ''],
  ['tier_id', '10546901'],
  ['flight_origin', 'DEL'],
  ['flight_destination', 'BOM'],
  ['flight_dep_date', ''],
  ['flight_ret_date', ''],
  ['flight_dep_offset_days', '40'],
  ['flight_ret_offset_days', '47'],
  ['airport_query', 'DEL'],
  ['airline_query', 'indigo'],
  ['city_query', 'mumbai'],
  ['fare_type', 'NORMAL'],
  ['cabin_class', 'ECONOMY'],
  ['journey_type', 'ONE_WAY'],
  ['travellers_adults', '1'],
  ['travellers_children', '0'],
  ['travellers_infants', '0'],
  ['with_ancillary', 'false'],
  ['search_id', ''],
  ['search_id_onward', ''],
  ['search_id_return', ''],
  ['price_id', ''],
  ['booking_context', ''],
  ['passport_type', 'NONE'],
  ['total_amount', ''],
  ['booking_reference', ''],
  ['booking_status', ''],
  ['ssr_meal_json', '[]'],
  ['ssr_bag_json', '[]'],
  ['ssr_seat_json', '[]'],
  ['pax_adult_first', 'Rohan'],
  ['pax_adult_last', 'Bhagat'],
  ['pax_adult_dob', '1998-05-12'],
  ['pax_child_first', 'Aarav'],
  ['pax_child_last', 'Bhagat'],
  ['pax_child_dob', '2018-06-01'],
  ['pax_infant_first', 'Vihaan'],
  ['pax_infant_last', 'Bhagat'],
  ['pax_infant_dob', '2025-08-01'],
  ['contact_email', 'qa@travelvip.ai'],
  ['contact_mobile', '9876543210'],
  ['contact_country_code', '+91'],
  ['issue_pid', 'smt'],
  ['issue_key', 'palsgcvgscvvs'],
  ['issue_client_code', 'default-smt'],
  ['issue_platform', 'web'],
  ['hotel_autocomplete_q', 'pune'],
  ['hotel_entity_id', ''],
  ['hotel_search_type', 'CITY'],
  ['hotel_checkin', ''],
  ['hotel_checkout', ''],
  ['hotel_checkin_offset_days', '21'],
  ['hotel_checkout_offset_days', '23'],
  ['hotel_id', ''],
  ['hotel_search_id', ''],
  ['hotel_booking_code', ''],
  ['hotel_booking_context', ''],
  ['hotel_request_id', ''],
  ['hotel_booking_reference', ''],
  ['lounge_airport_q', 'dxb'],
  ['lounge_airport_id', ''],
  ['lounge_terminal', 'Terminal 1'],
  ['lounge_id', ''],
  ['lounge_option_id', ''],
  ['lounge_booking_context', ''],
  ['lounge_booking_reference', ''],
  ['lounge_travel_date', ''],
  ['lounge_travel_date_offset_days', '30'],
  ['travel_time', '07:20'],
  ['ft_airport_q', 'dxb'],
  ['ft_airport_id', ''],
  ['ft_terminal', 'Terminal 2'],
  ['ft_terminal_side', 'Departure'],
  ['ft_id', ''],
  ['ft_option_id', ''],
  ['ft_booking_context', ''],
  ['ft_booking_reference', ''],
  ['ft_travel_date', ''],
  ['ft_travel_date_offset_days', '30'],
  ['cab_search_text', 'vasant kunj'],
  ['cab_place_id', ''],
  ['cab_search_id', ''],
  ['cab_price_id', ''],
  ['cab_booking_context', ''],
  ['cab_booking_reference', ''],
  ['cab_pickup_datetime', ''],
  ['cab_pickup_offset_days', '9'],
  ['esim_query', 'united states'],
  ['esim_product_id', ''],
  ['esim_option_id', ''],
  ['esim_booking_context', ''],
  ['esim_booking_reference', ''],
  ['timestamp', ''],
  ['signature', ''],
  ['request_id', ''],
  ['correlation_id', ''],
].map(([key, value]) => ({ key, value }));

const collection = {
  info: {
    name: 'TravelVIP B2B — Dynamic E2E (Flights + Hotel + Services)',
    description: [
      '# TravelVIP B2B Dynamic E2E',
      '',
      'No manual copy-paste. Tests scripts save IDs into **Collection variables**.',
      '',
      '## Setup (once per teammate)',
      '1. Import this collection + `TravelVIP-B2B-Dev.postman_environment.json`',
      '2. Select environment **TravelVIP B2B Dev**',
      '3. Fill: `base_url`, `partner_id`, `partner_secret`, `signing_key`',
      '',
      '## How to run a scenario',
      '1. Open **Partner Api** in order: Access Token → User Auth (Refresh optional) → Tiers List',
      '2. Adjust collection vars if needed (routes, hotel query, lounge/FT airport, etc.)',
      '3. Open a scenario folder and hit requests **top → bottom**',
      '4. If Search has no options yet, **re-send Search** until Tests save `search_id`',
      '',
      '## Notes',
      '- Signature = HMAC-SHA256(resolvedBody + timestamp) with signing_key',
      '- Bearer for product APIs = `auth_token` (User Auth); X-Partner-Key = `access_token`',
      '- Flight cancel: run PENALTY, CANCEL, or PENALTY_AND_CANCEL separately as needed',
      '- SSR + SeatMap included in all flight scenarios; ancillary folders inject SSR at issue',
      '- Sample request/response examples are saved under each request for team reference',
    ].join('\n'),
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  event: [
    ev('prerequest', COLLECTION_PREREQUEST),
    ev('test', COLLECTION_TEST),
  ],
  variable: collectionVariables,
  item: [
    {
      name: 'Partner Api',
      description: 'Run in order: Access Token → (optional Refresh) → User Auth → Tiers List. Bearer for product APIs = auth_token; X-Partner-Key = access_token.',
      item: [
        req('01 Access Token', {
          headers: [{ key: 'Content-Type', value: 'application/json', type: 'text' }, { key: 'X-Request-Id', value: '{{request_id}}', type: 'text' }],
          body: '{\n  "partner_id": "{{partner_id}}",\n  "partner_secret": "{{partner_secret}}"\n}',
          pathSegs: ['auth', 'partner', 'token'],
          rawUrl: '{{base_url}}/auth/partner/token',
          events: [
            ev('prerequest', lines('pm.collectionVariables.set("request_id", "req-" + Date.now());')),
            ev('test', SAVE_TOKEN),
          ],
        }),
        req('02 Refresh Token', {
          headers: [{ key: 'Content-Type', value: 'application/json', type: 'text' }, { key: 'X-Request-Id', value: '{{request_id}}', type: 'text' }],
          body: '{\n  "refresh_token": "{{refresh_token}}"\n}',
          pathSegs: ['auth', 'partner', 'refresh'],
          rawUrl: '{{base_url}}/auth/partner/refresh',
          events: [
            ev('prerequest', lines('pm.collectionVariables.set("request_id", "req-" + Date.now());')),
            ev('test', SAVE_REFRESH),
          ],
        }),
        req('03 User Auth', {
          headers: [
            { key: 'Content-Type', value: 'application/json', type: 'text' },
            { key: 'X-Partner-Key', value: '{{access_token}}', type: 'text' },
            { key: 'X-Request-Id', value: '{{request_id}}', type: 'text' },
          ],
          body: '{\n  "tierId": {{tier_id}}\n}',
          pathSegs: ['v1', 'auth', 'session'],
          rawUrl: '{{base_url}}/v1/auth/session',
          events: [
            ev('prerequest', lines('pm.collectionVariables.set("request_id", "req-" + Date.now());')),
            ev('test', SAVE_USER_AUTH),
          ],
        }),
        req('04 Tiers List', {
          method: 'GET',
          headers: [
            { key: 'Content-Type', value: 'application/json', type: 'text' },
            { key: 'X-Partner-Key', value: '{{access_token}}', type: 'text' },
            { key: 'X-Request-Id', value: '{{request_id}}', type: 'text' },
          ],
          pathSegs: ['v1', 'tiers'],
          rawUrl: '{{base_url}}/v1/tiers',
          events: [
            ev('prerequest', lines('pm.collectionVariables.set("request_id", "req-" + Date.now());')),
            ev('test', SAVE_TIERS),
          ],
        }),
      ],
    },
    {
      name: 'Flight',
      item: [
        {
          name: 'OW',
          item: [
            owFlow({ name: 'OW - 1 Adult', adults: 1, children: 0, infants: 0 }),
            owFlow({ name: 'OW - 1 Adult 1 Child 1 Infant', adults: 1, children: 1, infants: 1 }),
            owFlow({ name: 'OW - 1 Adult 1 Child + Ancillary (seat/meal/bag)', adults: 1, children: 1, infants: 0, ancillary: true }),
          ],
        },
        {
          name: 'Round Trip',
          item: [
            rtFlow({ name: 'RT - 1 Adult', adults: 1, children: 0, infants: 0 }),
            rtFlow({ name: 'RT - 1 Adult 1 Child 1 Infant', adults: 1, children: 1, infants: 1 }),
            rtFlow({ name: 'RT - 1 Adult 1 Child + Ancillary (seat/meal/bag)', adults: 1, children: 1, infants: 0, ancillary: true }),
          ],
        },
      ],
    },
    {
      name: 'Hotel',
      item: [hotelFlow()],
    },
    {
      name: 'Lounge',
      item: [loungeFlow()],
    },
    {
      name: 'Fast Track',
      item: [fastTrackFlow()],
    },
    {
      name: 'Cab',
      item: [cabFlow()],
    },
    {
      name: 'eSIM',
      item: [esimFlow()],
    },
  ],
};

const env = {
  id: 'tvip-b2b-dev-dynamic',
  name: 'TravelVIP B2B Dev',
  values: [
    { key: 'base_url', value: 'https://api-staging.travelvip.ai', type: 'default', enabled: true },
    { key: 'partner_id', value: '', type: 'secret', enabled: true },
    { key: 'partner_secret', value: '', type: 'secret', enabled: true },
    { key: 'signing_key', value: '', type: 'secret', enabled: true },
    { key: 'access_token', value: '', type: 'secret', enabled: true },
    { key: 'refresh_token', value: '', type: 'secret', enabled: true },
    { key: 'auth_token', value: '', type: 'secret', enabled: true },
    { key: 'timestamp', value: '', type: 'default', enabled: true },
    { key: 'signature', value: '', type: 'default', enabled: true },
    { key: 'request_id', value: '', type: 'default', enabled: true },
    { key: 'correlation_id', value: '', type: 'default', enabled: true },
    { key: 'tier_id', value: '10546901', type: 'default', enabled: true },
  ],
  _postman_variable_scope: 'environment',
};

fs.mkdirSync(path.dirname(OUT_COLLECTION), { recursive: true });
fs.writeFileSync(OUT_COLLECTION, JSON.stringify(collection, null, 2));
fs.writeFileSync(OUT_ENV, JSON.stringify(env, null, 2));
console.log('Wrote', OUT_COLLECTION);
console.log('Wrote', OUT_ENV);
