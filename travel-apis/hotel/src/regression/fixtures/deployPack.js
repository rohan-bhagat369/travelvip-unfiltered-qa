/** Shared fixtures for hotel deploy-pack probes (no book). */
export const DEPLOY_CHECKIN = process.env.HOTEL_CHECKIN || '2026-09-23';
export const DEPLOY_CHECKOUT = process.env.HOTEL_CHECKOUT || '2026-09-24';

export const DEPLOY_CITIES = [
  { key: 'Delhi', entityId: '227760:IN' },
  { key: 'Mumbai', entityId: '357389:IN' },
  { key: 'Bangalore', entityId: '341153:IN' },
  { key: 'Chennai', entityId: '228269:IN' },
  { key: 'Pune', entityId: '328605:IN' },
  { key: 'Hyderabad', entityId: '227706:IN' },
  { key: 'Goa', entityId: '328649:IN' },
  { key: 'Ahmedabad', entityId: '246774:IN' },
];

/** Changelog example for sold-out SRP reshape. */
export const SAHARA_STAR_ENTITY_ID = '39649446';

export const UNAVAIL_ROOMS = [{ adults: 6, children: 0, childrenAges: [] }];
export const AVAIL_ROOMS = [{ adults: 1, children: 0, childrenAges: [] }];

export const STAR_FILTER_VALUES = [3, 4, 5];
