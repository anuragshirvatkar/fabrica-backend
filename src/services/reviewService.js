import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Review from '../models/Review.js';
import { createError } from '../utils/errors.js';

const MAX_REVIEW_LENGTH = 1000;

const ensureBuyer = (user) => {
  if (!user || user.role !== 'BUYER') {
    throw createError('Only buyers can manage reviews', 403, 'FORBIDDEN');
  }
};

const normalizeRating = (value) => {
  const rating = Number(value);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw createError('Rating must be an integer from 1 to 5', 400, 'INVALID_RATING');
  }
  return rating;
};

const normalizeMessage = (value) => {
  const review = String(value ?? '').trim();
  if (review.length > MAX_REVIEW_LENGTH) {
    throw createError(
      `Review message must be at most ${MAX_REVIEW_LENGTH} characters`,
      400,
      'INVALID_REVIEW',
    );
  }
  return review;
};

const buyerDisplayName = (buyer) => {
  if (!buyer?.email) return 'Buyer';
  const local = String(buyer.email).split('@')[0] || 'Buyer';
  return local.charAt(0).toUpperCase() + local.slice(1);
};

const formatReview = (doc, currentUserId = null) => {
  const buyer = doc.buyerId && typeof doc.buyerId === 'object' ? doc.buyerId : null;
  const buyerId = buyer?._id || doc.buyerId;
  return {
    _id: doc._id,
    productId: doc.productId,
    buyerId,
    buyerName: buyerDisplayName(buyer),
    rating: doc.rating,
    review: doc.review || '',
    isMine: currentUserId ? String(buyerId) === String(currentUserId) : false,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
};

const assertDeliveredPurchase = async (buyerId, productId) => {
  const order = await Order.findOne({
    buyerId,
    status: 'DELIVERED',
    'items.productId': productId,
  }).select('_id');

  if (!order) {
    throw createError(
      'You can only review products from a completed order',
      403,
      'REVIEW_NOT_ELIGIBLE',
    );
  }
};

export const createReview = async (user, { productId, rating, review }) => {
  ensureBuyer(user);

  if (!productId) throw createError('Product is required', 400, 'PRODUCT_REQUIRED');

  const product = await Product.findById(productId).select('_id');
  if (!product) throw createError('Product not found', 404, 'PRODUCT_NOT_FOUND');

  await assertDeliveredPurchase(user._id, productId);

  try {
    const created = await Review.create({
      buyerId: user._id,
      productId,
      rating: normalizeRating(rating),
      review: normalizeMessage(review),
    });
    await created.populate('buyerId', 'email');
    return formatReview(created, user._id);
  } catch (err) {
    if (err?.code === 11000) {
      throw createError(
        'You have already reviewed this product. Edit your existing review instead.',
        409,
        'REVIEW_EXISTS',
      );
    }
    throw err;
  }
};

export const updateReview = async (user, reviewId, { rating, review }) => {
  ensureBuyer(user);

  const existing = await Review.findById(reviewId);
  if (!existing) throw createError('Review not found', 404, 'REVIEW_NOT_FOUND');
  if (String(existing.buyerId) !== String(user._id)) {
    throw createError('You can only edit your own review', 403, 'FORBIDDEN');
  }

  if (rating !== undefined) existing.rating = normalizeRating(rating);
  if (review !== undefined) existing.review = normalizeMessage(review);

  await existing.save();
  await existing.populate('buyerId', 'email');
  return formatReview(existing, user._id);
};

export const deleteReview = async (user, reviewId) => {
  ensureBuyer(user);

  const existing = await Review.findById(reviewId);
  if (!existing) throw createError('Review not found', 404, 'REVIEW_NOT_FOUND');
  if (String(existing.buyerId) !== String(user._id)) {
    throw createError('You can only delete your own review', 403, 'FORBIDDEN');
  }

  await existing.deleteOne();
  return { deleted: true, _id: reviewId };
};

export const getMyReviewForProduct = async (user, productId) => {
  ensureBuyer(user);
  const doc = await Review.findOne({ buyerId: user._id, productId }).populate(
    'buyerId',
    'email',
  );
  return doc ? formatReview(doc, user._id) : null;
};

export const getMyReviewsForProducts = async (user, productIds = []) => {
  ensureBuyer(user);
  const ids = [...new Set((productIds || []).map(String).filter(Boolean))];
  if (!ids.length) return [];

  const docs = await Review.find({
    buyerId: user._id,
    productId: { $in: ids },
  }).populate('buyerId', 'email');

  return docs.map((doc) => formatReview(doc, user._id));
};

export const listProductReviews = async (productId, currentUser = null) => {
  const product = await Product.findById(productId).select('_id');
  if (!product) throw createError('Product not found', 404, 'PRODUCT_NOT_FOUND');

  const docs = await Review.find({ productId })
    .sort({ createdAt: -1 })
    .populate('buyerId', 'email');

  const reviews = docs.map((doc) =>
    formatReview(doc, currentUser?._id || null),
  );

  const count = reviews.length;
  const averageRating =
    count === 0
      ? 0
      : Math.round(
          (reviews.reduce((sum, item) => sum + item.rating, 0) / count) * 10,
        ) / 10;

  return {
    reviews,
    summary: { averageRating, count },
    myReview:
      currentUser?.role === 'BUYER'
        ? reviews.find((item) => item.isMine) || null
        : null,
  };
};
