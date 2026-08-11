import Seller from '../models/Seller.js';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import Notification from '../models/Notification.js';
import Review from '../models/Review.js';
import User from '../models/User.js';
import { createError } from '../utils/errors.js';

/**
 * Wipe a seller's marketplace data but keep the User login.
 * After this, login works and seller setup shows again.
 */
export const resetSellerAccountData = async (email) => {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) throw createError('Email is required', 400, 'INVALID_EMAIL');

  const user = await User.findOne({ email: normalized });
  if (!user) throw createError(`No user found for ${normalized}`, 404, 'USER_NOT_FOUND');
  if (user.role !== 'SELLER') {
    throw createError(
      `User ${normalized} is role ${user.role}, not SELLER. Refusing to reset.`,
      400,
      'NOT_A_SELLER',
    );
  }
  if (user.deletedAt) {
    throw createError('This account is soft-deleted. Reset refused.', 400, 'ACCOUNT_DELETED');
  }

  const sellerId = user._id;
  const products = await Product.find({ sellerId }).select('_id').lean();
  const productIds = products.map((product) => product._id);
  const orders = await Order.find({ sellerId }).select('_id').lean();
  const orderIds = orders.map((order) => order._id);

  const [
    payments,
    ordersDeleted,
    reviews,
    productsDeleted,
    sellerProfiles,
    sellerNotifications,
    orderNotifications,
  ] = await Promise.all([
    Payment.deleteMany({
      $or: [
        { sellerId },
        ...(orderIds.length ? [{ orderId: { $in: orderIds } }] : []),
      ],
    }),
    Order.deleteMany({ sellerId }),
    productIds.length
      ? Review.deleteMany({ productId: { $in: productIds } })
      : Promise.resolve({ deletedCount: 0 }),
    Product.deleteMany({ sellerId }),
    Seller.deleteMany({ userId: sellerId }),
    Notification.deleteMany({ userId: sellerId }),
    orderIds.length
      ? Notification.deleteMany({ orderId: { $in: orderIds } })
      : Promise.resolve({ deletedCount: 0 }),
  ]);

  user.fcmTokens = [];
  await user.save();

  return {
    email: user.email,
    userId: user._id,
    role: user.role,
    keptAccount: true,
    deleted: {
      products: productsDeleted.deletedCount || 0,
      orders: ordersDeleted.deletedCount || 0,
      payments: payments.deletedCount || 0,
      reviews: reviews.deletedCount || 0,
      sellerProfiles: sellerProfiles.deletedCount || 0,
      notificationsForSeller: sellerNotifications.deletedCount || 0,
      notificationsForOrders: orderNotifications.deletedCount || 0,
    },
  };
};
