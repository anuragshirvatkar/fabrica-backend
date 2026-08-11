import { Router } from 'express';
import { optionalAuth, requireAuth } from '../middleware/authMiddleware.js';
import {
  getSimilarProducts,
  postAiChat,
  postAiCompare,
  postAiOnboardingStart,
  postAiOnboardingTurn,
  postAiRecommend,
  postAiSearch,
  postAiTranscribe,
  postProductQa,
} from '../controllers/aiController.js';
import { uploadAudio } from '../utils/upload.js';
import { createError } from '../utils/errors.js';

const router = Router();

router.post('/onboarding/start', requireAuth, postAiOnboardingStart);
router.post('/onboarding/turn', requireAuth, postAiOnboardingTurn);
router.post(
  '/transcribe',
  requireAuth,
  (req, res, next) => {
    uploadAudio.single('audio')(req, res, (err) => {
      if (err) {
        next(createError(err.message || 'Audio upload failed', 400, 'VALIDATION_ERROR'));
        return;
      }
      next();
    });
  },
  postAiTranscribe,
);

router.use(optionalAuth);

router.post('/chat', postAiChat);
router.post('/search', postAiSearch);
router.post('/recommend', postAiRecommend);
router.post('/compare', postAiCompare);
router.get('/similar/:productId', getSimilarProducts);
router.post('/product/:productId/qa', postProductQa);

export default router;
