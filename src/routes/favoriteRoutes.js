import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import {
  addMyFavorite,
  getMyFavorites,
  removeMyFavorite,
} from '../controllers/favoriteController.js';

const router = Router();

router.use(requireAuth);
router.get('/', getMyFavorites);
router.post('/:productId', addMyFavorite);
router.delete('/:productId', removeMyFavorite);

export default router;
