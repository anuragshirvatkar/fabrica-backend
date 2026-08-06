import Payment from '../models/Payment.js';
import Order from '../models/Order.js';
import Seller from '../models/Seller.js';
import { createError } from '../utils/errors.js';

const formatPayment = (payment) => ({
  _id: payment._id,
  sellerId: payment.sellerId,
  orderId: payment.orderId,
  buyerId: payment.buyerId,
  payerName: payment.payerName,
  amount: payment.amount,
  currency: payment.currency || 'INR',
  status: payment.status,
  source: payment.source,
  reference: payment.reference,
  note: payment.note || '',
  createdAt: payment.createdAt,
  updatedAt: payment.updatedAt,
});

const buildReference = (orderId) => {
  const stamp = Date.now().toString(36).toUpperCase();
  const tail = String(orderId).slice(-6).toUpperCase();
  return `PAY-${tail}-${stamp}`;
};

/** Idempotent: create a system payment when an order is delivered. */
export const ensurePaymentForDeliveredOrder = async (order) => {
  if (!order || order.status !== 'COMPLETED') return null;

  if (order.paymentId) {
    const existingById = await Payment.findById(order.paymentId);
    if (existingById) return formatPayment(existingById);
  }

  const existing = await Payment.findOne({ orderId: order._id });
  if (existing) {
    if (!order.paymentId || String(order.paymentId) !== String(existing._id)) {
      order.paymentId = existing._id;
      await order.save();
    }
    return formatPayment(existing);
  }

  const payerName =
    order.shippingAddress?.name?.trim() ||
    order.shippingAddress?.companyName?.trim() ||
    'Buyer';

  const payment = await Payment.create({
    sellerId: order.sellerId,
    orderId: order._id,
    buyerId: order.buyerId,
    payerName,
    amount: order.totalAmount,
    currency: 'INR',
    status: 'COMPLETED',
    source: 'SYSTEM',
    reference: buildReference(order._id),
    note: 'System-generated payment recorded when the order was delivered.',
  });

  order.paymentId = payment._id;
  await order.save();

  return formatPayment(payment);
};

export const listSellerPayments = async (user) => {
  if (user.role !== 'SELLER') throw createError('Forbidden', 403, 'FORBIDDEN');

  const seller = await Seller.findOne({ userId: user._id });
  if (!seller) throw createError('Seller profile not found', 404, 'SELLER_NOT_FOUND');

  // Backfill payments for delivered orders that predate this feature.
  const missing = await Order.find({
    sellerId: seller._id,
    status: 'COMPLETED',
    $or: [{ paymentId: null }, { paymentId: { $exists: false } }],
  }).limit(50);

  for (const order of missing) {
    await ensurePaymentForDeliveredOrder(order);
  }

  const payments = await Payment.find({ sellerId: seller._id }).sort({ createdAt: -1 });
  return payments.map(formatPayment);
};

export const getSellerPayment = async (user, paymentId) => {
  if (user.role !== 'SELLER') throw createError('Forbidden', 403, 'FORBIDDEN');

  const seller = await Seller.findOne({ userId: user._id });
  if (!seller) throw createError('Seller profile not found', 404, 'SELLER_NOT_FOUND');

  const payment = await Payment.findOne({ _id: paymentId, sellerId: seller._id });
  if (!payment) throw createError('Payment not found', 404, 'PAYMENT_NOT_FOUND');

  return formatPayment(payment);
};

export const getPaymentForOrder = async (user, orderId) => {
  if (user.role !== 'SELLER') throw createError('Forbidden', 403, 'FORBIDDEN');

  const seller = await Seller.findOne({ userId: user._id });
  if (!seller) throw createError('Seller profile not found', 404, 'SELLER_NOT_FOUND');

  const order = await Order.findOne({ _id: orderId, sellerId: seller._id });
  if (!order) throw createError('Order not found', 404, 'ORDER_NOT_FOUND');

  if (order.status === 'COMPLETED') {
    return ensurePaymentForDeliveredOrder(order);
  }

  const payment = await Payment.findOne({ orderId: order._id, sellerId: seller._id });
  if (!payment) throw createError('Payment not found for this order', 404, 'PAYMENT_NOT_FOUND');
  return formatPayment(payment);
};
