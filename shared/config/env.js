import dotenv from 'dotenv';

dotenv.config();

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  baseUrl: (process.env.BASE_URL && process.env.BASE_URL.trim()) || 'https://api-staging.travelvip.ai',
  partnerId: requireEnv('PARTNER_ID'),
  partnerSecret: requireEnv('PARTNER_SECRET'),
  signingKey: requireEnv('SIGNING_KEY'),
  tierId: Number((process.env.TIER_ID && String(process.env.TIER_ID).trim()) || '10546901'),
  flight: {
    contactEmail: process.env.FLIGHT_CONTACT_EMAIL || 'rohan@travelvip.ai',
    contactMobile: process.env.FLIGHT_CONTACT_MOBILE || '9876543210',
    contactCountryCode: process.env.FLIGHT_CONTACT_COUNTRY_CODE || '+91',
    passengerFirstName: process.env.FLIGHT_PASSENGER_FIRST_NAME || 'Rohan',
    passengerLastName: process.env.FLIGHT_PASSENGER_LAST_NAME || 'Bhagat',
    passengerDob: process.env.FLIGHT_PASSENGER_DOB || '2001-05-29',
    issueTicketQuery: {
    pid: process.env.FLIGHT_ISSUE_PID || 'vgm',
      key: process.env.FLIGHT_ISSUE_KEY || 'palsgcvgscvvs',
      clientCode: process.env.FLIGHT_ISSUE_CLIENT_CODE || 'default-smt',
      platform: process.env.FLIGHT_ISSUE_PLATFORM || 'web',
    },
  },
  hotel: {
    defaultEntityId: process.env.HOTEL_ENTITY_ID || '2869073',
    autocompleteQuery: process.env.HOTEL_AUTOCOMPLETE_QUERY || 'taj dubai',
    guestFirstName: process.env.HOTEL_GUEST_FIRST_NAME || 'Rohan',
    guestLastName: process.env.HOTEL_GUEST_LAST_NAME || 'Bhagat',
    nationality: process.env.HOTEL_NATIONALITY || 'IN',
    checkinDaysFromNow: Number(process.env.HOTEL_CHECKIN_DAYS || '14'),
    nights: Number(process.env.HOTEL_NIGHTS || '2'),
    checkinDayCandidates: (process.env.HOTEL_CHECKIN_CANDIDATES || '14,21,30,45,60,90').split(',').map(Number),
    defaultAdults: Number(process.env.HOTEL_ADULTS || '1'),
    defaultChildren: Number(process.env.HOTEL_CHILDREN || '1'),
    defaultChildrenAges: (process.env.HOTEL_CHILDREN_AGES || '9').split(',').map(Number),
    contactEmail: process.env.HOTEL_CONTACT_EMAIL || process.env.FLIGHT_CONTACT_EMAIL || 'rohan@travelvip.ai',
    contactMobile: process.env.HOTEL_CONTACT_MOBILE || process.env.FLIGHT_CONTACT_MOBILE || '9876543210',
    contactCountryCode: process.env.HOTEL_CONTACT_COUNTRY_CODE || '+91',
  },
  cab: {
    contactEmail: process.env.CAB_CONTACT_EMAIL || process.env.FLIGHT_CONTACT_EMAIL || 'chaitanya@travelvip.ai',
    contactMobile: process.env.CAB_CONTACT_MOBILE || process.env.FLIGHT_CONTACT_MOBILE || '9921862715',
    contactCountryCode: process.env.CAB_CONTACT_COUNTRY_CODE || '+91',
    passengerFirstName: process.env.CAB_PASSENGER_FIRST_NAME || 'Pratik',
    passengerLastName: process.env.CAB_PASSENGER_LAST_NAME || 'Patil',
    passengerDob: process.env.CAB_PASSENGER_DOB || '1990-01-02',
  },
};
