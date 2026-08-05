import Favorite from '../models/Favorite.js';
import Product from '../models/Product.js';
import { createError } from '../utils/errors.js';

const ensureBuyer = (user) => {
  if (user.role !== 'BUYER') {
    throw createError('Only buyers can manage favorites', 403, 'FORBIDDEN');
  }
};

const formatFavorites = async (favorite) => {
  await favorite.populate({
    path: 'products',
    match: { status: 'published' },
    select: 'name price unit moq gsm availableQuantity category variants status',
  });

  const products = (favorite.products || []).filter(Boolean).map((product) => ({
    _id: product._id,
    name: product.name,
    price: product.price,
    unit: product.unit,
    moq: product.moq,
    gsm: product.gsm,
    availableQuantity: product.availableQuantity,
    category: product.category,
    coverImage: product.variants?.find((v) => v.images?.length)?.images?.[0] || '',
    colors: (product.variants || []).map((v) => v.colorHex).filter(Boolean),
  }));

  return {
    _id: favorite._id,
    buyerId: favorite.buyerId,
    products,
  };
};

export const getFavorites = async (user) => {
  ensureBuyer(user);
  let favorite = await Favorite.findOne({ buyerId: user._id });
  if (!favorite) {
    favorite = await Favorite.create({ buyerId: user._id, products: [] });
  }
  return formatFavorites(favorite);
};

export const addFavorite = async (user, productId) => {
  ensureBuyer(user);
  const product = await Product.findOne({ _id: productId, status: 'published' });
  if (!product) throw createError('Product not found', 404, 'PRODUCT_NOT_FOUND');

  let favorite = await Favorite.findOne({ buyerId: user._id });
  if (!favorite) {
    favorite = await Favorite.create({ buyerId: user._id, products: [productId] });
  } else if (!favorite.products.some((id) => String(id) === String(productId))) {
    favorite.products.push(productId);
    await favorite.save();
  }

  return formatFavorites(favorite);
};

export const removeFavorite = async (user, productId) => {
  ensureBuyer(user);
  const favorite = await Favorite.findOne({ buyerId: user._id });
  if (!favorite) {
    return { _id: null, buyerId: user._id, products: [] };
  }

  favorite.products = favorite.products.filter((id) => String(id) !== String(productId));
  await favorite.save();
  return formatFavorites(favorite);
};

export const isFavorite = async (user, productId) => {
  if (!user || user.role !== 'BUYER') return false;
  const favorite = await Favorite.findOne({ buyerId: user._id });
  if (!favorite) return false;
  return favorite.products.some((id) => String(id) === String(productId));
};
