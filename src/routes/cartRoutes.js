import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import {
  addItem,
  clearMyCart,
  getMyCart,
  removeItem,
  updateItem,
} from '../controllers/cartController.js';

const router = Router();

router.use(requireAuth);
router.get('/', getMyCart);
router.post('/items', addItem);
router.put('/items/:itemId', updateItem);
router.delete('/items/:itemId', removeItem);
router.delete('/', clearMyCart);

export default router;
