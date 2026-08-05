import asyncHandler from '../utils/asyncHandler.js';
import {
  createReview,
  deleteReview,
  getMyReviewForProduct,
  getMyReviewsForProducts,
  listProductReviews,
  updateReview,
} from '../services/reviewService.js';

export const createMyReview = asyncHandler(async (req, res) => {
  const review = await createReview(req.user, req.body || {});
  res.status(201).json({ success: true, review });
});

export const updateMyReview = asyncHandler(async (req, res) => {
  const review = await updateReview(req.user, req.params.id, req.body || {});
  res.status(200).json({ success: true, review });
});

export const deleteMyReview = asyncHandler(async (req, res) => {
  const result = await deleteReview(req.user, req.params.id);
  res.status(200).json({ success: true, ...result });
});

export const getMyProductReview = asyncHandler(async (req, res) => {
  const review = await getMyReviewForProduct(req.user, req.params.productId);
  res.status(200).json({ success: true, review });
});

export const getMyReviews = asyncHandler(async (req, res) => {
  const raw = req.query.productIds;
  const productIds = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(',').map((id) => id.trim()).filter(Boolean)
      : [];
  const reviews = await getMyReviewsForProducts(req.user, productIds);
  res.status(200).json({ success: true, reviews });
});

export const getProductReviews = asyncHandler(async (req, res) => {
  const data = await listProductReviews(req.params.productId, req.user || null);
  res.status(200).json({ success: true, ...data });
});
