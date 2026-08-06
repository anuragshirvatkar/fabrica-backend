import asyncHandler from '../utils/asyncHandler.js';
import { syncUserFromFirebase, getAuthProfile, getSignInHint } from '../services/authService.js';

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
    buyerSetupCompleted: result.buyerSetupCompleted,
  });
});

export const getMe = asyncHandler(async (req, res) => {
  const result = await getAuthProfile(req.user);

  res.status(200).json({
    success: true,
    user: result.user,
    sellerSetupCompleted: result.sellerSetupCompleted,
    buyerSetupCompleted: result.buyerSetupCompleted,
  });
});

export const signInHint = asyncHandler(async (req, res) => {
  const hint = await getSignInHint(req.body?.email);
  res.status(200).json({
    success: true,
    exists: hint.exists,
    providers: hint.providers,
  });
});
