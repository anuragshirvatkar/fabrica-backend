import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Address from '../models/Address.js';
import Cart from '../models/Cart.js';
import Seller from '../models/Seller.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { createError } from '../utils/errors.js';
import { createNotification } from './notificationService.js';
import { ensurePaymentForDeliveredOrder } from './paymentService.js';
import {
  LEGACY_STATUS_MAP,
  NEXT_ORDER_STATUS,
  ORDER_STATUS_LABELS,
  SELLER_ACTION_LABELS,
} from '../constants/orderStatuses.js';

const deliveryTimers = new Map();
const AUTO_COMPLETE_MS = 1 * 60_000;

const formatOrder = (order) => ({
  _id: order._id,
  buyerId: order.buyerId,
  sellerId: order.sellerId,
  addressId: order.addressId,
  shippingAddress: order.shippingAddress,
  status: order.status,
  totalAmount: order.totalAmount,
  items: order.items,
  acceptedAt: order.acceptedAt,
  preparingAt: order.preparingAt,
  dispatchedAt: order.dispatchedAt,
  deliveredAt: order.deliveredAt,
  cancelledAt: order.cancelledAt,
  paymentId: order.paymentId || null,
  createdAt: order.createdAt,
  updatedAt: order.updatedAt,
  nextActionLabel: SELLER_ACTION_LABELS[order.status] || null,
  statusLabel: ORDER_STATUS_LABELS[order.status] || order.status,
});

const msUntilAutoComplete = (order) => {
  const dispatchedAt = order.dispatchedAt ? new Date(order.dispatchedAt).getTime() : Date.now();
  return dispatchedAt + AUTO_COMPLETE_MS - Date.now();
};

const scheduleAutoComplete = (orderOrId, dispatchedAt = null) => {
  const orderId = String(orderOrId?._id || orderOrId);
  if (deliveryTimers.has(orderId)) {
    clearTimeout(deliveryTimers.get(orderId));
  }

  let delay = AUTO_COMPLETE_MS;
  if (orderOrId && typeof orderOrId === 'object') {
    delay = Math.max(0, msUntilAutoComplete(orderOrId));
  } else if (dispatchedAt) {
    delay = Math.max(0, new Date(dispatchedAt).getTime() + AUTO_COMPLETE_MS - Date.now());
  }

  const timer = setTimeout(async () => {
    deliveryTimers.delete(orderId);
    try {
      await markOrderCompleted(orderId);
    } catch (error) {
      console.error('[order] auto-complete failed', orderId, error.message);
    }
  }, delay);

  deliveryTimers.set(orderId, timer);
};

/** Legacy name kept for server.js boot hook. */
export const scheduleAutoDeliver = scheduleAutoComplete;

/** If a ready-for-dispatch order is past the auto-complete window, complete it now. */
const catchUpAutoDelivery = async (order) => {
  if (!order) return null;
  if (order.status !== 'READY_FOR_DISPATCH') return formatOrder(order);

  if (msUntilAutoComplete(order) > 0) {
    scheduleAutoComplete(order);
    return formatOrder(order);
  }

  return (await markOrderCompleted(order._id)) || formatOrder(order);
};

/** One-time remap of legacy PLACED/DISPATCHED/DELIVERED values. */
export const migrateLegacyOrderStatuses = async () => {
  let total = 0;
  for (const [from, to] of Object.entries(LEGACY_STATUS_MAP)) {
    const result = await Order.collection.updateMany(
      { status: from },
      { $set: { status: to } },
    );
    total += result.modifiedCount || 0;
  }
  if (total) {
    console.log(`[order] migrated ${total} legacy order status value(s)`);
  }
  return total;
};

/** Re-schedule / complete auto-completions after server restarts. */
export const recoverPendingAutoDeliveries = async () => {
  await migrateLegacyOrderStatuses();

  const pending = await Order.find({ status: 'READY_FOR_DISPATCH' }).select(
    '_id status dispatchedAt',
  );
  let recovered = 0;
  let completed = 0;

  for (const order of pending) {
    if (msUntilAutoComplete(order) <= 0) {
      try {
        await markOrderCompleted(order._id);
        completed += 1;
      } catch (error) {
        console.error('[order] recover auto-complete failed', order._id, error.message);
      }
    } else {
      scheduleAutoComplete(order);
      recovered += 1;
    }
  }

  if (pending.length) {
    console.log(
      `[order] auto-complete recovery: ${completed} completed, ${recovered} re-scheduled (${pending.length} ready)`,
    );
  }
};

