import { addDays } from '../../../shared/lib/testUtils.js';
import { config } from '../../../shared/config/env.js';

export const CAB_QUERY = { lang: 'en', currency: 'INR' };

/** Pickup datetime ~9 days ahead at 18:35 UTC (matches collection sample window). */
export function futurePickupDatetime(daysFromNow = 9) {
  const d = addDays(new Date(), daysFromNow);
  d.setUTCHours(18, 35, 58, 0);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function buildAirportSearchBody(pickupDatetime = futurePickupDatetime()) {
  return {
    journeyType: 'AIRPORT',
    travelType: 'DEPARTURE',
    airportCode: 'DEL',
    pickup: {
      name: 'Vasant Kunj, Delhi',
      city: 'Delhi',
      latitude: 28.5201,
      longitude: 77.1591,
    },
    drop: {
      name: 'IGI Airport-T1',
      city: 'Delhi',
      latitude: 28.5588,
      longitude: 77.0814,
    },
    distanceKm: 15,
    durationMin: 15,
    pickupDatetime,
  };
}

export function buildOutstationSearchBody(pickupDatetime = futurePickupDatetime()) {
  return {
    journeyType: 'OUTSTATION',
    travelType: 'DEPARTURE',
    pickup: {
      name: 'Keshav Nagar, Pune',
      city: 'Pune',
      latitude: 18.5518,
      longitude: 73.9467,
    },
    drop: {
      name: 'Viman Nagar, Pune',
      city: 'Pune',
      latitude: 18.5679,
      longitude: 73.9143,
    },
    distanceKm: 8,
    durationMin: 25,
    pickupDatetime,
  };
}

export function buildRentalSearchBody(pickupDatetime = futurePickupDatetime()) {
  return {
    journeyType: 'RENTAL',
    travelType: 'DEPARTURE',
    pickup: {
      name: 'Keshav Nagar, Pune',
      city: 'Pune',
      latitude: 18.5518,
      longitude: 73.9467,
    },
    drop: {
      name: 'Keshav Nagar, Pune',
      city: 'Pune',
      latitude: 18.5518,
      longitude: 73.9467,
    },
    distanceKm: 20,
    durationMin: 120,
    pickupDatetime,
  };
}

export function searchBodyForJourney(journeyType) {
  switch (String(journeyType).toUpperCase()) {
    case 'AIRPORT':
      return buildAirportSearchBody();
    case 'OUTSTATION':
      return buildOutstationSearchBody();
    case 'RENTAL':
      return buildRentalSearchBody();
    default:
      throw new Error(`Unknown cab journeyType: ${journeyType}`);
  }
}

/** Prefer recommended / priced options; skip fareId "Unknown" when alternatives exist. */
export function pickCab(cabs = []) {
  if (!Array.isArray(cabs) || cabs.length === 0) return null;

  const withSearchId = cabs.filter((c) => c?.searchId);
  const preferred = withSearchId.find(
    (c) => Array.isArray(c.tags) && c.tags.includes('RECOMMENDED') && c.fareId && c.fareId !== 'Unknown',
  );
  if (preferred) return preferred;

  const knownFare = withSearchId.find((c) => c.fareId && c.fareId !== 'Unknown');
  if (knownFare) return knownFare;

  return withSearchId[0] || null;
}

export function buildFinalizeBody({ bookingReference, priceId }) {
  return {
    bookingReference,
    priceId,
    passengers: [
      {
        paxId: 1,
        paxType: 'ADT',
        isLead: true,
        profile: {
          title: 'Mr',
          firstName: config.cab.passengerFirstName,
          lastName: config.cab.passengerLastName,
          gender: 'male',
          dob: config.cab.passengerDob,
          nationality: 'IN',
        },
      },
    ],
    contact: {
      email: config.cab.contactEmail,
      countryCode: config.cab.contactCountryCode,
      mobile: config.cab.contactMobile,
    },
    otherDetails: 'API automation test booking — please cancel',
  };
}
