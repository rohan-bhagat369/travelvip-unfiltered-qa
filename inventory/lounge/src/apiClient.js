const DEFAULT_BASE_URL = 'https://preprod-next-api.travelvip.ai/api/airportServices';

const DEFAULT_QUERY = {
  key: process.env.LOUNGE_API_KEY || 'palsgcvgscvvs',
  pid: process.env.LOUNGE_PID || 'smt',
  platform: 'web',
  client: 'web',
  lang: 'en',
  currency: 'USD',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl(path, query = {}) {
  const params = new URLSearchParams({ ...DEFAULT_QUERY, ...query });
  return `${DEFAULT_BASE_URL}${path}?${params.toString()}`;
}

export class LoungeApiClient {
  constructor(options = {}) {
    this.bearerToken = options.bearerToken || process.env.LOUNGE_BEARER_TOKEN;
    this.requestDelayMs = options.requestDelayMs ?? 150;
    this.maxRetries = options.maxRetries ?? 2;
    this.carouselSize = options.carouselSize ?? 100;

    if (!this.bearerToken) {
      throw new Error('Missing LOUNGE_BEARER_TOKEN environment variable');
    }
  }

  async request(url, init = {}) {
    let lastError;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await fetch(url, {
          ...init,
          headers: {
            accept: 'application/json, text/plain, */*',
            'content-type': 'application/json',
            authorization: `Bearer ${this.bearerToken}`,
            ...(init.headers || {}),
          },
        });

        const text = await response.text();
        let data;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          throw new Error(`Invalid JSON response (${response.status})`);
        }

        if (!response.ok) {
          throw new Error(
            data?.message || data?.error || `HTTP ${response.status}`,
          );
        }

        if (this.requestDelayMs > 0) {
          await sleep(this.requestDelayMs);
        }

        return data;
      } catch (error) {
        lastError = error;
        if (attempt < this.maxRetries) {
          await sleep(300 * (attempt + 1));
        }
      }
    }

    throw lastError;
  }

  async getAirportServices(iataCode) {
    return this.request(
      buildUrl('/airport-services', {
        q: iataCode,
        page: 0,
        size: 20,
        type: 'lounge',
      }),
    );
  }

  async getTerminalLounges(airportId, terminal) {
    const url = buildUrl('/carousels', {
      type: 'tab',
      slug: 'lounge-pass-list',
      size: String(this.carouselSize),
    });

    return this.request(url, {
      method: 'POST',
      body: JSON.stringify({
        appliedFilters: {
          airportId: String(airportId),
          terminal,
        },
      }),
    });
  }
}

export function extractLoungesFromCarousel(response) {
  const loungeBlock = response?.results?.find((item) => item.type === 'lounge-product');
  const lounges = loungeBlock?.data ?? [];

  return {
    totalCount: loungeBlock?.totalCount ?? lounges.length,
    lounges: lounges.map((item) => ({
      productId: item.productId,
      title: item.title,
      terminal: item.selectedOption?.terminal || item.availableOptions?.[0]?.terminal || '',
      direction: item.selectedOption?.direction || item.availableOptions?.[0]?.direction || '',
      security: item.selectedOption?.security || item.availableOptions?.[0]?.security || '',
      price: item.startingPrice?.totalAmount ?? '',
      currency: item.startingPrice?.currency ?? '',
    })),
  };
}