export const markOrderCompleted = async (orderId) => {
  const order = await Order.findById(orderId);
  if (!order) return null;
  if (order.status !== 'READY_FOR_DISPATCH') return formatOrder(order);

  order.status = 'COMPLETED';
  order.deliveredAt = new Date();
  await order.save();

  await ensurePaymentForDeliveredOrder(order);

  const buyer = await User.findById(order.buyerId);
  await createNotification({
    userId: order.buyerId,
    title: 'Order Completed',
    body: `Your order #${String(order._id).slice(-6).toUpperCase()} is complete.`,
    type: 'ORDER_COMPLETED',
    orderId: order._id,
    link: `/orders/${order._id}`,
    email: buyer?.email,
  });

  const fresh = await Order.findById(orderId);
  return formatOrder(fresh || order);
};

/** @deprecated use markOrderCompleted */
export const markOrderDelivered = markOrderCompleted;

export const placeOrder = async (user, { addressId, items: rawItems }) => {
  if (user.role !== 'BUYER') {
    throw createError('Only buyers can place orders', 403, 'FORBIDDEN');
  }

  const address = await Address.findOne({ _id: addressId, buyerId: user._id });
  if (!address) throw createError('Shipping address not found', 404, 'ADDRESS_NOT_FOUND');

  let lineItems = rawItems;
  if (!Array.isArray(lineItems) || !lineItems.length) {
    const cart = await Cart.findOne({ buyerId: user._id });
    if (!cart?.items?.length) {
      throw createError('Cart is empty', 400, 'CART_EMPTY');
    }
    lineItems = cart.items.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      colorHex: item.colorHex || '',
      quantity: item.quantity,
    }));
  }

  const productIds = lineItems.map((item) => item.productId);
  const products = await Product.find({ _id: { $in: productIds }, status: 'published' });
  const productMap = new Map(products.map((product) => [String(product._id), product]));

  if (products.length !== new Set(productIds.map(String)).size) {
    throw createError('One or more products are unavailable', 400, 'PRODUCT_UNAVAILABLE');
  }

  const sellerId = products[0].sellerId;
  if (!sellerId) {
    throw createError('Product seller is missing', 400, 'PRODUCT_UNAVAILABLE');
  }
  if (products.some((product) => String(product.sellerId) !== String(sellerId))) {
    throw createError('Checkout currently supports items from one seller at a time', 400, 'MULTI_SELLER');
  }

  const sellerDoc = await Seller.findById(sellerId);
  if (!sellerDoc) {
    throw createError('Seller not found for this product', 400, 'SELLER_NOT_FOUND');
  }

  const orderItems = [];
  let totalAmount = 0;

  for (const line of lineItems) {
    const product = productMap.get(String(line.productId));
    const qty = Number(line.quantity);
    const moq = product.moq || 1;

    if (!qty || qty < moq) {
      throw createError(`MOQ for ${product.name} is ${moq}`, 400, 'VALIDATION_ERROR');
    }
    if (product.availableQuantity != null && qty > product.availableQuantity) {
      throw createError(`Insufficient stock for ${product.name}`, 400, 'OUT_OF_STOCK');
    }

    let variant = null;
    if (product.variants?.length) {
      if (!line.variantId) {
        throw createError(
          `Please select a color for ${product.name}. Order each color separately.`,
          400,
          'COLOR_REQUIRED',
        );
      }

      variant =
        product.variants.id(line.variantId) ||
        product.variants.find((entry) => String(entry._id) === String(line.variantId));

      if (!variant) {
        throw createError(
          `Selected color is no longer available for ${product.name}. Remove it from cart and choose again.`,
          400,
          'COLOR_UNAVAILABLE',
        );
      }
    }

    const price = Number(product.price) || 0;
    totalAmount += price * qty;

    // Snapshot the exact buyer-selected color (never substitute another variant).
    const colorHex = variant?.colorHex || line.colorHex || '';
    const image = variant?.images?.[0] || '';

    orderItems.push({
      productId: product._id,
      variantId: variant?._id || line.variantId || null,
      productName: product.name,
      colorHex,
      image,
      unit: product.unit || 'meter',
      quantity: qty,
      price,
    });
  }

  // Reduce stock
  for (const item of orderItems) {
    const product = productMap.get(String(item.productId));
    product.availableQuantity = Math.max(0, (product.availableQuantity || 0) - item.quantity);
    await product.save();
  }

  const order = await Order.create({
    buyerId: user._id,
    sellerId: sellerDoc._id,
    addressId: address._id,
    shippingAddress: {
      name: address.name,
      companyName: address.companyName || '',
      phone: address.phone,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2 || '',
      city: address.city,
      state: address.state,
      country: address.country || 'India',
      postalCode: address.postalCode,
    },
    status: 'PENDING',
    totalAmount,
    items: orderItems,
  });

  // Clear purchased items from cart
  const cart = await Cart.findOne({ buyerId: user._id });
  if (cart) {
    const purchasedKeys = new Set(
      orderItems.map((item) => `${item.productId}:${item.variantId || ''}`),
    );
    cart.items = cart.items.filter(
      (item) => !purchasedKeys.has(`${item.productId}:${item.variantId || ''}`),
    );
    await cart.save();
  }

  const sellerUser = await User.findById(sellerDoc.userId);
  const orderCode = String(order._id).slice(-6).toUpperCase();

  await Promise.allSettled([
    createNotification({
      userId: user._id,
      title: 'Order Pending',
      body: `Your order #${orderCode} is pending seller acceptance.`,
      type: 'ORDER_PLACED',
      orderId: order._id,
      link: `/orders/${order._id}`,
      email: user.email,
    }),
    sellerUser
      ? createNotification({
          userId: sellerUser._id,
          title: 'New Order Received',
          body: `You received a new order #${orderCode} for ₹${totalAmount.toLocaleString('en-IN')}.`,
          type: 'ORDER_PLACED',
          orderId: order._id,
          link: `/seller/orders/${order._id}`,
          email: sellerUser.email,
        })
      : Promise.resolve(),
  ]);

  return formatOrder(order);
};

