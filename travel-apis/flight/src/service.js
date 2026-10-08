import { config } from '../../../shared/config/env.js';
import {
  FLIGHT_QUERY,
  buildIssueTicketPayload,
  buildOneWaySearchBody,
  buildRoundTripSearchBody,
  buildRoundTripSearchIds,
  buildSeatMapPassengers,
  buildSelectionPayload,
  extractFirstSearchId,
  extractOnwardSearchId,
  extractOnwardSearchIds,
  extractReturnSearchId,
  extractRoundTripSearchIds,
  extractSearchIds,
  hasRoundTripSearchPair,
  isSearchProgressComplete,
  isTerminalBookingStatus,
  pollUntil,
} from './helpers.js';

export class FlightService {
  constructor(client) {
    this.client = client;
  }

  async search(body) {
    return this.client.request({
      method: 'POST',
      path: '/v1/flights/search',
      query: { ...FLIGHT_QUERY, page: 0, perpage: 20, sortby: 'fare,asc' },
      body,
      correlation: true,
    });
  }

  async searchUntilComplete(body = buildOneWaySearchBody()) {
    const response = await pollUntil(
      () => this.search(body),
      (res) => res.ok && res.data?.progress?.state === 'COMPLETE' && extractFirstSearchId(res.data),
      { maxAttempts: 25, intervalMs: 4500, label: 'Flight search' },
    );
    return { response, searchId: extractFirstSearchId(response.data), searchIds: extractSearchIds(response.data, 5) };
  }

  async pollReturnSearch(baseBody, refinedBody) {
    return pollUntil(
      async () => {
        const res = await this.search(refinedBody);
        if (!res.ok && res.data?.error?.code === 'SEARCH_CACHE_MISS') {
          await this.search(baseBody);
          return this.search(refinedBody);
        }
        return res;
      },
      (res) => res.ok && (
        hasRoundTripSearchPair(res.data)
        || Boolean(extractReturnSearchId(res.data))
        || isSearchProgressComplete(res.data)
      ),
      { maxAttempts: 25, intervalMs: 4500, label: 'Round-trip flight search (return)' },
    );
  }

