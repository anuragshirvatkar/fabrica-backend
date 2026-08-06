import Buyer from '../models/Buyer.js';
import {
  BUSINESS_TYPES,
  BUDGET_RANGES,
  FABRIC_PREFERENCES,
  INDUSTRIES,
  INTEREST_OPTIONS,
  ORDER_QUANTITY_RANGES,
} from '../constants/buyerPreferences.js';
import { createError } from '../utils/errors.js';

const normalizeList = (values, allowed) => {
  if (!Array.isArray(values)) return [];
  const allowedLower = new Map(allowed.map((item) => [item.toLowerCase(), item]));
  const seen = new Set();
  const result = [];
  for (const raw of values) {
    const key = String(raw || '').trim().toLowerCase();
    if (!key || !allowedLower.has(key)) continue;
    const value = allowedLower.get(key);
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
};

const normalizeChoice = (value, allowed, fieldName) => {
  const match = allowed.find(
    (item) => item.toLowerCase() === String(value || '').trim().toLowerCase(),
  );
  if (!match) {
    throw createError(`Invalid ${fieldName}`, 400, 'VALIDATION_ERROR');
  }
  return match;
};

export const formatBuyer = (buyer) => ({
  _id: buyer._id,
  userId: buyer.userId,
  businessType: buyer.businessType,
  businessTypeOther: buyer.businessTypeOther || '',
  industry: buyer.industry,
  industryOther: buyer.industryOther || '',
  interests: buyer.interests || [],
  preferredFabrics: buyer.preferredFabrics || [],
  typicalOrderQuantity: buyer.typicalOrderQuantity,
  budgetRange: buyer.budgetRange,
  createdAt: buyer.createdAt,
  updatedAt: buyer.updatedAt,
});

export const sanitizeBuyerPayload = (payload) => {
  const businessType = normalizeChoice(payload.businessType, BUSINESS_TYPES, 'businessType');
  const industry = normalizeChoice(payload.industry, INDUSTRIES, 'industry');
  const typicalOrderQuantity = normalizeChoice(
    payload.typicalOrderQuantity,
    ORDER_QUANTITY_RANGES,
    'typicalOrderQuantity',
  );
  const budgetRange = normalizeChoice(payload.budgetRange, BUDGET_RANGES, 'budgetRange');
  const preferredFabrics = normalizeList(payload.preferredFabrics, FABRIC_PREFERENCES);
  const interests = normalizeList(payload.interests, INTEREST_OPTIONS);

  if (!preferredFabrics.length) {
    throw createError('Select at least one preferred fabric', 400, 'VALIDATION_ERROR');
  }

  if (!interests.length) {
    throw createError('Select at least one interest', 400, 'VALIDATION_ERROR');
  }

  const businessTypeOther =
    businessType === 'Other' ? String(payload.businessTypeOther || '').trim() : '';
  const industryOther = industry === 'Other' ? String(payload.industryOther || '').trim() : '';

  if (businessType === 'Other' && !businessTypeOther) {
    throw createError('Please describe your business type', 400, 'VALIDATION_ERROR');
  }

  if (industry === 'Other' && !industryOther) {
    throw createError('Please describe your industry', 400, 'VALIDATION_ERROR');
  }

  return {
    businessType,
    businessTypeOther,
    industry,
    industryOther,
    interests,
    preferredFabrics,
    typicalOrderQuantity,
    budgetRange,
  };
};

export const createBuyerProfile = async (userId, payload) => {
  const existing = await Buyer.findOne({ userId }).select('_id').lean();
  if (existing) {
    throw createError('Buyer profile already exists', 409, 'BUYER_EXISTS');
  }

  const data = sanitizeBuyerPayload(payload);
  const buyer = await Buyer.create({ userId, ...data });
  return formatBuyer(buyer);
};

export const getBuyerByUserId = async (userId) => {
  const buyer = await Buyer.findOne({ userId });
  if (!buyer) {
    throw createError('Buyer profile not found', 404, 'BUYER_NOT_FOUND');
  }
  return formatBuyer(buyer);
};

export const getBuyerPreferencesLean = async (userId) => {
  if (!userId) return null;
  return Buyer.findOne({ userId }).lean();
};

export const updateBuyerProfile = async (userId, payload) => {
  const buyer = await Buyer.findOne({ userId });
  if (!buyer) {
    throw createError('Buyer profile not found', 404, 'BUYER_NOT_FOUND');
  }

  const data = sanitizeBuyerPayload(payload);
  Object.assign(buyer, data);
  await buyer.save();
  return formatBuyer(buyer);
};

export const formatBuyerPrefsForAi = (buyer) => {
  if (!buyer) return '';
  const interests = (buyer.interests || []).join(', ') || 'n/a';
  const fabrics = (buyer.preferredFabrics || []).join(', ') || 'n/a';
  const businessType =
    buyer.businessType === 'Other' && buyer.businessTypeOther
      ? `Other (${buyer.businessTypeOther})`
      : buyer.businessType || 'n/a';
  const industry =
    buyer.industry === 'Other' && buyer.industryOther
      ? `Other (${buyer.industryOther})`
      : buyer.industry || 'n/a';
  return [
    `business type: ${businessType}`,
    `industry: ${industry}`,
    `interests: ${interests}`,
    `preferred fabrics: ${fabrics}`,
    `typical order quantity: ${buyer.typicalOrderQuantity || 'n/a'}`,
    `budget range: ${buyer.budgetRange || 'n/a'}`,
  ].join('; ');
};

export const getBuyerOnboardingOptions = () => ({
  businessTypes: BUSINESS_TYPES,
  industries: INDUSTRIES,
  interests: INTEREST_OPTIONS,
  preferredFabrics: FABRIC_PREFERENCES,
  typicalOrderQuantities: ORDER_QUANTITY_RANGES,
  budgetRanges: BUDGET_RANGES,
});
