import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import {
  deleteFcmToken,
  getNotifications,
  readAllNotifications,
  readNotification,
  saveFcmToken,
} from '../controllers/notificationController.js';

const router = Router();

router.use(requireAuth);
router.get('/', getNotifications);
router.post('/read-all', readAllNotifications);
router.post('/:id/read', readNotification);
router.post('/fcm-token', saveFcmToken);
router.delete('/fcm-token', deleteFcmToken);

export default router;
