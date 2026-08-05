import asyncHandler from '../utils/asyncHandler.js';
import {
  addToCart,
  clearCart,
  getCart,
  removeCartItem,
  updateCartItem,
} from '../services/cartService.js';

export const getMyCart = asyncHandler(async (req, res) => {
  const cart = await getCart(req.user);
  res.status(200).json({ success: true, cart });
});

export const addItem = asyncHandler(async (req, res) => {
  const cart = await addToCart(req.user, req.body || {});
  res.status(200).json({ success: true, cart });
});

export const updateItem = asyncHandler(async (req, res) => {
  const cart = await updateCartItem(req.user, req.params.itemId, req.body?.quantity);
  res.status(200).json({ success: true, cart });
});

export const removeItem = asyncHandler(async (req, res) => {
  const cart = await removeCartItem(req.user, req.params.itemId);
  res.status(200).json({ success: true, cart });
});

export const clearMyCart = asyncHandler(async (req, res) => {
  const cart = await clearCart(req.user);
  res.status(200).json({ success: true, cart });
});
