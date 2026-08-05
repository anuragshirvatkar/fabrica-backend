import asyncHandler from '../utils/asyncHandler.js';
import {
  aiChat,
  aiCompare,
  aiRecommend,
  aiSearch,
  findSimilarProducts,
  productQa,
} from '../services/aiService.js';
import { appendConversationTurn } from '../services/personalizationService.js';

export const postAiChat = asyncHandler(async (req, res) => {
  const message = req.body?.message;
  const result = await aiChat({
    message,
    history: req.body?.history || [],
    productId: req.body?.productId || null,
    user: req.user || null,
  });

  if (req.user?.role === 'BUYER' && req.user?._id) {
    void appendConversationTurn(req.user._id, message, result.reply).catch(() => {});
  }

  res.status(200).json({ success: true, ...result });
});

export const postAiSearch = asyncHandler(async (req, res) => {
  const result = await aiSearch(req.body?.query || req.body?.q || '', {
    silent: Boolean(req.body?.silent),
    user: req.user || null,
  });
  res.status(200).json({ success: true, ...result });
});

export const postAiRecommend = asyncHandler(async (req, res) => {
  const result = await aiRecommend(req.body?.query || req.body?.q || '', {
    user: req.user || null,
  });
  res.status(200).json({ success: true, ...result });
});

export const postAiCompare = asyncHandler(async (req, res) => {
  const result = await aiCompare(req.body?.productIdA, req.body?.productIdB);
  res.status(200).json({ success: true, ...result });
});

export const getSimilarProducts = asyncHandler(async (req, res) => {
  const products = await findSimilarProducts(req.params.productId, Number(req.query.limit) || 8);
  res.status(200).json({ success: true, products });
});

export const postProductQa = asyncHandler(async (req, res) => {
  const result = await productQa(req.params.productId, req.body?.question);
  res.status(200).json({ success: true, ...result });
});
