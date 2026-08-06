import Seller, { isSellerProfileComplete } from '../models/Seller.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import {
  INDIAN_STATES,
  OPERATING_HOURS,
  SELLER_FABRIC_TYPES,
  SELLER_MOQ_RANGES,
  SELLER_PRODUCT_CATEGORIES,
} from '../constants/sellerPreferences.js';
import { createError } from '../utils/errors.js';

const normalizeList = (values, allowed) => {
  if (!Array.isArray(values)) return [];
  const allowedLower = new Map(allowed.map((item) => [item.toLowerCase(), item]));
  const seen = new Set();
  const result = [];
  for (const raw of values) {
    const key = String(raw || '').trim().toLowerCase();
    if (!key || !allowedLower.has(key)) continue;
    const value = allowedLower.get(key);
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
};

const normalizeChoice = (value, allowed, fieldName) => {
  const match = allowed.find(
    (item) => item.toLowerCase() === String(value || '').trim().toLowerCase(),
  );
  if (!match) {
    throw createError(`Invalid ${fieldName}`, 400, 'VALIDATION_ERROR');
  }
  return match;
};

export const formatSeller = (seller) => ({
  _id: seller._id,
  userId: seller.userId,
  companyName: seller.companyName,
  phone: seller.phone,
  gst: seller.gst,
  description: seller.description || '',
  address: {
    line1: seller.address?.line1 || '',
    city: seller.address?.city || '',
    state: seller.address?.state || '',
    pincode: seller.address?.pincode || '',
    country: seller.address?.country || 'India',
  },
  operatingHours: seller.operatingHours || '',
  operatingHoursOther: seller.operatingHoursOther || '',
  productCategories: seller.productCategories || [],
  fabricTypes: seller.fabricTypes || [],
  moqRange: seller.moqRange || '',
  verified: seller.verified,
  createdAt: seller.createdAt,
  updatedAt: seller.updatedAt,
});

export const sanitizeSellerPayload = (payload) => {
  const companyName = String(payload.companyName || '').trim();
  const phone = String(payload.phone || '').trim();
  const gst = String(payload.gst || '').trim();
  const description = String(payload.description || '').trim();

  if (!companyName || !phone || !gst) {
    throw createError('companyName, phone and gst are required', 400, 'VALIDATION_ERROR');
  }

  const line1 = String(payload.address?.line1 || payload.line1 || '').trim();
  const city = String(payload.address?.city || payload.city || '').trim();
  const stateRaw = String(payload.address?.state || payload.state || '').trim();
  const pincode = String(payload.address?.pincode || payload.pincode || '').trim();
  const country = String(payload.address?.country || payload.country || 'India').trim() || 'India';

  if (!line1 || !city || !stateRaw || !pincode) {
    throw createError('Business address is required', 400, 'VALIDATION_ERROR');
  }

  const stateMatch = INDIAN_STATES.find(
    (item) => item.toLowerCase() === stateRaw.toLowerCase(),
  );
  const state = stateMatch || stateRaw;
  const operatingHours = normalizeChoice(
    payload.operatingHours,
    OPERATING_HOURS,
    'operatingHours',
  );
  const operatingHoursOther =
    operatingHours === 'Other' ? String(payload.operatingHoursOther || '').trim() : '';
  if (operatingHours === 'Other' && !operatingHoursOther) {
    throw createError('Please describe your operating hours', 400, 'VALIDATION_ERROR');
  }

  const productCategories = normalizeList(payload.productCategories, SELLER_PRODUCT_CATEGORIES);
  const fabricTypes = normalizeList(payload.fabricTypes, SELLER_FABRIC_TYPES);
  const moqRange = normalizeChoice(payload.moqRange, SELLER_MOQ_RANGES, 'moqRange');

  if (!productCategories.length) {
    throw createError('Select at least one product category', 400, 'VALIDATION_ERROR');
  }
  if (!fabricTypes.length) {
    throw createError('Select at least one fabric type', 400, 'VALIDATION_ERROR');
  }

  return {
    companyName,
    phone,
    gst,
    description,
    address: { line1, city, state, pincode, country },
    operatingHours,
    operatingHoursOther,
    productCategories,
    fabricTypes,
    moqRange,
  };
};

export { isSellerProfileComplete };

const RANGE_OPTIONS = new Set(['week', 'month', 'year', 'all']);

const startOfDay = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOfDay = (date) => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};

