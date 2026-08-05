import asyncHandler from '../utils/asyncHandler.js';
import {
  createAddress,
  deleteAddress,
  listAddresses,
  updateAddress,
} from '../services/addressService.js';

export const getAddresses = asyncHandler(async (req, res) => {
  const addresses = await listAddresses(req.user);
  res.status(200).json({ success: true, addresses });
});

export const createMyAddress = asyncHandler(async (req, res) => {
  const address = await createAddress(req.user, req.body || {});
  res.status(201).json({ success: true, address });
});

export const updateMyAddress = asyncHandler(async (req, res) => {
  const address = await updateAddress(req.user, req.params.id, req.body || {});
  res.status(200).json({ success: true, address });
});

export const deleteMyAddress = asyncHandler(async (req, res) => {
  const result = await deleteAddress(req.user, req.params.id);
  res.status(200).json({ success: true, ...result });
});
