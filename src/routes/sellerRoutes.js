import { Router } from 'express';
import {
  setupSeller,
  getMySellerProfile,
  getMySellerDashboard,
  updateMySellerProfile,
} from '../controllers/sellerController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = Router();

router.post('/setup', requireAuth, setupSeller);
router.get('/me/dashboard', requireAuth, getMySellerDashboard);
router.get('/me', requireAuth, getMySellerProfile);
router.put('/me', requireAuth, updateMySellerProfile);

export default router;