const resolveRange = (rangeInput = 'week') => {
  const range = RANGE_OPTIONS.has(rangeInput) ? rangeInput : 'week';
  const now = new Date();
  const end = endOfDay(now);

  if (range === 'all') {
    return {
      range,
      start: null,
      end,
      label: 'All time',
      bucket: 'month',
    };
  }

  if (range === 'month') {
    const start = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
    return { range, start, end, label: 'This month', bucket: 'day' };
  }

  if (range === 'year') {
    const start = startOfDay(new Date(now.getFullYear(), 0, 1));
    return { range, start, end, label: 'This year', bucket: 'month' };
  }

  // week = last 7 days including today
  const start = startOfDay(new Date(now));
  start.setDate(start.getDate() - 6);
  return { range, start, end, label: 'This week', bucket: 'day' };
};

const emptySeries = (start, end, bucket) => {
  const points = [];
  if (!start) return points;

  if (bucket === 'day') {
    const cursor = new Date(start);
    while (cursor <= end) {
      const key = cursor.toISOString().slice(0, 10);
      points.push({
        key,
        label: cursor.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
        sales: 0,
        orders: 0,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return points;
  }

  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor <= last) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
    points.push({
      key,
      label: cursor.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
      sales: 0,
      orders: 0,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return points;
};

const aggregateOrders = async (sellerId, start, end) => {
  const match = {
    sellerId,
    status: { $ne: 'CANCELLED' },
  };
  if (start) {
    match.createdAt = { $gte: start, $lte: end };
  }

  const [totals] = await Order.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalSales: { $sum: '$totalAmount' },
        orderCount: { $sum: 1 },
      },
    },
  ]);

  return {
    totalSales: totals?.totalSales || 0,
    orderCount: totals?.orderCount || 0,
  };
};

export const createSellerProfile = async (userId, payload) => {
  const data = sanitizeSellerPayload(payload);
  const existing = await Seller.findOne({ userId });

  // Incomplete legacy sellers complete onboarding via the same setup endpoint.
  if (existing) {
    Object.assign(existing, data);
    await existing.save();
    return formatSeller(existing);
  }

  const seller = await Seller.create({ userId, ...data });
  return formatSeller(seller);
};

export const getSellerByUserId = async (userId) => {
  const seller = await Seller.findOne({ userId });

  if (!seller) {
    throw createError('Seller profile not found', 404, 'SELLER_NOT_FOUND');
  }

  return formatSeller(seller);
};

export const updateSellerProfile = async (userId, payload) => {
  const seller = await Seller.findOne({ userId });

  if (!seller) {
    throw createError('Seller profile not found', 404, 'SELLER_NOT_FOUND');
  }

  const data = sanitizeSellerPayload(payload);
  Object.assign(seller, data);
  await seller.save();
  return formatSeller(seller);
};

