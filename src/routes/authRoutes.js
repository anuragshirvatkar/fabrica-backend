import { Router } from 'express';
import { syncAuth, getMe } from '../controllers/authController.js';
import { verifyFirebaseToken, requireAuth } from '../middleware/authMiddleware.js';

const router = Router();

router.post('/sync', verifyFirebaseToken, syncAuth);
router.get('/me', requireAuth, getMe);

export default router;
