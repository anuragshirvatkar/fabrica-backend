import { Router } from 'express';
import {
  getBuyerOptions,
  getMyBuyerProfile,
  setupBuyer,
  updateMyBuyerProfile,
} from '../controllers/buyerController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = Router();

router.get('/options', getBuyerOptions);
router.post('/setup', requireAuth, setupBuyer);
router.get('/me', requireAuth, getMyBuyerProfile);
router.put('/me', requireAuth, updateMyBuyerProfile);

export default router;