export const getSellerDashboard = async (userId, rangeInput = 'week') => {
  const seller = await Seller.findOne({ userId });
  if (!seller) {
    throw createError('Seller profile not found', 404, 'SELLER_NOT_FOUND');
  }

  const { range, start, end, label, bucket } = resolveRange(rangeInput);
  const sellerId = seller._id;

  const orderMatch = {
    sellerId,
    status: { $ne: 'CANCELLED' },
  };
  if (start) {
    orderMatch.createdAt = { $gte: start, $lte: end };
  }

  const dateFormat = bucket === 'day' ? '%Y-%m-%d' : '%Y-%m';

  const LOW_STOCK_THRESHOLD = 100;

  const [
    totals,
    seriesRaw,
    recentOrders,
    publishedCount,
    draftCount,
    pendingOrderCount,
    pendingOrders,
    inventoryProducts,
  ] = await Promise.all([
    aggregateOrders(sellerId, start, end),
    Order.aggregate([
      { $match: orderMatch },
      {
        $group: {
          _id: {
            $dateToString: { format: dateFormat, date: '$createdAt' },
          },
          sales: { $sum: '$totalAmount' },
          orders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Order.find(orderMatch)
      .sort({ createdAt: -1 })
      .limit(6)
      .select('_id status totalAmount createdAt items'),
    Product.countDocuments({ sellerId, status: 'published' }),
    Product.countDocuments({ sellerId, status: 'draft' }),
    Order.countDocuments({ sellerId, status: 'PENDING' }),
    Order.find({ sellerId, status: 'PENDING' })
      .sort({ createdAt: -1 })
      .limit(6)
      .select('_id status totalAmount createdAt items'),
    Product.find({
      sellerId,
      status: 'published',
      availableQuantity: { $ne: null, $lt: LOW_STOCK_THRESHOLD },
    })
      .select('_id name availableQuantity moq unit variants')
      .sort({ availableQuantity: 1 })
      .limit(80)
      .lean(),
  ]);

  const allInventoryAlerts = inventoryProducts
    .map((product) => {
      const qty = Number(product.availableQuantity);
      if (!Number.isFinite(qty) || qty >= LOW_STOCK_THRESHOLD) return null;
      const level = qty <= 0 ? 'out' : 'low';
      return {
        _id: product._id,
        name: product.name || 'Untitled product',
        availableQuantity: qty,
        moq: product.moq ?? null,
        unit: product.unit || 'meter',
        level,
        previewImage: product.variants?.[0]?.images?.[0] || '',
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.level !== b.level) return a.level === 'out' ? -1 : 1;
      return a.availableQuantity - b.availableQuantity;
    });

  const inventoryAlerts = allInventoryAlerts.slice(0, 6);

  const formatOrderRow = (order) => ({
    _id: order._id,
    status: order.status,
    totalAmount: order.totalAmount,
    createdAt: order.createdAt,
    itemCount: order.items?.length || 0,
    previewImage: order.items?.[0]?.image || '',
    productName: order.items?.[0]?.productName || 'Order',
  });

  const seriesStart =
    start ||
    (seriesRaw[0]?._id
      ? bucket === 'day'
        ? startOfDay(new Date(seriesRaw[0]._id))
        : startOfDay(new Date(`${seriesRaw[0]._id}-01`))
      : startOfDay(new Date(end.getFullYear(), end.getMonth(), 1)));

  let series = emptySeries(seriesStart, end, bucket);

  if (range === 'all' && seriesRaw.length > 0) {
    const firstKey = seriesRaw[0]._id;
    const firstStart = startOfDay(new Date(`${firstKey}-01`));
    series = emptySeries(firstStart, end, 'month');
  }

  if (series.length === 0 && seriesRaw.length > 0) {
    series = seriesRaw.map((row) => ({
      key: row._id,
      label: row._id,
      sales: 0,
      orders: 0,
    }));
  }

  const byKey = new Map(seriesRaw.map((row) => [row._id, row]));
  series = series.map((point) => {
    const hit = byKey.get(point.key);
    return {
      ...point,
      sales: hit?.sales || 0,
      orders: hit?.orders || 0,
    };
  });

  // If still empty (no orders ever), show a flat zero line for the selected window.
  if (series.length === 0) {
    series = emptySeries(
      start || startOfDay(new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6)),
      end,
      bucket === 'month' && range !== 'week' ? 'month' : 'day',
    );
  }

  const avgOrderValue =
    totals.orderCount > 0 ? Math.round(totals.totalSales / totals.orderCount) : 0;

  return {
    range,
    label,
    totalSales: totals.totalSales,
    orderCount: totals.orderCount,
    avgOrderValue,
    publishedCount,
    draftCount,
    totalProductCount: publishedCount + draftCount,
    pendingOrderCount,
    inventoryAlertCount: allInventoryAlerts.length,
    series,
    recentOrders: recentOrders.map(formatOrderRow),
    pendingOrders: pendingOrders.map(formatOrderRow),
    inventoryAlerts,
  };
};
