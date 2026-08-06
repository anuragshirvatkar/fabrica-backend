import mongoose from 'mongoose';
import Product from '../models/Product.js';
import Seller from '../models/Seller.js';
import { createError } from '../utils/errors.js';
import { PRODUCT_CATEGORIES } from '../constants/categories.js';
import { personalizeForBuyer } from './personalizationService.js';

const formatMarketplaceProduct = (product, seller = null) => {
  const variants = (product.variants || []).map((variant) => ({
    _id: variant._id,
    colorHex: variant.colorHex || '',
    images: variant.images || [],
  }));

  const coverImage =
    variants.find((variant) => variant.images.length)?.images[0] || '';

  return {
    _id: product._id,
    name: product.name,
    description: product.description || '',
    category: product.category || '',
    price: product.price,
    gsm: product.gsm,
    width: product.width,
    moq: product.moq,
    availableQuantity: product.availableQuantity,
    unit: product.unit || 'meter',
    variants,
    coverImage,
    colors: variants.map((variant) => variant.colorHex).filter(Boolean),
    seller: seller
      ? {
          _id: seller._id,
          companyName: seller.companyName,
          verified: seller.verified,
          description: seller.description || '',
        }
      : null,
    forYou: Boolean(product._forYou || product.forYou),
    forYouReason: String(product.forYouReason || '').trim(),
    status: product.status,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
};

const parseList = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => String(entry).split(',')).map((v) => v.trim()).filter(Boolean);
  }
  return String(value)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
};

const parseNumber = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Expand garment/slang search terms so "jeans" also matches denim listings. */
const SEARCH_SYNONYMS = {
  jeans: ['denim', 'jean'],
  jean: ['denim', 'jeans'],
  denim: ['denim', 'jeans'],
  saree: ['saree', 'sari', 'silk'],
  sari: ['saree', 'sari', 'silk'],
};

const expandSearchTerms = (raw) => {
  const term = String(raw || '').trim();
  if (!term) return [];
  const lower = term.toLowerCase();
  const extras = SEARCH_SYNONYMS[lower] || [];
  const parts = lower.split(/\s+/).filter(Boolean);
  const fromParts = parts.flatMap((part) => SEARCH_SYNONYMS[part] || []);
  return [...new Set([term, ...extras, ...fromParts])];
};

const buildMarketplaceFilter = ({
  q,
  category,
  categories,
  minPrice,
  maxPrice,
  gsm,
  width,
  widths,
  minWidth,
  maxWidth,
  moqMax,
  moqRanges,
} = {}) => {
  const filter = { status: 'published' };
  const and = [];

  const categoryList = [
    ...parseList(category),
    ...parseList(categories),
  ].filter((name) =>
    PRODUCT_CATEGORIES.some((allowed) => allowed.toLowerCase() === name.toLowerCase()),
  );

  if (categoryList.length === 1) {
    filter.category = new RegExp(`^${categoryList[0]}$`, 'i');
  } else if (categoryList.length > 1) {
    and.push({
      $or: categoryList.map((name) => ({
        category: new RegExp(`^${name}$`, 'i'),
      })),
    });
  }

  if (q?.trim()) {
    const terms = expandSearchTerms(q.trim());
    and.push({
      $or: terms.flatMap((term) => {
        const pattern = new RegExp(escapeRegex(term), 'i');
        return [
          { name: pattern },
          { description: pattern },
          { category: pattern },
        ];
      }),
    });
  }

  const minP = parseNumber(minPrice);
  const maxP = parseNumber(maxPrice);
  if (minP != null || maxP != null) {
    filter.price = {};
    if (minP != null) filter.price.$gte = minP;
    if (maxP != null) filter.price.$lte = maxP;
  }

  const gsmList = parseList(gsm);
  if (gsmList.length) {
    const gsmOr = [];
    for (const bucket of gsmList) {
      if (bucket === '0-150' || bucket === 'upto150') gsmOr.push({ gsm: { $gte: 0, $lte: 150 } });
      if (bucket === '150-250') gsmOr.push({ gsm: { $gt: 150, $lte: 250 } });
      if (bucket === '250-350') gsmOr.push({ gsm: { $gt: 250, $lte: 350 } });
      if (bucket === '350+' || bucket === '350-plus') gsmOr.push({ gsm: { $gt: 350 } });
    }
    if (gsmOr.length) and.push({ $or: gsmOr });
  }

  const widthList = [...parseList(width), ...parseList(widths)]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  const minW = parseNumber(minWidth);
  const maxW = parseNumber(maxWidth);
  if (widthList.length) {
    filter.width = { $in: widthList };
  } else if (minW != null || maxW != null) {
    filter.width = {};
    if (minW != null) filter.width.$gte = minW;
    if (maxW != null) filter.width.$lte = maxW;
  }

  const maxMoq = parseNumber(moqMax);
  if (maxMoq != null) {
    filter.moq = { ...(filter.moq || {}), $lte: maxMoq };
  }

  const moqRangeList = parseList(moqRanges);
  if (moqRangeList.length) {
    const moqOr = [];
    for (const bucket of moqRangeList) {
      if (bucket === '1-50') moqOr.push({ moq: { $gte: 1, $lte: 50 } });
      if (bucket === '51-100') moqOr.push({ moq: { $gte: 51, $lte: 100 } });
      if (bucket === '101-250') moqOr.push({ moq: { $gte: 101, $lte: 250 } });
      if (bucket === '251+') moqOr.push({ moq: { $gte: 251 } });
    }
    if (moqOr.length) and.push({ $or: moqOr });
  }

  if (and.length) filter.$and = and;
  return filter;
};

