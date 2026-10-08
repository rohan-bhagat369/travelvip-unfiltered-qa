import { CAB_QUERY, buildFinalizeBody, pickCab, searchBodyForJourney } from './helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

export class CabService {
  constructor(client) {
    this.client = client;
  }

  async search(body) {
    return this.client.request({
      method: 'POST',
      path: '/v1/airportServices/cabs/search',
      query: CAB_QUERY,
      body,
      correlation: true,
    });
  }

  async fare(searchId) {
    return this.client.request({
      method: 'POST',
      path: '/v1/airportServices/cabs/fare',
      query: CAB_QUERY,
      body: { searchId },
      correlation: true,
    });
  }

  async finalizeBooking(payload) {
    return this.client.request({
      method: 'POST',
      path: '/v1/airportServices/cabs/finalize-booking',
      query: CAB_QUERY,
      body: payload,
      correlation: true,
      // X-Partner-Key = partner access_token from /auth/partner/token
      partnerKey: this.client.partnerKey,
    });
  }

  async getBookingStatus(bookingRefId) {
    return this.client.request({
      method: 'GET',
      path: `/v1/airportServices/cabs/${bookingRefId}/status`,
      query: CAB_QUERY,
      correlation: true,
    });
  }

  async cancelBooking(bookingRefId) {
    return this.client.request({
      method: 'GET',
      path: `/v1/airportServices/cabs/bookings/${bookingRefId}/cancel`,
      query: CAB_QUERY,
      correlation: true,
      // X-Partner-Key = partner access_token from /auth/partner/token
      partnerKey: this.client.partnerKey,
    });
  }

  /**
   * Auth session must already be on the client.
   * Flow: Search → Fare → Book → Status → Cancel
   */
  async runBookingFlow(journeyType, { statusPollMs = 2000, statusAttempts = 5 } = {}) {
    const searchBody = searchBodyForJourney(journeyType);
    const searchResponse = await this.search(searchBody);
    const cab = pickCab(searchResponse.data?.cabs);

    const fareResponse = cab?.searchId
      ? await this.fare(cab.searchId)
      : { ok: false, status: 0, data: { error: 'No cab from search' } };

    const bookingReference = fareResponse.data?.bookingReference;
    const priceId = fareResponse.data?.priceId;

    const finalizePayload =
      bookingReference && priceId
        ? buildFinalizeBody({ bookingReference, priceId })
        : null;

    const finalizeResponse = finalizePayload
      ? await this.finalizeBooking(finalizePayload)
      : { ok: false, status: 0, data: { error: 'Missing fare bookingReference/priceId' } };

    const bookingRefId =
      finalizeResponse.data?.bookingRefId ||
      finalizeResponse.data?.bookingReferenceId ||
      null;

    let statusResponse = null;
    if (bookingRefId) {
      for (let i = 0; i < statusAttempts; i++) {
        statusResponse = await this.getBookingStatus(bookingRefId);
        const status = String(statusResponse.data?.status || '').toLowerCase();
        if (status && status !== 'pending') break;
        if (i < statusAttempts - 1) await sleep(statusPollMs);
      }
    }

    const cancelResponse = bookingRefId
      ? await this.cancelBooking(bookingRefId)
      : { ok: false, status: 0, data: { error: 'No bookingRefId to cancel' } };

    return {
      journeyType: String(journeyType).toUpperCase(),
      searchBody,
      searchResponse,
      selectedCab: cab,
      fareResponse,
      finalizeResponse,
      bookingRefId,
      bookingStatus: statusResponse?.data?.status || finalizeResponse.data?.status || null,
      statusResponse,
      cancelResponse,
    };
  }
}
