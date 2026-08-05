import Order from '../models/Order.js';
import Cart from '../models/Cart.js';
import Favorite from '../models/Favorite.js';
import Conversation from '../models/Conversation.js';
import Product from '../models/Product.js';
import { PRODUCT_CATEGORIES } from '../constants/categories.js';

const TERM_TO_CATEGORY = {
  jeans: 'Denim',
  jean: 'Denim',
  denim: 'Denim',
  jacket: 'Denim',
  shirts: 'Cotton',
  shirt: 'Cotton',
  saree: 'Silk',
  sari: 'Silk',
  linen: 'Linen',
  cotton: 'Cotton',
  silk: 'Silk',
  synthetic: 'Synthetic',
};

const WEIGHTS = {
  orderProduct: 100,
  orderCategory: 40,
  cartProduct: 80,
  cartCategory: 30,
  favoriteProduct: 70,
  favoriteCategory: 25,
  chatCategory: 35,
  chatProduct: 50,
};

const normalizeCategory = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return (
    PRODUCT_CATEGORIES.find((item) => item.toLowerCase() === raw.toLowerCase()) || null
  );
};

const extractCategoriesFromText = (text) => {
  const lower = String(text || '').toLowerCase();
  const found = new Set();
  for (const [term, category] of Object.entries(TERM_TO_CATEGORY)) {
    if (new RegExp(`\\b${term}\\b`, 'i').test(lower)) {
      found.add(category);
    }
  }
  for (const category of PRODUCT_CATEGORIES) {
    if (new RegExp(`\\b${category.toLowerCase()}\\b`, 'i').test(lower)) {
      found.add(category);
    }
  }
  return [...found];
};

const extractProductIdsFromText = (text) => {
  const matches = String(text || '').match(/\b[a-f0-9]{24}\b/gi) || [];
  return [...new Set(matches.map((id) => String(id)))];
};

/**
 * Append a user/assistant turn for personalization signals.
 * Keeps the latest 80 messages per buyer.
 */
export const appendConversationTurn = async (buyerId, userMessage, assistantMessage) => {
  if (!buyerId) return null;
  const userContent = String(userMessage || '').trim();
  const assistantContent = String(assistantMessage || '').trim();
  if (!userContent && !assistantContent) return null;

  const turns = [];
  if (userContent) turns.push({ role: 'user', content: userContent.slice(0, 2000) });
  if (assistantContent) turns.push({ role: 'assistant', content: assistantContent.slice(0, 4000) });

  let conversation = await Conversation.findOne({ buyerId });
  if (!conversation) {
    conversation = await Conversation.create({ buyerId, messages: turns });
    return conversation;
  }

  conversation.messages.push(...turns);
  if (conversation.messages.length > 80) {
    conversation.messages = conversation.messages.slice(-80);
  }
  await conversation.save();
  return conversation;
};

export const collectBuyerSignals = async (buyerId) => {
  const empty = {
    productScores: new Map(),
    categoryScores: new Map(),
    hasSignals: false,
  };
  if (!buyerId) return empty;

  const [orders, cart, favorite, conversation] = await Promise.all([
    Order.find({
      buyerId,
      status: { $in: ['PLACED', 'DISPATCHED', 'DELIVERED'] },
    })
      .select('items.productId')
      .sort({ createdAt: -1 })
      .limit(40)
      .lean(),
    Cart.findOne({ buyerId }).select('items.productId').lean(),
    Favorite.findOne({ buyerId }).select('products').lean(),
    Conversation.findOne({ buyerId }).select('messages').lean(),
  ]);

  const productScores = new Map();
  const categoryScores = new Map();
  const bump = (map, key, amount) => {
    if (!key) return;
    const id = String(key);
    map.set(id, (map.get(id) || 0) + amount);
  };

  const orderProductIds = [];
  for (const order of orders) {
    for (const item of order.items || []) {
      if (item.productId) {
        orderProductIds.push(String(item.productId));
        bump(productScores, item.productId, WEIGHTS.orderProduct);
      }
    }
  }

  const cartProductIds = (cart?.items || [])
    .map((item) => (item.productId ? String(item.productId) : null))
    .filter(Boolean);
  for (const id of cartProductIds) bump(productScores, id, WEIGHTS.cartProduct);

  const favoriteProductIds = (favorite?.products || []).map((id) => String(id));
  for (const id of favoriteProductIds) bump(productScores, id, WEIGHTS.favoriteProduct);

  const chatTexts = (conversation?.messages || [])
    .filter((msg) => msg.role === 'user')
    .slice(-30)
    .map((msg) => msg.content);

  for (const text of chatTexts) {
    for (const category of extractCategoriesFromText(text)) {
      bump(categoryScores, category, WEIGHTS.chatCategory);
    }
    for (const productId of extractProductIdsFromText(text)) {
      bump(productScores, productId, WEIGHTS.chatProduct);
    }
  }

  const allProductIds = [
    ...new Set([...orderProductIds, ...cartProductIds, ...favoriteProductIds, ...productScores.keys()]),
  ];

  if (allProductIds.length) {
    const products = await Product.find({ _id: { $in: allProductIds } })
      .select('category')
      .lean();
    const categoryByProduct = new Map(
      products.map((product) => [String(product._id), normalizeCategory(product.category)]),
    );

    for (const id of orderProductIds) {
      bump(categoryScores, categoryByProduct.get(id), WEIGHTS.orderCategory);
    }
    for (const id of cartProductIds) {
      bump(categoryScores, categoryByProduct.get(id), WEIGHTS.cartCategory);
    }
    for (const id of favoriteProductIds) {
      bump(categoryScores, categoryByProduct.get(id), WEIGHTS.favoriteCategory);
    }
  }

  return {
    productScores,
    categoryScores,
    hasSignals: productScores.size > 0 || categoryScores.size > 0,
  };
};

/**
 * Soft re-rank a product list using buyer signals.
 * Preserves relative order for equal scores (stable).
 */
export const personalizeProductList = (products, signals) => {
  if (!Array.isArray(products) || !products.length) return products;
  if (!signals?.hasSignals) return products;

  const scored = products.map((product, index) => {
    const productId = String(product._id || product.id || '');
    const category = normalizeCategory(product.category);
    const score =
      (signals.productScores.get(productId) || 0) +
      (category ? signals.categoryScores.get(category) || 0 : 0);
    return { product, index, score };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  });

  return scored.map((row) => row.product);
};

export const personalizeForBuyer = async (buyerId, products) => {
  if (!buyerId || !products?.length) return products;
  const signals = await collectBuyerSignals(buyerId);
  return personalizeProductList(products, signals);
};
