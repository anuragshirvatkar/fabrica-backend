import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import { uploadImages as multerUpload } from '../utils/upload.js';
import {
  createProduct,
  deleteProduct,
  getMyProduct,
  getMyProductStats,
  listMyProducts,
  proxyImage,
  saveDraft,
  updateProduct,
  uploadImages,
} from '../controllers/productController.js';

const router = Router();

const handleUpload = (req, res, next) => {
  multerUpload.array('images', 5)(req, res, (err) => {
    if (!err) return next();
    err.statusCode = 400;
    err.code = 'UPLOAD_ERROR';
    return next(err);
  });
};

router.use(requireAuth);

router.post('/upload', handleUpload, uploadImages);
router.get('/image-proxy', proxyImage);
router.get('/me/stats', getMyProductStats);
router.get('/me', listMyProducts);
router.post('/drafts', saveDraft);
router.put('/drafts/:id', saveDraft);
router.get('/:id', getMyProduct);
router.post('/', createProduct);
router.put('/:id', updateProduct);
router.delete('/:id', deleteProduct);

export default router;