export const listBuyerOrders = async (user) => {
  if (user.role !== 'BUYER') throw createError('Forbidden', 403, 'FORBIDDEN');
  const orders = await Order.find({ buyerId: user._id }).sort({ createdAt: -1 });
  const resolved = [];
  for (const order of orders) {
    resolved.push(await catchUpAutoDelivery(order));
  }
  return resolved;
};

/** Repair orders that notified this seller but were stored under the wrong sellerId. */
const repairSellerOrdersFromNotifications = async (user, seller) => {
  // Only seller-facing alerts — buyers also get ORDER_PLACED ("Order Placed").
  const alerts = await Notification.find({
    userId: user._id,
    type: 'ORDER_PLACED',
    title: 'New Order Received',
    orderId: { $ne: null },
  })
    .select('orderId')
    .sort({ createdAt: -1 })
    .limit(30)
    .lean();

  const orderIds = [...new Set(alerts.map((item) => String(item.orderId)).filter(Boolean))];
  if (!orderIds.length) return 0;

  const candidates = await Order.find({
    _id: { $in: orderIds },
    sellerId: { $ne: seller._id },
  });

  let fixed = 0;
  for (const order of candidates) {
    const productId = order.items?.[0]?.productId;
    if (!productId) continue;
    const product = await Product.findById(productId).select('sellerId');
    // Only adopt the order if the line-item product belongs to this seller.
    if (!product || String(product.sellerId) !== String(seller._id)) continue;
    order.sellerId = seller._id;
    await order.save();
    fixed += 1;
  }

  if (fixed) {
    console.log('[orders:seller-repair]', {
      sellerId: String(seller._id),
      userId: String(user._id),
      fixed,
    });
  }
  return fixed;
};

