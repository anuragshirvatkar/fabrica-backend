import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import {
  createMyAddress,
  deleteMyAddress,
  getAddresses,
  updateMyAddress,
} from '../controllers/addressController.js';

const router = Router();

router.use(requireAuth);
router.get('/', getAddresses);
router.post('/', createMyAddress);
router.put('/:id', updateMyAddress);
router.delete('/:id', deleteMyAddress);

export default router;
