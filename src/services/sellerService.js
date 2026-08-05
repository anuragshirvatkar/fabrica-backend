import Seller from '../models/Seller.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import { createError } from '../utils/errors.js';

const formatSeller = (seller) => ({
  _id: seller._id,
  userId: seller.userId,
  companyName: seller.companyName,
  phone: seller.phone,
  gst: seller.gst,
  description: seller.description,
  verified: seller.verified,
  createdAt: seller.createdAt,
  updatedAt: seller.updatedAt,
});

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
  const existing = await Seller.findOne({ userId });

  if (existing) {
    const error = new Error('Seller profile already exists');
    error.statusCode = 409;
    error.code = 'SELLER_EXISTS';
    throw error;
  }

  const seller = await Seller.create({
    userId,
    companyName: payload.companyName,
    phone: payload.phone,
    gst: payload.gst,
    description: payload.description || '',
  });

  return formatSeller(seller);
};

export const getSellerByUserId = async (userId) => {
  const seller = await Seller.findOne({ userId });

  if (!seller) {
    const error = new Error('Seller profile not found');
    error.statusCode = 404;
    error.code = 'SELLER_NOT_FOUND';
    throw error;
  }

  return formatSeller(seller);
};

export const updateSellerProfile = async (userId, payload) => {
  const seller = await Seller.findOne({ userId });

  if (!seller) {
    const error = new Error('Seller profile not found');
    error.statusCode = 404;
    error.code = 'SELLER_NOT_FOUND';
    throw error;
  }

  if (payload.companyName !== undefined) seller.companyName = payload.companyName;
  if (payload.phone !== undefined) seller.phone = payload.phone;
  if (payload.gst !== undefined) seller.gst = payload.gst;
  if (payload.description !== undefined) seller.description = payload.description;

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

  const [totals, seriesRaw, recentOrders, publishedCount] = await Promise.all([
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
  ]);

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
    series,
    recentOrders: recentOrders.map((order) => ({
      _id: order._id,
      status: order.status,
      totalAmount: order.totalAmount,
      createdAt: order.createdAt,
      itemCount: order.items?.length || 0,
      previewImage: order.items?.[0]?.image || '',
      productName: order.items?.[0]?.productName || 'Order',
    })),
  };
};
