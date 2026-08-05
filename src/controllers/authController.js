import asyncHandler from '../utils/asyncHandler.js';
import { syncUserFromFirebase, getAuthProfile } from '../services/authService.js';

export const syncAuth = asyncHandler(async (req, res) => {
  const role = req.body.role ? String(req.body.role).toUpperCase() : undefined;

  const result = await syncUserFromFirebase({
    decodedToken: req.firebaseUser,
    role,
  });

  res.status(200).json({
    success: true,
    user: result.user,
    sellerSetupCompleted: result.sellerSetupCompleted,
  });
});

export const getMe = asyncHandler(async (req, res) => {
  const result = await getAuthProfile(req.user);

  res.status(200).json({
    success: true,
    user: result.user,
    sellerSetupCompleted: result.sellerSetupCompleted,
  });
});
