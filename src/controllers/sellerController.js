import asyncHandler from '../utils/asyncHandler.js';
import {
  createSellerProfile,
  getSellerByUserId,
  getSellerDashboard,
  updateSellerProfile,
} from '../services/sellerService.js';

const ensureSellerRole = (req, res) => {
  if (req.user.role !== 'SELLER') {
    res.status(403).json({
      success: false,
      message: 'Only sellers can access this resource',
      code: 'FORBIDDEN',
    });
    return false;
  }
  return true;
};

export const setupSeller = asyncHandler(async (req, res) => {
  if (!ensureSellerRole(req, res)) return;

  const seller = await createSellerProfile(req.user._id, req.body || {});

  res.status(201).json({
    success: true,
    seller,
    sellerSetupCompleted: true,
  });
});

export const getMySellerProfile = asyncHandler(async (req, res) => {
  if (!ensureSellerRole(req, res)) return;

  const seller = await getSellerByUserId(req.user._id);

  res.status(200).json({
    success: true,
    seller,
  });
});

export const getMySellerDashboard = asyncHandler(async (req, res) => {
  if (!ensureSellerRole(req, res)) return;

  const range = String(req.query.range || 'week');
  const dashboard = await getSellerDashboard(req.user._id, range);

  res.status(200).json({
    success: true,
    dashboard,
  });
});

export const updateMySellerProfile = asyncHandler(async (req, res) => {
  if (!ensureSellerRole(req, res)) return;

  if (req.body.email !== undefined) {
    return res.status(400).json({
      success: false,
      message: 'Email cannot be updated',
      code: 'EMAIL_NOT_EDITABLE',
    });
  }

  const seller = await updateSellerProfile(req.user._id, req.body || {});

  res.status(200).json({
    success: true,
    seller,
  });
});