export const listSellerOrders = async (user) => {
  if (user.role !== 'SELLER') throw createError('Forbidden', 403, 'FORBIDDEN');
  // A user may have more than one Seller row from older setup bugs — include all.
  const sellers = await Seller.find({ userId: user._id });
  if (!sellers.length) throw createError('Seller profile not found', 404, 'SELLER_NOT_FOUND');

  const primarySeller = sellers[0];
  await repairSellerOrdersFromNotifications(user, primarySeller);

  const sellerIds = sellers.flatMap((entry) => [entry._id, String(entry._id)]);
  const orders = await Order.find({
    sellerId: { $in: sellerIds },
  }).sort({ createdAt: -1 });

  const resolved = [];
  for (const order of orders) {
    resolved.push(await catchUpAutoDelivery(order));
  }
  return resolved;
};

export const getOrderForUser = async (user, orderId) => {
  const order = await Order.findById(orderId);
  if (!order) throw createError('Order not found', 404, 'ORDER_NOT_FOUND');

  if (user.role === 'BUYER' && String(order.buyerId) === String(user._id)) {
    return catchUpAutoDelivery(order);
  }

  if (user.role === 'SELLER') {
    const sellers = await Seller.find({ userId: user._id }).select('_id');
    const ownsOrder = sellers.some((entry) => String(order.sellerId) === String(entry._id));
    if (ownsOrder) {
      const current = await catchUpAutoDelivery(order);

      if (current.status === 'COMPLETED' && !current.paymentId) {
        const freshOrder = await Order.findById(orderId);
        if (freshOrder) {
          await ensurePaymentForDeliveredOrder(freshOrder);
          const fresh = await Order.findById(orderId);
          return formatOrder(fresh || freshOrder);
        }
      }
      return current;
    }
  }

  throw createError('Order not found', 404, 'ORDER_NOT_FOUND');
};

const restoreOrderStock = async (order) => {
  for (const item of order.items) {
    await Product.findByIdAndUpdate(item.productId, {
      $inc: { availableQuantity: item.quantity },
    });
  }
};

export const cancelOrder = async (user, orderId) => {
  if (user.role !== 'BUYER') throw createError('Only buyers can cancel orders', 403, 'FORBIDDEN');

  const order = await Order.findOne({ _id: orderId, buyerId: user._id });
  if (!order) throw createError('Order not found', 404, 'ORDER_NOT_FOUND');

  if (order.status !== 'PENDING') {
    throw createError('Only pending orders can be cancelled', 400, 'CANNOT_CANCEL');
  }

  order.status = 'CANCELLED';
  order.cancelledAt = new Date();
  await order.save();

  await restoreOrderStock(order);

  const seller = await Seller.findById(order.sellerId);
  const sellerUser = seller ? await User.findById(seller.userId) : null;
  const orderCode = String(order._id).slice(-6).toUpperCase();

  await Promise.allSettled([
    createNotification({
      userId: user._id,
      title: 'Order Cancelled',
      body: `Your order #${orderCode} was cancelled.`,
      type: 'ORDER_CANCELLED',
      orderId: order._id,
      link: `/orders/${order._id}`,
      email: user.email,
    }),
    sellerUser
      ? createNotification({
          userId: sellerUser._id,
          title: 'Order Cancelled',
          body: `Order #${orderCode} was cancelled by the buyer.`,
          type: 'ORDER_CANCELLED',
          orderId: order._id,
          link: `/seller/orders/${order._id}`,
          email: sellerUser.email,
        })
      : Promise.resolve(),
  ]);

  return formatOrder(order);
};

/** Seller declines a pending order before accepting. */
export const rejectOrder = async (user, orderId) => {
  if (user.role !== 'SELLER') {
    throw createError('Only sellers can reject orders', 403, 'FORBIDDEN');
  }

  const sellers = await Seller.find({ userId: user._id }).select('_id');
  if (!sellers.length) throw createError('Seller profile not found', 404, 'SELLER_NOT_FOUND');

  const order = await Order.findOne({
    _id: orderId,
    sellerId: { $in: sellers.map((entry) => entry._id) },
  });
  if (!order) throw createError('Order not found', 404, 'ORDER_NOT_FOUND');

  if (order.status !== 'PENDING') {
    throw createError('Only pending orders can be rejected', 400, 'CANNOT_REJECT');
  }

  order.status = 'CANCELLED';
  order.cancelledAt = new Date();
  await order.save();

  await restoreOrderStock(order);

  const buyer = await User.findById(order.buyerId);
  const orderCode = String(order._id).slice(-6).toUpperCase();

  if (buyer) {
    await createNotification({
      userId: buyer._id,
      title: 'Order Rejected',
      body: `Order #${orderCode} was rejected by the seller.`,
      type: 'ORDER_CANCELLED',
      orderId: order._id,
      link: `/orders/${order._id}`,
      email: buyer.email,
    });
  }

  return formatOrder(order);
};

