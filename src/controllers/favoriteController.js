import asyncHandler from '../utils/asyncHandler.js';
import { addFavorite, getFavorites, removeFavorite } from '../services/favoriteService.js';

export const getMyFavorites = asyncHandler(async (req, res) => {
  const favorites = await getFavorites(req.user);
  res.status(200).json({ success: true, favorites });
});

export const addMyFavorite = asyncHandler(async (req, res) => {
  const favorites = await addFavorite(req.user, req.params.productId);
  res.status(200).json({ success: true, favorites });
});

export const removeMyFavorite = asyncHandler(async (req, res) => {
  const favorites = await removeFavorite(req.user, req.params.productId);
  res.status(200).json({ success: true, favorites });
});
