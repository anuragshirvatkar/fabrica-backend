import Product from '../models/Product.js';
import Category from '../models/Category.js';
import Seller from '../models/Seller.js';
import cloudinary from '../config/cloudinary.js';
import { PRODUCT_CATEGORIES } from '../constants/categories.js';

const MAX_COLORS = 10;
const MAX_IMAGES_PER_COLOR = 5;
const MAX_PRODUCT_NAME = 100;
const MAX_DESCRIPTION = 500;

const createError = (message, statusCode, code) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

export const getSellerForUser = async (userId) => {
  const seller = await Seller.findOne({ userId });
  if (!seller) {
    throw createError('Seller profile not found', 404, 'SELLER_NOT_FOUND');
  }
  return seller;
};

const resolveCategory = async (categoryName) => {
  const name = categoryName?.trim();
  if (!name) return { categoryId: null, category: '' };

  let category = await Category.findOne({ name });
  if (!category) {
    category = await Category.create({ name });
  }

  return { categoryId: category._id, category: category.name };
};

const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
};

const normalizeVariants = (variants = []) => {
  if (!Array.isArray(variants)) return [];

  return variants.slice(0, MAX_COLORS).map((variant) => ({
    ...(variant._id ? { _id: variant._id } : {}),
    colorHex: String(variant.colorHex || '').trim().toUpperCase(),
    images: Array.isArray(variant.images)
      ? variant.images.filter(Boolean).slice(0, MAX_IMAGES_PER_COLOR)
      : [],
  }));
};

const formatProduct = (product) => ({
  _id: product._id,
  sellerId: product.sellerId,
  categoryId: product.categoryId,
  category: product.category || '',
  name: product.name || '',
  description: product.description || '',
  price: product.price,
  gsm: product.gsm,
  width: product.width,
  moq: product.moq,
  availableQuantity: product.availableQuantity,
  unit: product.unit || 'meter',
  variants: (product.variants || []).map((variant) => ({
    _id: variant._id,
    colorHex: variant.colorHex || '',
    images: variant.images || [],
  })),
  status: product.status,
  step: product.step || 1,
  createdAt: product.createdAt,
  updatedAt: product.updatedAt,
});

const validatePublishPayload = (payload) => {
  if (!payload.name?.trim()) {
    throw createError('Product name is required', 400, 'VALIDATION_ERROR');
  }
  if (payload.name.trim().length > MAX_PRODUCT_NAME) {
    throw createError(
      `Product name cannot exceed ${MAX_PRODUCT_NAME} characters`,
      400,
      'VALIDATION_ERROR',
    );
  }
  if (!payload.category?.trim()) {
    throw createError('Category is required', 400, 'VALIDATION_ERROR');
  }
  if (
    !PRODUCT_CATEGORIES.some(
      (name) => name.toLowerCase() === payload.category.trim().toLowerCase(),
    )
  ) {
    throw createError(
      `Category must be one of: ${PRODUCT_CATEGORIES.join(', ')}`,
      400,
      'VALIDATION_ERROR',
    );
  }
  if (!payload.description?.trim()) {
    throw createError('Short description is required', 400, 'VALIDATION_ERROR');
  }
  if (payload.description.trim().length > MAX_DESCRIPTION) {
    throw createError(
      `Short description cannot exceed ${MAX_DESCRIPTION} characters`,
      400,
      'VALIDATION_ERROR',
    );
  }

  const price = toNumberOrNull(payload.price);
  const moq = toNumberOrNull(payload.moq);
  const qty = toNumberOrNull(payload.availableQuantity);
  const gsm = toNumberOrNull(payload.gsm);
  const width = toNumberOrNull(payload.width);

  if (price === null || price <= 0) {
    throw createError('Enter a valid price greater than 0', 400, 'VALIDATION_ERROR');
  }
  if (moq === null || moq < 1) {
    throw createError('MOQ must be at least 1', 400, 'VALIDATION_ERROR');
  }
  if (qty === null || qty < 0) {
    throw createError('Enter a valid available quantity', 400, 'VALIDATION_ERROR');
  }
  if (gsm === null || gsm <= 0) {
    throw createError('Enter a valid GSM value', 400, 'VALIDATION_ERROR');
  }
  if (width === null || width <= 0) {
    throw createError('Enter a valid fabric width in inches', 400, 'VALIDATION_ERROR');
  }
  if (!payload.unit?.trim()) {
    throw createError('Unit is required', 400, 'VALIDATION_ERROR');
  }

  const variants = normalizeVariants(payload.variants);
  if (!variants.length) {
    throw createError('Add at least one color variant', 400, 'VALIDATION_ERROR');
  }
  if (variants.length > MAX_COLORS) {
    throw createError(`You can add up to ${MAX_COLORS} colors only`, 400, 'VALIDATION_ERROR');
  }

  for (const [index, variant] of variants.entries()) {
    if (!variant.colorHex) {
      throw createError(`Please pick a color for variant ${index + 1}`, 400, 'VALIDATION_ERROR');
    }
    if (!variant.images.length) {
      throw createError(
        `Upload at least one image for color variant ${index + 1}`,
        400,
        'VALIDATION_ERROR',
      );
    }
  }

  return { price, moq, availableQuantity: qty, gsm, width, variants };
};

