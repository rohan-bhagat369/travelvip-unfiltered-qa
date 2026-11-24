import fs from "fs";
import path from "path";
import { authenticate } from "../../shared/lib/authService.js";
const root = "d:/Travel VIP API Automation";
for (const line of fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  const k = m[1].trim();
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!process.env[k]) process.env[k] = v;
}
process.env.BASE_URL = "https://zeta-api.travelx.ai";
const { client } = await authenticate(true);
client.setPartnerKey(client.partnerKey || process.env.PARTNER_ID);
const Q = { lang: "en", currency: "INR" };
const air = await client.request({ method: "GET", path: "/v1/airports/search", query: { ...Q, page: 0, perpage: 20, q: "Indira Gandhi" }, correlation: true, partnerKey: client.partnerKey });
const results = air.data?.results || [];
const del = results.find((r) => r.airportCode === "DEL") || results[0];
console.log("pick", del && { id: del.airportId, code: del.airportCode, name: del.airportName, terminals: del.terminals });
if (!del) process.exit(0);
const terminal = Array.isArray(del.terminals) ? del.terminals[0] : del.terminals;
const lounge = await client.request({ method: "GET", path: "/v1/lounges", query: { ...Q, page: 0, perpage: 5, airportId: del.airportId, terminal }, correlation: true, partnerKey: client.partnerKey });
console.log("lounges", lounge.status, JSON.stringify(lounge.data).slice(0, 400));
const ft = await client.request({ method: "GET", path: "/v1/fasttracks", query: { ...Q, page: 0, perpage: 5, airportId: del.airportId, terminal }, correlation: true, partnerKey: client.partnerKey });
console.log("fasttracks", ft.status, JSON.stringify(ft.data).slice(0, 400));
