import { sleep } from '../../../shared/lib/testUtils.js';
import { config } from '../../../shared/config/env.js';
import {
  HOTEL_QUERY,
  buildDetailsBody,
  buildFinalizeBody,
  buildGuests,
  buildSearchBody,
  extractBookingCodes,
  extractBookingContext,
  extractRequestId,
  isPrebookSuccess,
  isTerminalHotelStatus,
  pollUntil,
} from './helpers.js';

export class HotelService {
  constructor(client) {
    this.client = client;
  }

  async autocomplete(q = config.hotel.autocompleteQuery, page = 1, perpage = 20) {
    return this.client.request({
      method: 'GET',
      path: '/v1/hotels/autocomplete',
      query: { ...HOTEL_QUERY, page, perpage, q },
      correlation: true,
    });
  }

  async search(body = buildSearchBody(), queryExtra = {}) {
    return this.client.request({
      method: 'POST',
      path: '/v1/hotels/search',
      query: { ...HOTEL_QUERY, page: 0, perpage: 20, ...queryExtra },
      body,
      correlation: true,
    });
  }

  async getDetails(searchBody) {
    return this.client.request({
      method: 'POST',
      path: '/v1/hotels/details',
      query: { ...HOTEL_QUERY, page: 0, perpage: 20 },
      body: buildDetailsBody(searchBody),
      correlation: true,
    });
  }

  async prebook({ bookingCode, requestId }) {
    return this.client.request({
      method: 'POST',
      path: '/v1/hotels/prebook',
      query: HOTEL_QUERY,
      body: { bookingCode, requestId },
      correlation: true,
    });
  }

  async finalizeBooking(payload) {
    return this.client.request({
      method: 'POST',
      path: '/v1/hotels/finalize-booking',
      query: { ...HOTEL_QUERY, page: 0, perpage: 20 },
      body: payload,
      correlation: true,
      // X-Partner-Key = partner access_token from /auth/partner/token
      partnerKey: this.client.partnerKey,
    });
  }

  async getBookingStatus(bookingRefId) {
    return this.client.request({
      method: 'GET',
      path: `/v1/hotels/bookings/${bookingRefId}/status`,
      query: HOTEL_QUERY,
      correlation: true,
    });
  }

  async getBookingDetail(bookingRefId) {
    return this.client.request({
      method: 'GET',
      path: `/v1/hotels/bookings/${bookingRefId}`,
      query: HOTEL_QUERY,
      correlation: true,
    });
  }

  async cancelBooking(bookingRefId) {
    return this.client.request({
      method: 'GET',
      path: `/v1/hotels/bookings/${bookingRefId}/cancel`,
      query: HOTEL_QUERY,
      correlation: true,
      // X-Partner-Key = partner access_token from /auth/partner/token
      partnerKey: this.client.partnerKey,
    });
  }

  /** Quote cancel charge/refund without cancelling. Safe to repeat. */
  async penaltyCheck(bookingRefId) {
    return this.client.request({
      method: 'GET',
      path: `/v1/hotels/bookings/${bookingRefId}/penalty-check`,
      query: HOTEL_QUERY,
      correlation: true,
      partnerKey: this.client.partnerKey,
    });
  }

  async bookingHistory(page = 0, perpage = 10) {
    return this.client.request({
      method: 'GET',
      path: '/v1/hotels/bookings/history',
      query: { ...HOTEL_QUERY, page, perpage },
      correlation: true,
    });
  }

  async searchWithDetails(searchBody = buildSearchBody()) {
    const searchResponse = await this.search(searchBody);
    if (!searchResponse.ok) {
      return { searchResponse, detailsResponse: null, requestId: null, bookingCodes: [] };
    }

    const detailsResponse = await this.getDetails(searchBody);
    // Prebook/finalize must use the details requestId (room bookingCodes are scoped to it).
    const requestId =
      (detailsResponse.ok && extractRequestId(detailsResponse.data)) ||
      extractRequestId(searchResponse.data);
    const bookingCodes = detailsResponse.ok ? extractBookingCodes(detailsResponse.data) : [];

    return { searchResponse, detailsResponse, requestId, bookingCodes, searchBody };
  }

