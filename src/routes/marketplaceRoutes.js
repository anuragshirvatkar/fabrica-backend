import { Router } from 'express';
import { optionalAuth } from '../middleware/authMiddleware.js';
import {
  getFacets,
  getProduct,
  listProducts,
  suggestProducts,
} from '../controllers/marketplaceController.js';

const router = Router();

router.get('/', optionalAuth, listProducts);
router.get('/suggest', suggestProducts);
router.get('/facets', getFacets);
router.get('/:id', optionalAuth, getProduct);

export default router;
