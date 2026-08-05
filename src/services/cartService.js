import Cart from '../models/Cart.js';
import Product from '../models/Product.js';
import { createError } from '../utils/errors.js';

const ensureBuyer = (user) => {
  if (user.role !== 'BUYER') {
    throw createError('Only buyers can manage cart', 403, 'FORBIDDEN');
  }
};

const resolveVariant = (product, variantId) => {
  if (!product.variants?.length) return null;

  if (!variantId) {
    throw createError(
      `Please select a color for ${product.name}`,
      400,
      'COLOR_REQUIRED',
    );
  }

  const variant =
    product.variants.id?.(variantId) ||
    product.variants.find((entry) => String(entry._id) === String(variantId));

  if (!variant) {
    throw createError(
      `Selected color is unavailable for ${product.name}`,
      400,
      'COLOR_UNAVAILABLE',
    );
  }

  return variant;
};

const populateCart = async (cart) => {
  await cart.populate({
    path: 'items.productId',
    select: 'name price unit moq availableQuantity status variants sellerId category',
  });

  const items = (cart.items || [])
    .filter((item) => item.productId && item.productId.status === 'published')
    .map((item) => {
      const product = item.productId;
      const variant = product.variants?.find(
        (entry) => String(entry._id) === String(item.variantId),
      );

      // Never fall back to another color — keep the buyer's selected snapshot.
      const colorHex = item.colorHex || variant?.colorHex || '';
      const image = variant?.images?.[0] || '';

      return {
        _id: item._id,
        productId: product._id,
        variantId: item.variantId,
        colorHex,
        quantity: item.quantity,
        product: {
          _id: product._id,
          name: product.name,
          price: product.price,
          unit: product.unit,
          moq: product.moq,
          availableQuantity: product.availableQuantity,
          category: product.category,
          image,
          sellerId: product.sellerId,
        },
      };
    });

  return {
    _id: cart._id,
    buyerId: cart.buyerId,
    items,
    updatedAt: cart.updatedAt,
  };
};

export const getCart = async (user) => {
  ensureBuyer(user);
  let cart = await Cart.findOne({ buyerId: user._id });
  if (!cart) {
    cart = await Cart.create({ buyerId: user._id, items: [] });
  }
  return populateCart(cart);
};

export const addToCart = async (user, { productId, variantId, quantity }) => {
  ensureBuyer(user);

  const product = await Product.findOne({ _id: productId, status: 'published' });
  if (!product) throw createError('Product not found', 404, 'PRODUCT_NOT_FOUND');

  const qty = Number(quantity);
  const moq = product.moq || 1;
  if (!qty || qty < moq) {
    throw createError(`Minimum order quantity is ${moq}`, 400, 'VALIDATION_ERROR');
  }
  if (product.availableQuantity != null && qty > product.availableQuantity) {
    throw createError('Requested quantity exceeds available stock', 400, 'OUT_OF_STOCK');
  }

  const variant = resolveVariant(product, variantId);
  const resolvedVariantId = variant?._id || null;
  const colorHex = variant?.colorHex || '';

  let cart = await Cart.findOne({ buyerId: user._id });
  if (!cart) cart = await Cart.create({ buyerId: user._id, items: [] });

  // Same product + same color merges; different colors stay separate lines.
  const existing = cart.items.find(
    (item) =>
      String(item.productId) === String(productId) &&
      String(item.variantId || '') === String(resolvedVariantId || ''),
  );

  if (existing) {
    existing.quantity = qty;
    existing.colorHex = colorHex;
    existing.variantId = resolvedVariantId;
  } else {
    cart.items.push({
      productId,
      variantId: resolvedVariantId,
      colorHex,
      quantity: qty,
    });
  }

  await cart.save();
  return populateCart(cart);
};

export const updateCartItem = async (user, itemId, quantity) => {
  ensureBuyer(user);
  const cart = await Cart.findOne({ buyerId: user._id });
  if (!cart) throw createError('Cart not found', 404, 'CART_NOT_FOUND');

  const item = cart.items.id(itemId);
  if (!item) throw createError('Cart item not found', 404, 'CART_ITEM_NOT_FOUND');

  const qty = Number(quantity);
  if (!qty || qty < 1) throw createError('Invalid quantity', 400, 'VALIDATION_ERROR');

  item.quantity = qty;
  await cart.save();
  return populateCart(cart);
};

export const removeCartItem = async (user, itemId) => {
  ensureBuyer(user);
  const cart = await Cart.findOne({ buyerId: user._id });
  if (!cart) throw createError('Cart not found', 404, 'CART_NOT_FOUND');

  const item = cart.items.id(itemId);
  if (!item) throw createError('Cart item not found', 404, 'CART_ITEM_NOT_FOUND');

  item.deleteOne();
  await cart.save();
  return populateCart(cart);
};

export const clearCart = async (user) => {
  ensureBuyer(user);
  const cart = await Cart.findOne({ buyerId: user._id });
  if (!cart) return { items: [] };
  cart.items = [];
  await cart.save();
  return populateCart(cart);
};
