import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema(
  {
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Seller',
      required: true,
      index: true,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      unique: true,
      index: true,
    },
    buyerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    payerName: {
      type: String,
      required: true,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: 'INR',
    },
    status: {
      type: String,
      enum: ['COMPLETED'],
      default: 'COMPLETED',
    },
    source: {
      type: String,
      enum: ['SYSTEM'],
      default: 'SYSTEM',
    },
    reference: {
      type: String,
      required: true,
      unique: true,
    },
    note: {
      type: String,
      default: 'Auto-recorded on order delivery',
    },
  },
  { timestamps: true },
);

paymentSchema.index({ sellerId: 1, createdAt: -1 });

const Payment = mongoose.model('Payment', paymentSchema);

export default Payment;
