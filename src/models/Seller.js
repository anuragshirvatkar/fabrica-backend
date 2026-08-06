import mongoose from 'mongoose';
import {
  SELLER_FABRIC_TYPES,
  SELLER_MOQ_RANGES,
  SELLER_PRODUCT_CATEGORIES,
} from '../constants/sellerPreferences.js';

const addressSchema = new mongoose.Schema(
  {
    line1: { type: String, default: '', trim: true },
    city: { type: String, default: '', trim: true },
    state: { type: String, default: '', trim: true },
    pincode: { type: String, default: '', trim: true },
    country: { type: String, default: 'India', trim: true },
  },
  { _id: false },
);

const sellerSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    companyName: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    gst: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
    },
    address: {
      type: addressSchema,
      default: () => ({}),
    },
    operatingHours: {
      type: String,
      default: '',
      trim: true,
    },
    operatingHoursOther: {
      type: String,
      default: '',
      trim: true,
    },
    productCategories: {
      type: [
        {
          type: String,
          enum: SELLER_PRODUCT_CATEGORIES,
        },
      ],
      default: [],
    },
    fabricTypes: {
      type: [
        {
          type: String,
          enum: SELLER_FABRIC_TYPES,
        },
      ],
      default: [],
    },
    moqRange: {
      type: String,
      default: '',
      trim: true,
      enum: ['', ...SELLER_MOQ_RANGES],
    },
    verified: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

const Seller = mongoose.model('Seller', sellerSchema);

export default Seller;

export const isSellerProfileComplete = (seller) => {
  if (!seller) return false;
  const address = seller.address || {};
  const hoursOk =
    seller.operatingHours &&
    (seller.operatingHours !== 'Other' || String(seller.operatingHoursOther || '').trim());
  return Boolean(
    seller.companyName &&
      seller.phone &&
      seller.gst &&
      String(address.line1 || '').trim() &&
      String(address.city || '').trim() &&
      String(address.state || '').trim() &&
      String(address.pincode || '').trim() &&
      hoursOk &&
      Array.isArray(seller.productCategories) &&
      seller.productCategories.length > 0 &&
      Array.isArray(seller.fabricTypes) &&
      seller.fabricTypes.length > 0 &&
      seller.moqRange,
  );
};
