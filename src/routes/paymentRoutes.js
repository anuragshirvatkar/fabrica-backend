import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import {
  downloadPaymentInvoice,
  getOrderPayment,
  getPayment,
  getPayments,
} from '../controllers/paymentController.js';

const router = Router();

router.use(requireAuth);
router.get('/', getPayments);
router.get('/order/:orderId', getOrderPayment);
router.get('/:id/invoice', downloadPaymentInvoice);
router.get('/:id', getPayment);

export default router;
