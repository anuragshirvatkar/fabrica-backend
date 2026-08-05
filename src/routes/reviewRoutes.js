import { Router } from 'express';
import { optionalAuth, requireAuth } from '../middleware/authMiddleware.js';
import {
  createMyReview,
  deleteMyReview,
  getMyProductReview,
  getMyReviews,
  getProductReviews,
  updateMyReview,
} from '../controllers/reviewController.js';

const router = Router();

router.get('/product/:productId', optionalAuth, getProductReviews);

router.use(requireAuth);
router.get('/mine', getMyReviews);
router.get('/mine/:productId', getMyProductReview);
router.post('/', createMyReview);
router.patch('/:id', updateMyReview);
router.delete('/:id', deleteMyReview);

export default router;
