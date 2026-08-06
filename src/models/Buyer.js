import mongoose from 'mongoose';
import {
  BUSINESS_TYPES,
  BUDGET_RANGES,
  FABRIC_PREFERENCES,
  INDUSTRIES,
  ORDER_QUANTITY_RANGES,
} from '../constants/buyerPreferences.js';

const buyerSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    businessType: {
      type: String,
      required: true,
      enum: BUSINESS_TYPES,
      trim: true,
    },
    businessTypeOther: {
      type: String,
      default: '',
      trim: true,
    },
    industry: {
      type: String,
      required: true,
      enum: INDUSTRIES,
      trim: true,
    },
    industryOther: {
      type: String,
      default: '',
      trim: true,
    },
    interests: {
      type: [String],
      default: [],
    },
    preferredFabrics: {
      type: [
        {
          type: String,
          enum: FABRIC_PREFERENCES,
        },
      ],
      default: [],
      validate: {
        validator(value) {
          return Array.isArray(value) && value.length > 0;
        },
        message: 'Select at least one preferred fabric',
      },
    },
    typicalOrderQuantity: {
      type: String,
      required: true,
      enum: ORDER_QUANTITY_RANGES,
      trim: true,
    },
    budgetRange: {
      type: String,
      required: true,
      enum: BUDGET_RANGES,
      trim: true,
    },
  },
  { timestamps: true },
);

const Buyer = mongoose.model('Buyer', buyerSchema);

export default Buyer;