const attachSellers = async (products) => {
  const sellerIds = [...new Set(products.map((product) => String(product.sellerId)))];
  const sellers = await Seller.find({ _id: { $in: sellerIds } });
  const sellerMap = new Map(sellers.map((seller) => [String(seller._id), seller]));
  return products.map((product) =>
    formatMarketplaceProduct(product, sellerMap.get(String(product.sellerId))),
  );
};

/** Lower number = higher browse priority. Same number = same tier (shuffled together). */
const CATEGORY_BROWSE_PRIORITY = {
  cotton: 0,
  linen: 0,
  denim: 1,
  silk: 1,
  synthetic: 2,
};

const hashId = (id) => {
  let hash = 2166136261;
  const text = String(id || '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

/** Deterministic shuffle — same order for every user/request. */
const seededShuffle = (items) =>
  [...items].sort((a, b) => {
    const ha = hashId(a._id);
    const hb = hashId(b._id);
    if (ha !== hb) return ha - hb;
    return String(a._id).localeCompare(String(b._id));
  });

const sortByCategoryBrowsePriority = (products) => {
  const tiers = new Map();

  for (const product of products) {
    const key = String(product.category || '').trim().toLowerCase();
    const priority = CATEGORY_BROWSE_PRIORITY[key] ?? 99;
    if (!tiers.has(priority)) tiers.set(priority, []);
    tiers.get(priority).push(product);
  }

  const ordered = [];
  for (const priority of [...tiers.keys()].sort((a, b) => a - b)) {
    ordered.push(...seededShuffle(tiers.get(priority)));
  }
  return ordered;
};

const hasActiveMarketplaceFilters = (params = {}) => {
  const minP = parseNumber(params.minPrice);
  const maxP = parseNumber(params.maxPrice);
  const minW = parseNumber(params.minWidth);
  const maxW = parseNumber(params.maxWidth);
  const maxMoq = parseNumber(params.moqMax);

  return Boolean(
    String(params.q || '').trim() ||
      parseList(params.category).length ||
      parseList(params.categories).length ||
      minP != null ||
      maxP != null ||
      parseList(params.gsm).length ||
      parseList(params.width).length ||
      parseList(params.widths).length ||
      minW != null ||
      maxW != null ||
      maxMoq != null ||
      parseList(params.moqRanges).length,
  );
};

export const listMarketplaceProducts = async (params = {}, user = null) => {
  const filter = buildMarketplaceFilter(params);
  const products = await Product.find(filter).sort({ updatedAt: -1 }).limit(100);

  // Level 0: no filters → category browse priority (Cotton/Linen → Denim/Silk → Synthetic).
  let ordered = hasActiveMarketplaceFilters(params)
    ? products
    : sortByCategoryBrowsePriority(products);

  // Personalization layer (logged-in buyers): orders, cart, favorites, chats.
  // Runs with and without filters — soft re-ranks within the already-filtered set.
  if (user?.role === 'BUYER' && user?._id) {
    ordered = await personalizeForBuyer(user._id, ordered);
  }

  return attachSellers(ordered);
};

export const suggestMarketplace = async (q = '') => {
  const term = String(q || '').trim();
  if (term.length < 2) {
    return { query: term, products: [] };
  }

  const terms = expandSearchTerms(term);
  const products = await Product.find({
    status: 'published',
    $or: terms.flatMap((entry) => {
      const pattern = new RegExp(escapeRegex(entry), 'i');
      return [
        { name: pattern },
        { description: pattern },
        { category: pattern },
      ];
    }),
  })
    .sort({ updatedAt: -1 })
    .limit(6)
    .select('name category price unit variants coverImage');

  const mapped = products.map((product) => {
    const coverImage =
      product.variants?.find((variant) => variant.images?.length)?.images?.[0] || '';
    return {
      _id: product._id,
      name: product.name,
      category: product.category || '',
      price: product.price,
      unit: product.unit || 'meter',
      coverImage,
    };
  });

  return { query: term, products: mapped };
};

export const getMarketplaceFacets = async () => {
  const published = { status: 'published' };

  const [categoryAgg, widthAgg, docs, priceStats] = await Promise.all([
    Product.aggregate([
      { $match: published },
      {
        $group: {
          _id: { $toLower: '$category' },
          name: { $first: '$category' },
          count: { $sum: 1 },
        },
      },
    ]),
    Product.aggregate([
      { $match: { ...published, width: { $ne: null } } },
      { $group: { _id: '$width', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Product.find(published).select('moq gsm').lean(),
    Product.aggregate([
      { $match: { ...published, price: { $ne: null } } },
      {
        $group: {
          _id: null,
          minPrice: { $min: '$price' },
          maxPrice: { $max: '$price' },
        },
      },
    ]),
  ]);

  const countByCategory = new Map(
    categoryAgg.map((row) => [String(row._id || '').toLowerCase(), row.count]),
  );

  const categories = PRODUCT_CATEGORIES.map((name) => ({
    name,
    count: countByCategory.get(name.toLowerCase()) || 0,
  }));

  const widths = widthAgg.map((row) => ({
    value: row._id,
    label: `${row._id}"`,
    count: row.count,
  }));

  const moqRanges = [
    { id: '1-50', label: '1 – 50 m', min: 1, max: 50 },
    { id: '51-100', label: '51 – 100 m', min: 51, max: 100 },
    { id: '101-250', label: '101 – 250 m', min: 101, max: 250 },
    { id: '251+', label: '251+ m', min: 251, max: null },
  ].map((bucket) => {
    const count = docs.filter((doc) => {
      const moq = Number(doc.moq);
      if (!Number.isFinite(moq)) return false;
      if (bucket.max == null) return moq >= bucket.min;
      return moq >= bucket.min && moq <= bucket.max;
    }).length;
    return { id: bucket.id, label: bucket.label, count };
  });

  const gsmRanges = [
    { id: '0-150', label: 'Up to 150' },
    { id: '150-250', label: '150 – 250' },
    { id: '250-350', label: '250 – 350' },
    { id: '350+', label: '350+' },
  ].map((bucket) => {
    const count = docs.filter((doc) => {
      const gsm = Number(doc.gsm);
      if (!Number.isFinite(gsm)) return false;
      if (bucket.id === '0-150') return gsm <= 150;
      if (bucket.id === '150-250') return gsm > 150 && gsm <= 250;
      if (bucket.id === '250-350') return gsm > 250 && gsm <= 350;
      if (bucket.id === '350+') return gsm > 350;
      return false;
    }).length;
    return { ...bucket, count };
  });

  const widthValues = widths.map((row) => row.value).filter((value) => Number.isFinite(value));
  return {
    categories,
    widths,
    widthRange: {
      min: widthValues.length ? Math.min(...widthValues) : 36,
      max: widthValues.length ? Math.max(...widthValues) : 72,
    },
    moqRanges,
    gsmRanges,
    price: {
      min: priceStats[0]?.minPrice ?? 0,
      max: priceStats[0]?.maxPrice ?? 0,
    },
  };
};

export const getMarketplaceProductById = async (productId) => {
  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw createError('Product not found', 404, 'PRODUCT_NOT_FOUND');
  }

  const product = await Product.findOne({ _id: productId, status: 'published' });
  if (!product) {
    throw createError('Product not found', 404, 'PRODUCT_NOT_FOUND');
  }

  const seller = await Seller.findById(product.sellerId);
  return formatMarketplaceProduct(product, seller);
};
