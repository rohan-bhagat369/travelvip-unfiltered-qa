/** Shared hotel regression fixtures — partner B2B staging/canary. */

export const PAN_ROHAN = { panCardNumber: 'EUIPB1672M', panCardName: 'Rohan Bhagat' };
export const PAN_ATUL = { panCardNumber: 'ADDPU6247P', panCardName: 'Atul Ugale' };
export const INVALID_PAN = 'BADPAN';

export const GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

export const HILLTOP = { entityId: '39627872', name: 'Hilltop Hotel Mumbai' };

export const CITY_MUMBAI = { type: 'CITY', entityId: '357389:IN', name: 'Mumbai' };

export const RIYA_HOTELS = [
  { entityId: '39627872', name: 'Hilltop Hotel Mumbai' },
  { entityId: '39604638', name: 'Treebo Diamond Residency' },
  { entityId: '39626537', name: 'New Vasantashram' },
  { entityId: '15599148', name: 'Hotel Haveli, Pune' },
  { entityId: '39613471', name: 'Hotel Indie Stays' },
  { entityId: '32923366', name: 'Tanvi Guest House' },
  { entityId: '16320317', name: 'Hotel National Residency' },
];

export const VENDOR_CODE_RE = /!TB!RIYA!TB!|\bRIYA\b/i;

export const PRICE_TOLERANCE = 0.05;

export function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function moneyEq(a, b, tol = PRICE_TOLERANCE) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= tol;
}

export function totalOf(block) {
  if (block == null) return null;
  if (typeof block === 'number') return money(block);
  return money(
    block.totalAmount
    ?? block.salesSummary?.totalAmount
    ?? block.price?.totalAmount
    ?? block.amount,
  );
}

export function uniqueEmail(prefix = 'hotel.reg') {
  return `${prefix}.${Date.now()}@travelvip.ai`;
}

export function vendorLeak(text) {
  return VENDOR_CODE_RE.test(String(text || ''));
}
