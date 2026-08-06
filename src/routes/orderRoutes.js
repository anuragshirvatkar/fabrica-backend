import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import {
  cancelMyOrder,
  rejectMyOrder,
  createOrder,
  advanceMyOrder,
  dispatchMyOrder,
  downloadOrderInvoice,
  getMyOrders,
  getOrder,
} from '../controllers/orderController.js';

const router = Router();

router.use(requireAuth);
router.get('/', getMyOrders);
router.post('/', createOrder);
router.get('/:id/invoice', downloadOrderInvoice);
router.get('/:id', getOrder);
router.post('/:id/cancel', cancelMyOrder);
router.post('/:id/reject', rejectMyOrder);
router.post('/:id/advance', advanceMyOrder);
router.post('/:id/dispatch', dispatchMyOrder);

export default router;