const buildProductFields = async (payload, { forPublish = false } = {}) => {
  const name = String(payload.name || '').trim().slice(0, MAX_PRODUCT_NAME);
  const description = String(payload.description || '').trim().slice(0, MAX_DESCRIPTION);
  const unit = String(payload.unit || 'meter').trim() || 'meter';
  const step = [1, 2, 3].includes(Number(payload.step)) ? Number(payload.step) : 1;

  const normalizedCategory =
    PRODUCT_CATEGORIES.find(
      (name) => name.toLowerCase() === String(payload.category || '').trim().toLowerCase(),
    ) || String(payload.category || '').trim();

  let categoryFields = {
    categoryId: null,
    category: normalizedCategory,
  };
  if (categoryFields.category) {
    categoryFields = await resolveCategory(categoryFields.category);
  }

  if (forPublish) {
    const validated = validatePublishPayload({
      ...payload,
      name,
      description,
      category: categoryFields.category,
      unit,
    });

    return {
      name,
      description,
      ...categoryFields,
      price: validated.price,
      moq: validated.moq,
      availableQuantity: validated.availableQuantity,
      gsm: validated.gsm,
      width: validated.width,
      unit,
      variants: validated.variants,
      step: 3,
      status: 'published',
    };
  }

  return {
    name,
    description,
    ...categoryFields,
    price: toNumberOrNull(payload.price),
    moq: toNumberOrNull(payload.moq),
    availableQuantity: toNumberOrNull(payload.availableQuantity),
    gsm: toNumberOrNull(payload.gsm),
    width: toNumberOrNull(payload.width),
    unit,
    variants: normalizeVariants(payload.variants),
    step,
    status: 'draft',
  };
};

export const uploadProductImages = async (files = []) => {
  if (!files.length) {
    throw createError('No images provided', 400, 'VALIDATION_ERROR');
  }

  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY) {
    throw createError('Cloudinary is not configured', 500, 'CLOUDINARY_NOT_CONFIGURED');
  }

  const uploads = await Promise.all(
    files.map(
      (file) =>
        new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              folder: 'fabrica/products',
              resource_type: 'image',
            },
            (error, result) => {
              if (error) {
                reject(createError(error.message || 'Image upload failed', 500, 'UPLOAD_FAILED'));
                return;
              }
              resolve({
                url: result.secure_url,
                publicId: result.public_id,
              });
            },
          );
          stream.end(file.buffer);
        }),
    ),
  );

  return uploads;
};

export const listSellerProducts = async (userId, status = 'published') => {
  const seller = await getSellerForUser(userId);
  const query = { sellerId: seller._id };

  if (status && status !== 'all') {
    query.status = status;
  }

  const products = await Product.find(query).sort({ updatedAt: -1 });
  return products.map(formatProduct);
};

export const getSellerProductStats = async (userId) => {
  const seller = await getSellerForUser(userId);
  const [publishedCount, draftCount] = await Promise.all([
    Product.countDocuments({ sellerId: seller._id, status: 'published' }),
    Product.countDocuments({ sellerId: seller._id, status: 'draft' }),
  ]);

  return { publishedCount, draftCount, totalCount: publishedCount + draftCount };
};

export const getSellerProductById = async (userId, productId) => {
  const seller = await getSellerForUser(userId);
  const product = await Product.findOne({ _id: productId, sellerId: seller._id });

  if (!product) {
    throw createError('Product not found', 404, 'PRODUCT_NOT_FOUND');
  }

  return formatProduct(product);
};

export const createSellerProduct = async (userId, payload) => {
  const seller = await getSellerForUser(userId);
  const status = payload.status === 'published' ? 'published' : 'draft';
  const fields = await buildProductFields(payload, { forPublish: status === 'published' });

  const product = await Product.create({
    sellerId: seller._id,
    ...fields,
  });

  return formatProduct(product);
};

export const updateSellerProduct = async (userId, productId, payload) => {
  const seller = await getSellerForUser(userId);
  const product = await Product.findOne({ _id: productId, sellerId: seller._id });

  if (!product) {
    throw createError('Product not found', 404, 'PRODUCT_NOT_FOUND');
  }

  const nextStatus =
    payload.status === 'published'
      ? 'published'
      : payload.status === 'draft'
        ? 'draft'
        : product.status;

  const fields = await buildProductFields(
    {
      name: payload.name ?? product.name,
      description: payload.description ?? product.description,
      category: payload.category ?? product.category,
      price: payload.price ?? product.price,
      moq: payload.moq ?? product.moq,
      availableQuantity: payload.availableQuantity ?? product.availableQuantity,
      gsm: payload.gsm ?? product.gsm,
      width: payload.width ?? product.width,
      unit: payload.unit ?? product.unit,
      variants: payload.variants ?? product.variants,
      step: payload.step ?? product.step,
    },
    { forPublish: nextStatus === 'published' },
  );

  Object.assign(product, fields);
  product.status = nextStatus;
  await product.save();

  return formatProduct(product);
};

export const deleteSellerProduct = async (userId, productId) => {
  const seller = await getSellerForUser(userId);
  const product = await Product.findOneAndDelete({ _id: productId, sellerId: seller._id });

  if (!product) {
    throw createError('Product not found', 404, 'PRODUCT_NOT_FOUND');
  }

  const imageUrls = (product.variants || []).flatMap((variant) => variant.images || []);
  await Promise.allSettled(
    imageUrls.map(async (url) => {
      try {
        const match = String(url).match(/\/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+$/);
        if (!match?.[1]) return;
        await cloudinary.uploader.destroy(match[1]);
      } catch {
        // Best-effort cleanup; ignore Cloudinary delete failures.
      }
    }),
  );

  return { deleted: true, _id: product._id };
};
