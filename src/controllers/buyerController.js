import asyncHandler from '../utils/asyncHandler.js';
import {
  createBuyerProfile,
  getBuyerByUserId,
  getBuyerOnboardingOptions,
  updateBuyerProfile,
} from '../services/buyerService.js';

const ensureBuyerRole = (req, res) => {
  if (req.user.role !== 'BUYER') {
    res.status(403).json({
      success: false,
      message: 'Only buyers can access this resource',
      code: 'FORBIDDEN',
    });
    return false;
  }
  return true;
};

export const getBuyerOptions = asyncHandler(async (_req, res) => {
  res.status(200).json({
    success: true,
    options: getBuyerOnboardingOptions(),
  });
});

export const setupBuyer = asyncHandler(async (req, res) => {
  if (!ensureBuyerRole(req, res)) return;

  const buyer = await createBuyerProfile(req.user._id, req.body || {});

  res.status(201).json({
    success: true,
    buyer,
    buyerSetupCompleted: true,
  });
});

export const getMyBuyerProfile = asyncHandler(async (req, res) => {
  if (!ensureBuyerRole(req, res)) return;

  const buyer = await getBuyerByUserId(req.user._id);

  res.status(200).json({
    success: true,
    buyer,
  });
});

export const updateMyBuyerProfile = asyncHandler(async (req, res) => {
  if (!ensureBuyerRole(req, res)) return;

  const buyer = await updateBuyerProfile(req.user._id, req.body || {});

  res.status(200).json({
    success: true,
    buyer,
  });
});
