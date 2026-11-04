import {
  expectArray,
  expectBoolean,
  expectDefined,
  expectJwt,
  expectNumber,
  expectOneOf,
  expectString,
} from '../lib/validators.js';

export function validatePartnerTokenResponse(data) {
  expectString(data.access_token, { minLength: 10 });
  expectString(data.refresh_token, { minLength: 10 });
  expectNumber(data.expires_in, { min: 1 });
}

export function validatePartnerRefreshResponse(data) {
  expectString(data.access_token, { minLength: 10 });
  expectNumber(data.expires_in, { min: 1 });
}

export function validateSessionResponse(data, expectedTierId) {
  expectJwt(data.auth_token);
  expectNumber(data.expires_in, { min: 1 });
  if (data.tier_id !== undefined) {
    expectNumber(data.tier_id, { min: 1 });
    if (expectedTierId !== undefined) {
      expect(data.tier_id).toBe(expectedTierId);
    }
  }
}

export function validateTierCampaign(campaign) {
  expectDefined(campaign);
  if (campaign.campaignID !== undefined) expectNumber(campaign.campaignID, { min: 1 });
  if (campaign.title) expectString(campaign.title);
  if (campaign.category) expectString(campaign.category);
}

export function validateTier(tier) {
  expectNumber(tier.tierId, { min: 1 });
  expectString(tier.title);
  if (tier.currency) expectString(tier.currency, { minLength: 3 });
  if (tier.defaultTier !== undefined) expectBoolean(tier.defaultTier);
  if (tier.campaigns?.length) {
    tier.campaigns.forEach(validateTierCampaign);
  }
}

export function validateTiersList(data) {
  expectArray(data, { minLength: 1 });
  data.forEach(validateTier);
}
