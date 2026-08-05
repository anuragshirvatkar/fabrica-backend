import Address from '../models/Address.js';
import { createError } from '../utils/errors.js';

const MAX_ADDRESSES = 3;

const ensureBuyer = (user) => {
  if (user.role !== 'BUYER') {
    throw createError('Only buyers can manage addresses', 403, 'FORBIDDEN');
  }
};

const formatAddress = (address) => ({
  _id: address._id,
  buyerId: address.buyerId,
  name: address.name,
  companyName: address.companyName || '',
  phone: address.phone,
  addressLine1: address.addressLine1,
  addressLine2: address.addressLine2 || '',
  city: address.city,
  state: address.state,
  country: address.country || 'India',
  postalCode: address.postalCode,
  isDefault: Boolean(address.isDefault),
  createdAt: address.createdAt,
  updatedAt: address.updatedAt,
});

const validatePayload = (payload) => {
  const required = ['name', 'phone', 'addressLine1', 'city', 'state', 'postalCode'];
  for (const key of required) {
    if (!payload[key]?.toString().trim()) {
      throw createError(`${key} is required`, 400, 'VALIDATION_ERROR');
    }
  }
};

export const listAddresses = async (user) => {
  ensureBuyer(user);
  const addresses = await Address.find({ buyerId: user._id }).sort({
    isDefault: -1,
    updatedAt: -1,
  });
  return addresses.map(formatAddress);
};

export const createAddress = async (user, payload) => {
  ensureBuyer(user);
  validatePayload(payload);

  const count = await Address.countDocuments({ buyerId: user._id });
  if (count >= MAX_ADDRESSES) {
    throw createError(`You can save up to ${MAX_ADDRESSES} addresses only`, 400, 'ADDRESS_LIMIT');
  }

  const isDefault = count === 0 ? true : Boolean(payload.isDefault);
  if (isDefault) {
    await Address.updateMany({ buyerId: user._id }, { isDefault: false });
  }

  const address = await Address.create({
    buyerId: user._id,
    name: payload.name.trim(),
    companyName: payload.companyName?.trim() || '',
    phone: payload.phone.trim(),
    addressLine1: payload.addressLine1.trim(),
    addressLine2: payload.addressLine2?.trim() || '',
    city: payload.city.trim(),
    state: payload.state.trim(),
    country: payload.country?.trim() || 'India',
    postalCode: payload.postalCode.trim(),
    isDefault,
  });

  return formatAddress(address);
};

export const updateAddress = async (user, addressId, payload) => {
  ensureBuyer(user);
  const address = await Address.findOne({ _id: addressId, buyerId: user._id });
  if (!address) throw createError('Address not found', 404, 'ADDRESS_NOT_FOUND');

  validatePayload({ ...address.toObject(), ...payload });

  const fields = [
    'name',
    'companyName',
    'phone',
    'addressLine1',
    'addressLine2',
    'city',
    'state',
    'country',
    'postalCode',
  ];

  for (const field of fields) {
    if (payload[field] !== undefined) {
      address[field] = String(payload[field] || '').trim();
    }
  }

  if (payload.isDefault === true) {
    await Address.updateMany({ buyerId: user._id }, { isDefault: false });
    address.isDefault = true;
  }

  await address.save();
  return formatAddress(address);
};

export const deleteAddress = async (user, addressId) => {
  ensureBuyer(user);
  const address = await Address.findOneAndDelete({ _id: addressId, buyerId: user._id });
  if (!address) throw createError('Address not found', 404, 'ADDRESS_NOT_FOUND');

  if (address.isDefault) {
    const next = await Address.findOne({ buyerId: user._id }).sort({ updatedAt: -1 });
    if (next) {
      next.isDefault = true;
      await next.save();
    }
  }

  return { deleted: true, _id: address._id };
};