  async searchRoundTripUntilComplete(body = buildRoundTripSearchBody()) {
    const MIN_WARMUP_POLLS = 4;
    let polls = 0;

    const initialResponse = await pollUntil(
      async () => {
        polls += 1;
        return this.search(body);
      },
      (res) => res.ok && (
        hasRoundTripSearchPair(res.data)
        || isSearchProgressComplete(res.data)
        || (polls >= MIN_WARMUP_POLLS && extractOnwardSearchId(res.data))
      ),
      { maxAttempts: 60, intervalMs: 4500, label: 'Round-trip flight search' },
    );

    let searchIds = buildRoundTripSearchIds(initialResponse.data);
    if (searchIds.length >= 2) {
      return { response: initialResponse, searchIds, searchId: searchIds[0] };
    }

    const onwardCandidates = extractOnwardSearchIds(initialResponse.data, 5);
    if (!onwardCandidates.length) {
      throw new Error('No onward flight found for round-trip search');
    }

    let lastError;
    for (const onwardId of onwardCandidates) {
      try {
        const refinedBody = {
          ...body,
          selection: { selectedSearchIds: [onwardId] },
        };
        const returnResponse = await this.pollReturnSearch(body, refinedBody);

        searchIds = buildRoundTripSearchIds(returnResponse.data);
        if (searchIds.length < 2) {
          const returnId = extractReturnSearchId(returnResponse.data)
            || extractSearchIds(returnResponse.data, 10).find((id) => id !== onwardId);
          if (!returnId) continue;
          searchIds = [onwardId, returnId];
        }

        if (searchIds.length === 2 && searchIds[0] !== searchIds[1]) {
          return { response: returnResponse, searchIds, searchId: searchIds[0] };
        }
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error('Could not resolve round-trip searchIds from onward candidates');
  }

  async getDetails(searchIds, journeyType = 'ONE_WAY') {
    return this.client.request({
      method: 'POST',
      path: '/v1/flights/details',
      query: FLIGHT_QUERY,
      body: buildSelectionPayload(searchIds, journeyType),
      correlation: true,
    });
  }

  async getFareRules(searchIds, journeyType = 'ONE_WAY') {
    return this.client.request({
      method: 'POST',
      path: '/v1/flights/fareRules',
      query: FLIGHT_QUERY,
      body: buildSelectionPayload(searchIds, journeyType),
      correlation: true,
    });
  }

  async getPricing(searchIds, journeyType = 'ONE_WAY') {
    return this.client.request({
      method: 'POST',
      path: '/v1/flights/pricing',
      query: FLIGHT_QUERY,
      body: buildSelectionPayload(searchIds, journeyType),
      correlation: true,
    });
  }

  async getSsr(priceId) {
    return this.client.request({
      method: 'POST',
      path: '/v1/flights/ssr',
      query: { currency: 'INR', lang: 'en' },
      body: { priceId },
      correlation: true,
    });
  }

  async getSeatMap(bookingContext, passengers = buildSeatMapPassengers(), retries = 3) {
    let lastResponse;
    for (let attempt = 0; attempt < retries; attempt += 1) {
      lastResponse = await this.client.request({
        method: 'POST',
        path: '/v1/flights/seatmap',
        query: FLIGHT_QUERY,
        body: { currency: 'INR', requestReference: bookingContext, passengers },
        correlation: true,
      });
      if (lastResponse.ok || lastResponse.status !== 502) return lastResponse;
      await new Promise((r) => setTimeout(r, 2000));
    }
    return lastResponse;
  }

  async issueTicket({ bookingContext, priceId, searchIds, journeyType = 'ONE_WAY', passengerProfile }) {
    const body = buildIssueTicketPayload({
      bookingContext, priceId, searchIds, journeyType, passengerProfile,
    });
    return this.client.request({
      method: 'POST',
      path: '/v1/flights/booking/issue-ticket',
      query: { ...config.flight.issueTicketQuery, ...FLIGHT_QUERY, count: 10, page: 0, perpage: 20 },
      body,
      correlation: true,
      partnerKey: this.client.partnerKey,
    });
  }

  async issueTicketV2(payload) {
    return this.client.request({
      method: 'POST',
      path: '/api/v2/flights/booking/issue-ticket',
      query: {
        ...config.flight.issueTicketQuery,
        pid: process.env.FLIGHT_ISSUE_PID || config.flight.issueTicketQuery.pid || 'vgm',
        ...FLIGHT_QUERY,
        count: 10,
        page: 0,
        perpage: 20,
      },
      body: payload,
      correlation: true,
      partnerKey: this.client.partnerKey,
    });
  }

  async cancelV2(body) {
    return this.client.request({
      method: 'POST',
      path: '/api/v2/flight/cancel',
      query: FLIGHT_QUERY,
      body,
      correlation: true,
      partnerKey: this.client.partnerKey,
    });
  }

  async getBookingStatus(bookingReference) {
    return this.client.request({
      method: 'GET',
      path: `/v1/flights/booking/${bookingReference}/status`,
      query: FLIGHT_QUERY,
      correlation: true,
    });
  }

  async getBookingDetail(bookingReference) {
    return this.client.request({
      method: 'GET',
      path: `/v1/flights/booking/${bookingReference}`,
      query: FLIGHT_QUERY,
      correlation: true,
    });
  }

  async checkCancellationPenalty(bookingReference, extra = {}) {
    const opts = extra && typeof extra === 'object' && !Array.isArray(extra) ? extra : {};
    const pnr = opts.pnr;
    return this.client.request({
      method: 'POST',
      path: `/v1/flights/booking/${bookingReference}/cancel`,
      query: FLIGHT_QUERY,
      body: {
        action: 'PENALTY',
        ...(pnr ? { pnr } : {}),
        ...(opts.cancelledBy ? { cancelledBy: opts.cancelledBy } : {}),
      },
      partnerKey: this.client.partnerKey,
    });
  }

  async cancelBooking(bookingReference, extra = {}) {
    const opts = extra && typeof extra === 'object' && !Array.isArray(extra) ? extra : {};
    return this.client.request({
      method: 'POST',
      path: `/v1/flights/booking/${bookingReference}/cancel`,
      query: FLIGHT_QUERY,
      body: {
        action: 'CANCEL',
        ...(opts.pnr ? { pnr: opts.pnr } : {}),
        ...(opts.cancelledBy ? { cancelledBy: opts.cancelledBy } : {}),
      },
      partnerKey: this.client.partnerKey,
    });
  }

  async waitForBookingStatus(bookingReference, maxAttempts = 36) {
    let lastResponse;
    try {
      lastResponse = await pollUntil(
        () => this.getBookingStatus(bookingReference),
        (res) => res.ok && isTerminalBookingStatus(res.data?.status),
        { maxAttempts, intervalMs: 5000, label: 'Booking status' },
      );
      return { response: lastResponse, status: lastResponse.data.status, timedOut: false };
    } catch {
      lastResponse = await this.getBookingStatus(bookingReference);
      return { response: lastResponse, status: lastResponse.data?.status, timedOut: true };
    }
  }

  async bookUntilConfirmed(searchIds, journeyType = 'ONE_WAY') {
    const candidates = journeyType === 'ROUND_TRIP'
      ? [Array.isArray(searchIds) ? searchIds : [searchIds]]
      : (Array.isArray(searchIds) ? searchIds : [searchIds]).map((id) => id);

    for (const candidate of candidates) {
      const ids = journeyType === 'ROUND_TRIP' ? candidate : [candidate];
      const pricing = await this.getPricing(ids, journeyType);
      if (!pricing.ok) continue;

      const issue = await this.issueTicket({
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        searchIds: ids,
        journeyType,
      });
      if (!issue.ok) continue;

      const bookingReference = issue.data.bookingReference;
      const { response: statusResponse, status } = await this.waitForBookingStatus(bookingReference);

      if (String(status).toLowerCase() === 'confirmed') {
        return {
          searchIds: ids,
          searchId: ids[0],
          priceId: pricing.data.priceId,
          bookingContext: pricing.data.bookingContext,
          bookingReference,
          bookingStatus: status,
          statusResponse,
        };
      }
    }

    throw new Error(`No confirmed ${journeyType} booking after trying available flight option(s)`);
  }

  async airportSearch(airport = 'BOM', tripType) {
    const query = { ...FLIGHT_QUERY, airport, page: 0, perpage: 10 };
    // tripType=domestic → India only; international or omit → unfiltered. Do not send legacy domestic=.
    if (tripType) query.tripType = tripType;
    return this.client.request({
      method: 'GET',
      path: '/v1/flights/airports',
      query,
    });
  }

  async airlineSearch(airline = 'AI') {
    return this.client.request({
      method: 'GET',
      path: '/v1/flights/airlines',
      query: { ...FLIGHT_QUERY, airline, page: 0, perpage: 10 },
    });
  }

  async citySearch(q = 'Pune') {
    return this.client.request({
      method: 'GET',
      path: '/v1/flights/citySearch',
      query: { ...FLIGHT_QUERY, q, page: 0, perpage: 10 },
    });
  }

  async bookingHistory() {
    return this.client.request({
      method: 'GET',
      path: '/v1/flights/bookings/history',
      query: { ...FLIGHT_QUERY, page: 1, perpage: 10, status: 'Confirmed' },
      correlation: true,
    });
  }
}