export const advanceOrder = async (user, orderId) => {
  if (user.role !== 'SELLER') {
    throw createError('Only sellers can update order status', 403, 'FORBIDDEN');
  }

  const sellers = await Seller.find({ userId: user._id }).select('_id');
  if (!sellers.length) throw createError('Seller profile not found', 404, 'SELLER_NOT_FOUND');

  const order = await Order.findOne({
    _id: orderId,
    sellerId: { $in: sellers.map((entry) => entry._id) },
  });
  if (!order) throw createError('Order not found', 404, 'ORDER_NOT_FOUND');

  const nextStatus = NEXT_ORDER_STATUS[order.status];
  if (!nextStatus) {
    throw createError('This order cannot be advanced further', 400, 'INVALID_STATUS');
  }

  const now = new Date();
  order.status = nextStatus;
  if (nextStatus === 'ACCEPTED') order.acceptedAt = now;
  if (nextStatus === 'PREPARING') order.preparingAt = now;
  if (nextStatus === 'READY_FOR_DISPATCH') order.dispatchedAt = now;
  if (nextStatus === 'COMPLETED') order.deliveredAt = now;
  await order.save();

  const buyer = await User.findById(order.buyerId);
  const orderCode = String(order._id).slice(-6).toUpperCase();

  const notify = {
    ACCEPTED: {
      title: 'Order Accepted',
      body: `Seller accepted order #${orderCode}.`,
      type: 'ORDER_ACCEPTED',
    },
    PREPARING: {
      title: 'Order Preparing',
      body: `Your order #${orderCode} is being prepared.`,
      type: 'ORDER_PREPARING',
    },
    READY_FOR_DISPATCH: {
      title: 'Ready for Dispatch',
      body: `Your order #${orderCode} is ready for dispatch.`,
      type: 'ORDER_READY_FOR_DISPATCH',
    },
    COMPLETED: {
      title: 'Order Completed',
      body: `Your order #${orderCode} is complete.`,
      type: 'ORDER_COMPLETED',
    },
  }[nextStatus];

  if (notify) {
    await createNotification({
      userId: order.buyerId,
      title: notify.title,
      body: notify.body,
      type: notify.type,
      orderId: order._id,
      link: `/orders/${order._id}`,
      email: buyer?.email,
    });
  }

  if (nextStatus === 'READY_FOR_DISPATCH') {
    scheduleAutoComplete(order);
  }

  if (nextStatus === 'COMPLETED') {
    await ensurePaymentForDeliveredOrder(order);
    const fresh = await Order.findById(orderId);
    return formatOrder(fresh || order);
  }

  return formatOrder(order);
};

/** @deprecated Prefer advanceOrder — kept for older clients. */
export const dispatchOrder = async (user, orderId) => {
  const sellers = await Seller.find({ userId: user._id }).select('_id');
  if (!sellers.length) throw createError('Seller profile not found', 404, 'SELLER_NOT_FOUND');

  const order = await Order.findOne({
    _id: orderId,
    sellerId: { $in: sellers.map((entry) => entry._id) },
  });
  if (!order) throw createError('Order not found', 404, 'ORDER_NOT_FOUND');

  // Jump to ready-for-dispatch only from preparing (or accept→… via advance).
  if (order.status === 'PREPARING') {
    return advanceOrder(user, orderId);
  }
  if (order.status === 'PENDING' || order.status === 'ACCEPTED') {
    // Advance one step at a time for safety
    return advanceOrder(user, orderId);
  }
  throw createError('Order is not ready to advance via dispatch', 400, 'INVALID_STATUS');
};