  async waitForBookingStatus(bookingRefId, maxAttempts = 48) {
    let lastResponse;
    try {
      lastResponse = await pollUntil(
        () => this.getBookingStatus(bookingRefId),
        (res) => res.ok && isTerminalHotelStatus(res.data?.status),
        { maxAttempts, intervalMs: 5000, label: 'Hotel booking status' },
      );
      return { response: lastResponse, status: lastResponse.data.status, timedOut: false };
    } catch {
      lastResponse = await this.getBookingStatus(bookingRefId);
      return { response: lastResponse, status: lastResponse.data?.status, timedOut: true };
    }
  }

  async bookUntilConfirmed({
    entityId = config.hotel.defaultEntityId,
    checkinDayCandidates = config.hotel.checkinDayCandidates,
    nights = config.hotel.nights,
    guestProfile,
  } = {}) {
    let lastError;

    for (const checkinDays of checkinDayCandidates) {
      const searchBody = buildSearchBody({ entityId, checkinDays, nights });
      const { searchResponse, detailsResponse, requestId, bookingCodes } = await this.searchWithDetails(searchBody);

      if (!searchResponse.ok) {
        lastError = new Error(`Hotel search failed for check-in +${checkinDays}d`);
        continue;
      }
      if (!detailsResponse?.ok) {
        lastError = new Error(`Hotel details failed for check-in +${checkinDays}d`);
        continue;
      }
      if (!requestId || bookingCodes.length === 0) {
        lastError = new Error(`No bookable rooms for check-in +${checkinDays}d`);
        continue;
      }

      for (const bookingCode of bookingCodes) {
        const prebook = await this.prebook({ bookingCode, requestId });
        if (!isPrebookSuccess(prebook)) {
          await sleep(250);
          continue;
        }

        const bookingContext = extractBookingContext(prebook.data);
        const finalize = await this.finalizeBooking(buildFinalizeBody({
          bookingContext,
          bookingCode,
          requestId,
          checkin: searchBody.checkin,
          checkout: searchBody.checkout,
          guests: buildGuests(guestProfile),
        }));

        const bookingRefId = finalize.data?.bookingRefId;
        if (!finalize.ok || !bookingRefId) continue;

        const { response: statusResponse, status, timedOut } = await this.waitForBookingStatus(bookingRefId, 36);
        const normalizedStatus = String(status || '').toLowerCase();

        if (normalizedStatus === 'confirmed') {
          return {
            searchBody,
            requestId,
            bookingCode,
            bookingContext,
            bookingRefId,
            bookingStatus: status,
            statusResponse,
            searchResponse,
            detailsResponse,
            prebookResponse: prebook,
            finalizeResponse: finalize,
          };
        }

        if (normalizedStatus === 'failed' || normalizedStatus === 'rejected') {
          lastError = new Error(`Hotel booking ${bookingRefId} ended with status: ${status}`);
          continue;
        }

        // On staging, vendors can keep bookings Pending for a long time. Treat that as a "soft success"
        // so the E2E flow can still fetch booking detail/cancel and report the BR reference.
        if (normalizedStatus === 'pending') {
          return {
            searchBody,
            requestId,
            bookingCode,
            bookingContext,
            bookingRefId,
            bookingStatus: status,
            statusResponse,
            searchResponse,
            detailsResponse,
            prebookResponse: prebook,
            finalizeResponse: finalize,
            pendingTimedOut: Boolean(timedOut),
          };
        }

        throw new Error(`Hotel booking ${bookingRefId} ended with status: ${status || 'unknown'}`);
      }
    }

    throw lastError || new Error('No confirmed hotel booking after trying available room/date candidates');
  }
}
