import Buyer from '../models/Buyer.js';
import Cart from '../models/Cart.js';
import Favorite from '../models/Favorite.js';
import Address from '../models/Address.js';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import Review from '../models/Review.js';
import Notification from '../models/Notification.js';
import Conversation from '../models/Conversation.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import { createError } from '../utils/errors.js';

const restoreStockForOrders = async (orders) => {
  let restoredLines = 0;
  for (const order of orders) {
    for (const item of order.items || []) {
      if (!item.productId || !item.quantity) continue;
      await Product.findByIdAndUpdate(item.productId, {
        $inc: { availableQuantity: item.quantity },
      });
      restoredLines += 1;
    }
  }
  return restoredLines;
};

/**
 * Wipe a buyer's marketplace data but keep the User login.
 * After this, login works and buyer setup shows again.
 */
export const resetBuyerAccountData = async (email) => {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) throw createError('Email is required', 400, 'INVALID_EMAIL');

  const user = await User.findOne({ email: normalized });
  if (!user) throw createError(`No user found for ${normalized}`, 404, 'USER_NOT_FOUND');
  if (user.role !== 'BUYER') {
    throw createError(
      `User ${normalized} is role ${user.role}, not BUYER. Refusing to reset.`,
      400,
      'NOT_A_BUYER',
    );
  }
  if (user.deletedAt) {
    throw createError('This account is soft-deleted. Reset refused.', 400, 'ACCOUNT_DELETED');
  }

  const buyerId = user._id;
  const orders = await Order.find({ buyerId }).lean();
  const orderIds = orders.map((order) => order._id);

  const stockRestored = await restoreStockForOrders(orders);

  const [
    payments,
    ordersDeleted,
    reviews,
    addresses,
    carts,
    favorites,
    conversations,
    buyerProfiles,
    buyerNotifications,
    orderNotifications,
  ] = await Promise.all([
    Payment.deleteMany({ $or: [{ buyerId }, ...(orderIds.length ? [{ orderId: { $in: orderIds } }] : [])] }),
    Order.deleteMany({ buyerId }),
    Review.deleteMany({ buyerId }),
    Address.deleteMany({ buyerId }),
    Cart.deleteMany({ buyerId }),
    Favorite.deleteMany({ buyerId }),
    Conversation.deleteMany({ buyerId }),
    Buyer.deleteMany({ userId: buyerId }),
    Notification.deleteMany({ userId: buyerId }),
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
      orders: ordersDeleted.deletedCount || 0,
      payments: payments.deletedCount || 0,
      reviews: reviews.deletedCount || 0,
      addresses: addresses.deletedCount || 0,
      carts: carts.deletedCount || 0,
      favorites: favorites.deletedCount || 0,
      conversations: conversations.deletedCount || 0,
      buyerProfiles: buyerProfiles.deletedCount || 0,
      notificationsForBuyer: buyerNotifications.deletedCount || 0,
      notificationsForOrders: orderNotifications.deletedCount || 0,
      stockLinesRestored: stockRestored,
    },
  };
};
