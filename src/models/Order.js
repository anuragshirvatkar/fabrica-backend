import mongoose from 'mongoose';
import { ORDER_STATUSES } from '../constants/orderStatuses.js';

const orderItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    variantId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    productName: {
      type: String,
      required: true,
      trim: true,
    },
    colorHex: {
      type: String,
      default: '',
    },
    image: {
      type: String,
      default: '',
    },
    unit: {
      type: String,
      default: 'meter',
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false },
);

const addressSnapshotSchema = new mongoose.Schema(
  {
    name: String,
    companyName: { type: String, default: '' },
    phone: String,
    addressLine1: String,
    addressLine2: { type: String, default: '' },
    city: String,
    state: String,
    country: { type: String, default: 'India' },
    postalCode: String,
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    buyerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Seller',
      required: true,
      index: true,
    },
    addressId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Address',
      default: null,
    },
    shippingAddress: {
      type: addressSnapshotSchema,
      required: true,
    },
    status: {
      type: String,
      enum: ORDER_STATUSES,
      default: 'PENDING',
      index: true,
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    items: {
      type: [orderItemSchema],
      required: true,
      validate: {
        validator: (items) => items.length > 0,
        message: 'Order must have at least one item',
      },
    },
    acceptedAt: {
      type: Date,
      default: null,
    },
    preparingAt: {
      type: Date,
      default: null,
    },
    dispatchedAt: {
      type: Date,
      default: null,
    },
    deliveredAt: {
      type: Date,
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      default: null,
      index: true,
    },
  },
  { timestamps: true },
);

const Order = mongoose.model('Order', orderSchema);

export default Order;
