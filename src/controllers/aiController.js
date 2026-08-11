import { toFile } from 'openai';
import asyncHandler from '../utils/asyncHandler.js';
import { openai, openaiEnabled } from '../config/openai.js';
import {
  aiChat,
  aiCompare,
  aiRecommend,
  aiSearch,
  findSimilarProducts,
  productQa,
} from '../services/aiService.js';
import {
  processOnboardingTurn,
  startOnboarding,
} from '../services/aiOnboardingService.js';
import { appendConversationTurn } from '../services/personalizationService.js';
import { cleanupVoiceText } from '../services/voiceCleanupService.js';
import { createError } from '../utils/errors.js';

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

export const postAiOnboardingStart = asyncHandler(async (req, res) => {
  if (!req.user) throw createError('Authentication required', 401, 'UNAUTHORIZED');
  const role = req.body?.role || req.user.role;
  if (role !== req.user.role) {
    throw createError('Onboarding role mismatch', 403, 'FORBIDDEN');
  }
  const result = startOnboarding(role);
  res.status(200).json({ success: true, ...result });
});

export const postAiOnboardingTurn = asyncHandler(async (req, res) => {
  if (!req.user) throw createError('Authentication required', 401, 'UNAUTHORIZED');
  const role = req.body?.role || req.user.role;
  if (role !== req.user.role) {
    throw createError('Onboarding role mismatch', 403, 'FORBIDDEN');
  }

  const result = await processOnboardingTurn({
    role,
    message: req.body?.message || '',
    answers: req.body?.answers || {},
    history: req.body?.history || [],
    selectedOptions: req.body?.selectedOptions ?? null,
    addressPatch: req.body?.addressPatch || null,
    skipOptional: Boolean(req.body?.skipOptional),
  });

  res.status(200).json({ success: true, ...result });
});

export const postAiTranscribe = asyncHandler(async (req, res) => {
  if (!req.user) throw createError('Authentication required', 401, 'UNAUTHORIZED');
  if (!openaiEnabled || !openai) {
    throw createError('Voice transcription is not configured', 503, 'AI_DISABLED');
  }
  if (!req.file?.buffer?.length) {
    throw createError('Audio file is required', 400, 'VALIDATION_ERROR');
  }

  const filename = req.file.originalname || 'speech.webm';
  const file = await toFile(req.file.buffer, filename, {
    type: req.file.mimetype || 'audio/webm',
  });

  const result = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    language: 'en',
  });

  const raw = String(result?.text || '').trim();
  const cleaned = await cleanupVoiceText(raw, {
    context: String(req.body?.context || 'marketplace'),
    hint: String(req.body?.hint || ''),
  });

  res.status(200).json({
    success: true,
    text: cleaned.text,
    raw: cleaned.raw || raw,
    changed: Boolean(cleaned.changed),
  });
});
