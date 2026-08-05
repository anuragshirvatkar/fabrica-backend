import { Router } from 'express';
import { optionalAuth } from '../middleware/authMiddleware.js';
import {
  getSimilarProducts,
  postAiChat,
  postAiCompare,
  postAiRecommend,
  postAiSearch,
  postProductQa,
} from '../controllers/aiController.js';

const router = Router();

router.use(optionalAuth);

router.post('/chat', postAiChat);
router.post('/search', postAiSearch);
router.post('/recommend', postAiRecommend);
router.post('/compare', postAiCompare);
router.get('/similar/:productId', getSimilarProducts);
router.post('/product/:productId/qa', postProductQa);

export default router;
