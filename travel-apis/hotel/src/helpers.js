import { config } from '../../../shared/config/env.js';
import { futureDate } from '../../../shared/lib/testUtils.js';
import { pollUntil } from '../flight/helpers.js';

export const HOTEL_QUERY = { lang: 'en', currency: 'INR' };

export function buildRoomOccupancy(overrides = {}) {
  const adults = overrides.adults ?? config.hotel.defaultAdults;
  const children = overrides.children ?? config.hotel.defaultChildren;
  const childrenAges = overrides.childrenAges ?? config.hotel.defaultChildrenAges;
  return [{ adults, children, childrenAges }];
}

export function buildSearchBody({
  entityId = config.hotel.defaultEntityId,
  checkinDays = config.hotel.checkinDaysFromNow,
  nights = config.hotel.nights,
  nationality = config.hotel.nationality,
  rooms = buildRoomOccupancy(),
} = {}) {
  const checkin = futureDate(checkinDays);
  const checkout = futureDate(checkinDays + nights);
  return {
    checkin,
    checkout,
    entityId: String(entityId),
    nationality,
    type: 'HOTEL',
    rooms,
  };
}

export function buildDetailsBody(searchBody) {
  const { checkin, checkout, entityId, nationality, rooms } = searchBody;
  return { checkin, checkout, entityId: String(entityId), nationality, rooms };
}

export function buildGuests(overrides = {}) {
  const guests = [
    {
      title: overrides.title || 'Mr.',
      firstName: overrides.firstName || config.hotel.guestFirstName,
      lastName: overrides.lastName || config.hotel.guestLastName,
      type: 'Adult',
      isLead: true,
    },
  ];

  const childAge = overrides.childAge ?? config.hotel.defaultChildrenAges?.[0];
  if (config.hotel.defaultChildren > 0 && childAge != null) {
    guests.push({
      title: 'Mr.',
      firstName: config.hotel.guestFirstName,
      lastName: config.hotel.guestLastName,
      type: 'Child',
      age: childAge,
      isLead: false,
    });
  }

  return guests;
}

export function buildFinalizeBody({
  bookingContext,
  bookingCode,
  requestId,
  checkin,
  checkout,
  guests = buildGuests(),
  contact = {
    email: config.hotel.contactEmail,
    countryCode: config.hotel.contactCountryCode,
    mobile: config.hotel.contactMobile,
  },
}) {
  return {
    bookingContext,
    bookingCode,
    requestId,
    checkin,
    checkout,
    rooms: [{ guests }],
    contact,
  };
}

export function extractEntityId(autocompleteData, preferQuery) {
  const content = autocompleteData?.content;
  if (!Array.isArray(content) || content.length === 0) return null;

  if (preferQuery) {
    const q = String(preferQuery).toLowerCase();
    const match = content.find((item) => String(item.title || '').toLowerCase().includes(q));
    if (match?.entityId) return String(match.entityId);
  }

  const hotel = content.find((item) => String(item.type || '').toUpperCase() === 'HOTEL');
  return String((hotel || content[0]).entityId);
}

export function extractRequestId(data) {
  return data?.requestId || null;
}

export function extractBookingCodes(detailsData, limit = 20) {
  const rooms = detailsData?.results?.[0]?.rooms;
  if (!Array.isArray(rooms)) return [];

  const sorted = [...rooms].sort((a, b) => {
    const aTest = String(a.bookingCode || '').includes('rh-test') ? 0 : 1;
    const bTest = String(b.bookingCode || '').includes('rh-test') ? 0 : 1;
    return aTest - bTest;
  });

  return sorted
    .map((room) => room.bookingCode)
    .filter(Boolean)
    .slice(0, limit);
}

export function extractBookingContext(prebookData) {
  return prebookData?.bookingContext || null;
}

export function isPrebookSuccess(response) {
  return Boolean(response?.ok && extractBookingContext(response.data));
}

export function isTerminalHotelStatus(status) {
  const normalized = String(status || '').toLowerCase();
  return ['confirmed', 'cancelled', 'failed', 'rejected'].includes(normalized);
}

export function analyzeHotelRooms(detailsData) {
  const hotel = detailsData?.results?.[0];
  const rooms = hotel?.rooms || [];
  const available = rooms.filter((room) => room.available !== false && room.bookingCode);
  const testRooms = available.filter((room) => String(room.bookingCode).includes('rh-test'));

  return {
    hotelId: hotel?.id,
    hotelName: hotel?.name,
    totalRooms: rooms.length,
    availableRooms: available.length,
    testRoomCount: testRooms.length,
    bookingCodes: extractBookingCodes(detailsData),
    sampleRoom: available[0] || null,
  };
}

export function isHotelApiError(response) {
  if (!response?.ok) return true;
  const data = response.data;
  if (typeof data?.status === 'number' && data.status >= 400) return true;
  if (data?.error) return true;
  if (Array.isArray(data?.fieldErrors) && data.fieldErrors.length > 0) return true;
  if (data?.title === 'Method argument not valid') return true;
  return false;
}

export { pollUntil };
