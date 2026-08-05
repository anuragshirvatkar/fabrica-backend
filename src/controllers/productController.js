import asyncHandler from '../utils/asyncHandler.js';
import {
  createSellerProduct,
  deleteSellerProduct,
  getSellerProductById,
  getSellerProductStats,
  listSellerProducts,
  updateSellerProduct,
  uploadProductImages,
} from '../services/productService.js';

const ensureSellerRole = (req, res) => {
  if (req.user.role !== 'SELLER') {
    res.status(403).json({
      success: false,
      message: 'Only sellers can access this resource',
      code: 'FORBIDDEN',
    });
    return false;
  }
  return true;
};

export const uploadImages = asyncHandler(async (req, res) => {
  if (!ensureSellerRole(req, res)) return;

  const files = req.files || [];
  const uploads = await uploadProductImages(files);

  res.status(201).json({
    success: true,
    images: uploads,
  });
});

/** Proxies remote product images so the browser can sample pixels (CORS-safe). */
export const proxyImage = asyncHandler(async (req, res) => {
  if (!ensureSellerRole(req, res)) return;

  const rawUrl = String(req.query.url || '').trim();
  if (!rawUrl) {
    return res.status(400).json({
      success: false,
      message: 'Image url is required',
      code: 'VALIDATION_ERROR',
    });
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return res.status(400).json({
      success: false,
      message: 'Invalid image url',
      code: 'VALIDATION_ERROR',
    });
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid image url protocol',
      code: 'VALIDATION_ERROR',
    });
  }

  const response = await fetch(rawUrl);
  if (!response.ok) {
    return res.status(502).json({
      success: false,
      message: 'Failed to fetch image',
      code: 'PROXY_FETCH_FAILED',
    });
  }

  const contentType = response.headers.get('content-type') || 'image/jpeg';
  if (!contentType.startsWith('image/')) {
    return res.status(400).json({
      success: false,
      message: 'URL is not an image',
      code: 'VALIDATION_ERROR',
    });
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.status(200).send(buffer);
});

export const listMyProducts = asyncHandler(async (req, res) => {
  if (!ensureSellerRole(req, res)) return;

  const status = String(req.query.status || 'published').toLowerCase();
  const products = await listSellerProducts(req.user._id, status);

  res.status(200).json({
    success: true,
    products,
  });
});

export const getMyProductStats = asyncHandler(async (req, res) => {
  if (!ensureSellerRole(req, res)) return;

  const stats = await getSellerProductStats(req.user._id);

  res.status(200).json({
    success: true,
    stats,
  });
});

export const getMyProduct = asyncHandler(async (req, res) => {
  if (!ensureSellerRole(req, res)) return;

  const product = await getSellerProductById(req.user._id, req.params.id);

  res.status(200).json({
    success: true,
    product,
  });
});

export const createProduct = asyncHandler(async (req, res) => {
  if (!ensureSellerRole(req, res)) return;

  const product = await createSellerProduct(req.user._id, req.body || {});

  res.status(201).json({
    success: true,
    product,
  });
});

export const updateProduct = asyncHandler(async (req, res) => {
  if (!ensureSellerRole(req, res)) return;

  const product = await updateSellerProduct(req.user._id, req.params.id, req.body || {});

  res.status(200).json({
    success: true,
    product,
  });
});

export const deleteProduct = asyncHandler(async (req, res) => {
  if (!ensureSellerRole(req, res)) return;

  const result = await deleteSellerProduct(req.user._id, req.params.id);

  res.status(200).json({
    success: true,
    ...result,
  });
});

export const saveDraft = asyncHandler(async (req, res) => {
  if (!ensureSellerRole(req, res)) return;

  const payload = { ...(req.body || {}), status: 'draft' };
  const productId = req.params.id || payload._id || payload.id;

  const product = productId
    ? await updateSellerProduct(req.user._id, productId, payload)
    : await createSellerProduct(req.user._id, payload);

  res.status(productId ? 200 : 201).json({
    success: true,
    product,
  });
});
