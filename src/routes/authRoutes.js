import { Router } from 'express';
import { syncAuth, getMe, signInHint } from '../controllers/authController.js';
import { verifyFirebaseToken, requireAuth } from '../middleware/authMiddleware.js';
import { signInHintLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.post('/sign-in-hint', signInHintLimiter, signInHint);
router.post('/sync', verifyFirebaseToken, syncAuth);
router.get('/me', requireAuth, getMe);

export default router;
