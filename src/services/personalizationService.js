import Order from '../models/Order.js';
import Cart from '../models/Cart.js';
import Favorite from '../models/Favorite.js';
import Conversation from '../models/Conversation.js';
import Product from '../models/Product.js';
import Buyer from '../models/Buyer.js';
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
  prefFabric: 90,
  prefInterest: 45,
  profileMoq: 58,
  profileBudget: 54,
  profileIndustry: 56,
};

const setBestReason = (map, key, reason, priority, kind = 'other') => {
  if (!key || !reason) return;
  const id = String(key);
  const existing = map.get(id) || {};
  const current = existing[kind];
  if (!current || priority > current.priority) {
    existing[kind] = { reason, priority, kind };
    map.set(id, existing);
  }
};

const hitsFromEntry = (entry) => {
  if (!entry) return [];
  if (entry.fabric || entry.other) {
    return [entry.fabric, entry.other].filter(Boolean);
  }
  return entry.reason ? [entry] : [];
};

const pickReasonHit = (signals, productId, category, kindFilter = null) => {
  const candidates = [
    ...hitsFromEntry(signals.productReasons?.get(String(productId))),
    ...hitsFromEntry(category ? signals.categoryReasons?.get(category) : null),
  ];

  const filtered = kindFilter
    ? candidates.filter((hit) => hit.kind === kindFilter)
    : candidates;

  if (!filtered.length) return null;
  return filtered.reduce((best, hit) =>
    !best || hit.priority > best.priority ? hit : best,
  );
};

const resolveForYouReason = (signals, productId, category, preferredKind = null) => {
  if (preferredKind) {
    const preferred = pickReasonHit(signals, productId, category, preferredKind);
    if (preferred?.reason) return preferred.reason;
  }
  const any = pickReasonHit(signals, productId, category);
  if (any?.reason) return any.reason;
  if (category) return `Matches your ${category} preference`;
  return signals.profileHint || 'Matches your preferred fabrics';
};

const hasReasonKind = (signals, productId, category, kind) =>
  Boolean(pickReasonHit(signals, productId, category, kind));

const buildProfileHint = (buyerPrefs) => {
  if (!buyerPrefs) return '';
  const fabrics = (buyerPrefs.preferredFabrics || []).filter(Boolean);
  if (fabrics.length) {
    return `Matches preferred ${fabrics.slice(0, 2).join(' & ')}`;
  }
  if (buyerPrefs.industry) return `Fits your ${buyerPrefs.industry} profile`;
  if (buyerPrefs.businessType) return `For ${buyerPrefs.businessType} buyers`;
  return '';
};

/** Product MOQ is workable for the buyer's typical order size. */
const moqFitsTypicalOrder = (moq, typicalOrderQuantity) => {
  const value = Number(moq);
  if (!Number.isFinite(value) || value <= 0) return false;
  switch (typicalOrderQuantity) {
    case 'Under 100 m':
      return value <= 100;
    case '100 – 500 m':
      return value <= 500;
    case '500 – 2,000 m':
      return value <= 2000;
    case '2,000 m+':
      return value >= 50;
    default:
      return false;
  }
};

const midQtyForRange = (typicalOrderQuantity) => {
  switch (typicalOrderQuantity) {
    case 'Under 100 m':
      return 80;
    case '100 – 500 m':
      return 300;
    case '500 – 2,000 m':
      return 1000;
    case '2,000 m+':
      return 2500;
    default:
      return 200;
  }
};

const budgetCapForRange = (budgetRange) => {
  switch (budgetRange) {
    case 'Under ₹50,000':
      return 50000;
    case '₹50,000 – ₹2 Lakh':
      return 200000;
    case '₹2 Lakh – ₹10 Lakh':
      return 1000000;
    case '₹10 Lakh+':
      return Infinity;
    default:
      return null;
  }
};

/** Rough order value (price × typical qty) fits buyer budget band. */
const budgetFitsProfile = (price, typicalOrderQuantity, budgetRange) => {
  const unitPrice = Number(price);
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return false;
  const cap = budgetCapForRange(budgetRange);
  if (cap == null) return false;
  if (cap === Infinity) return true;
  const qty = midQtyForRange(typicalOrderQuantity);
  return unitPrice * qty <= cap;
};

const collectOtherReasonOptions = (signals, product, productId, category) => {
  const profile = signals.buyerProfile || {};
  const options = [];
  const seen = new Set();
  const push = (text) => {
    const reason = String(text || '').trim();
    if (!reason || seen.has(reason)) return;
    seen.add(reason);
    options.push(reason);
  };

  if (profile.industry) {
    push(`Good fit for ${profile.industry} buyers`);
  }
  if (
    profile.typicalOrderQuantity &&
    moqFitsTypicalOrder(product.moq, profile.typicalOrderQuantity)
  ) {
    push(`MOQ suits ${profile.typicalOrderQuantity} orders`);
  }
  if (
    profile.budgetRange &&
    budgetFitsProfile(product.price, profile.typicalOrderQuantity, profile.budgetRange)
  ) {
    push(`Fits your ${profile.budgetRange} budget`);
  }
  if (profile.interests?.[0]) {
    push(`Fits your “${profile.interests[0]}” interest`);
  }
  if (profile.businessType) {
    push(`Popular with ${profile.businessType}s`);
  }

  const signalHit = pickReasonHit(signals, productId, category, 'other');
  if (signalHit?.reason) push(signalHit.reason);

  return options;
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
    productReasons: new Map(),
    categoryReasons: new Map(),
    profileHint: '',
    hasSignals: false,
  };
  if (!buyerId) return empty;

  const [orders, cart, favorite, conversation, buyerPrefs] = await Promise.all([
    Order.find({
      buyerId,
      status: {
        $in: ['PENDING', 'ACCEPTED', 'PREPARING', 'READY_FOR_DISPATCH', 'COMPLETED'],
      },
    })
      .select('items.productId')
      .sort({ createdAt: -1 })
      .limit(40)
      .lean(),
    Cart.findOne({ buyerId }).select('items.productId').lean(),
    Favorite.findOne({ buyerId }).select('products').lean(),
    Conversation.findOne({ buyerId }).select('messages').lean(),
    Buyer.findOne({ userId: buyerId })
      .select(
        'preferredFabrics interests industry businessType typicalOrderQuantity budgetRange businessTypeOther industryOther',
      )
      .lean(),
  ]);

  const productScores = new Map();
  const categoryScores = new Map();
  const productReasons = new Map();
  const categoryReasons = new Map();
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
        setBestReason(
          productReasons,
          item.productId,
          'From a fabric you’ve ordered before',
          WEIGHTS.orderProduct,
          'other',
        );
      }
    }
  }

  const cartProductIds = (cart?.items || [])
    .map((item) => (item.productId ? String(item.productId) : null))
    .filter(Boolean);
  for (const id of cartProductIds) {
    bump(productScores, id, WEIGHTS.cartProduct);
    setBestReason(productReasons, id, 'Similar to items in your cart', WEIGHTS.cartProduct, 'other');
  }

  const favoriteProductIds = (favorite?.products || []).map((id) => String(id));
  for (const id of favoriteProductIds) {
    bump(productScores, id, WEIGHTS.favoriteProduct);
    setBestReason(productReasons, id, 'Based on your favourites', WEIGHTS.favoriteProduct, 'other');
  }

  const chatTexts = (conversation?.messages || [])
    .filter((msg) => msg.role === 'user')
    .slice(-30)
    .map((msg) => msg.content);

  for (const text of chatTexts) {
    for (const category of extractCategoriesFromText(text)) {
      bump(categoryScores, category, WEIGHTS.chatCategory);
      setBestReason(
        categoryReasons,
        category,
        'Based on your recent AI chats',
        WEIGHTS.chatCategory,
        'other',
      );
    }
    for (const productId of extractProductIdsFromText(text)) {
      bump(productScores, productId, WEIGHTS.chatProduct);
      setBestReason(
        productReasons,
        productId,
        'Based on your recent AI chats',
        WEIGHTS.chatProduct,
        'other',
      );
    }
  }

  for (const fabric of buyerPrefs?.preferredFabrics || []) {
    const category = normalizeCategory(fabric);
    bump(categoryScores, category, WEIGHTS.prefFabric);
    setBestReason(
      categoryReasons,
      category,
      `Matches your ${category} preference`,
      WEIGHTS.prefFabric,
      'fabric',
    );
  }

  for (const interest of buyerPrefs?.interests || []) {
    for (const category of extractCategoriesFromText(interest)) {
      bump(categoryScores, category, WEIGHTS.prefInterest);
      setBestReason(
        categoryReasons,
        category,
        `Fits your “${interest}” interest`,
        WEIGHTS.prefInterest,
        'other',
      );
    }
  }

  if (buyerPrefs?.industry) {
    for (const category of extractCategoriesFromText(buyerPrefs.industry)) {
      bump(categoryScores, category, WEIGHTS.prefInterest);
      setBestReason(
        categoryReasons,
        category,
        `Good fit for ${buyerPrefs.industry} buyers`,
        WEIGHTS.prefInterest,
        'other',
      );
    }
  }

  // Soft "other" reasons on preferred fabrics (industry / interest always available).
  const industryLabel =
    buyerPrefs?.industry === 'Other' && buyerPrefs?.industryOther
      ? buyerPrefs.industryOther
      : buyerPrefs?.industry;
  if (industryLabel) {
    for (const fabric of buyerPrefs.preferredFabrics || []) {
      const category = normalizeCategory(fabric);
      setBestReason(
        categoryReasons,
        category,
        `Good fit for ${industryLabel} buyers`,
        WEIGHTS.profileIndustry,
        'other',
      );
    }
  }
  if (buyerPrefs?.interests?.length) {
    const interest = buyerPrefs.interests[0];
    for (const fabric of buyerPrefs.preferredFabrics || []) {
      const category = normalizeCategory(fabric);
      setBestReason(
        categoryReasons,
        category,
        `Fits your “${interest}” interest`,
        WEIGHTS.prefInterest,
        'other',
      );
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
      const category = categoryByProduct.get(id);
      bump(categoryScores, category, WEIGHTS.orderCategory);
      setBestReason(
        categoryReasons,
        category,
        'Similar to fabrics you’ve ordered',
        WEIGHTS.orderCategory,
        'other',
      );
    }
    for (const id of cartProductIds) {
      const category = categoryByProduct.get(id);
      bump(categoryScores, category, WEIGHTS.cartCategory);
      setBestReason(
        categoryReasons,
        category,
        'Similar to items in your cart',
        WEIGHTS.cartCategory,
        'other',
      );
    }
    for (const id of favoriteProductIds) {
      const category = categoryByProduct.get(id);
      bump(categoryScores, category, WEIGHTS.favoriteCategory);
      setBestReason(
        categoryReasons,
        category,
        'Similar to your favourites',
        WEIGHTS.favoriteCategory,
        'other',
      );
    }
  }

  return {
    productScores,
    categoryScores,
    productReasons,
    categoryReasons,
    buyerProfile: buyerPrefs
      ? {
          preferredFabrics: buyerPrefs.preferredFabrics || [],
          interests: buyerPrefs.interests || [],
          industry:
            buyerPrefs.industry === 'Other' && buyerPrefs.industryOther
              ? buyerPrefs.industryOther
              : buyerPrefs.industry || '',
          businessType:
            buyerPrefs.businessType === 'Other' && buyerPrefs.businessTypeOther
              ? buyerPrefs.businessTypeOther
              : buyerPrefs.businessType || '',
          typicalOrderQuantity: buyerPrefs.typicalOrderQuantity || '',
          budgetRange: buyerPrefs.budgetRange || '',
        }
      : null,
    profileHint: buildProfileHint(buyerPrefs),
    hasSignals: productScores.size > 0 || categoryScores.size > 0,
  };
};

/** Max marketplace cards that get the "Picked for you" badge. */
const FOR_YOU_BADGE_LIMIT = 7;

/**
 * Soft re-rank a product list using buyer signals.
 * Preserves relative order for equal scores (stable).
 * Badges mix ~2 fabric : 1 other reason for variety (max 7).
 */
export const personalizeProductList = (products, signals) => {
  if (!Array.isArray(products) || !products.length) return products;

  const toPlain = (product) => {
    if (!product) return product;
    if (typeof product.toObject === 'function') return product.toObject();
    return { ...product };
  };

  if (!signals?.hasSignals) {
    return products.map((product) => {
      const plain = toPlain(product);
      plain.forYou = false;
      plain.forYouReason = '';
      return plain;
    });
  }

  const scored = products.map((product, index) => {
    const plain = toPlain(product);
    const productId = String(plain._id || plain.id || '');
    const category = normalizeCategory(plain.category);
    let score =
      (signals.productScores.get(productId) || 0) +
      (category ? signals.categoryScores.get(category) || 0 : 0);

    const profile = signals.buyerProfile || {};
    if (
      profile.typicalOrderQuantity &&
      moqFitsTypicalOrder(plain.moq, profile.typicalOrderQuantity)
    ) {
      score += WEIGHTS.profileMoq;
      setBestReason(
        signals.productReasons,
        productId,
        `MOQ suits ${profile.typicalOrderQuantity} orders`,
        WEIGHTS.profileMoq,
        'other',
      );
    }
    if (
      profile.budgetRange &&
      budgetFitsProfile(plain.price, profile.typicalOrderQuantity, profile.budgetRange)
    ) {
      score += WEIGHTS.profileBudget;
      setBestReason(
        signals.productReasons,
        productId,
        `Fits your ${profile.budgetRange} budget`,
        WEIGHTS.profileBudget,
        'other',
      );
    }
    if (profile.industry && score > 0) {
      setBestReason(
        signals.productReasons,
        productId,
        `Good fit for ${profile.industry} buyers`,
        WEIGHTS.profileIndustry,
        'other',
      );
    }

    return { product: plain, index, score, productId, category };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  });

  const matched = scored.filter((row) => row.score > 0);
  const fabricQueue = matched.filter((row) =>
    hasReasonKind(signals, row.productId, row.category, 'fabric'),
  );
  // Prefer products that can show industry / qty / budget / interest text.
  const otherQueue = matched.filter((row) => {
    const options = collectOtherReasonOptions(
      signals,
      row.product,
      row.productId,
      row.category,
    );
    return options.length > 0;
  });

  const badgeById = new Map();
  let otherReasonCursor = 0;

  const takeNext = (queue, kind) => {
    while (queue.length) {
      const row = queue.shift();
      if (badgeById.has(row.productId)) continue;

      if (kind === 'other') {
        const options = collectOtherReasonOptions(
          signals,
          row.product,
          row.productId,
          row.category,
        );
        if (!options.length) continue;
        const reason = options[otherReasonCursor % options.length];
        otherReasonCursor += 1;
        badgeById.set(row.productId, reason);
        return true;
      }

      badgeById.set(
        row.productId,
        resolveForYouReason(signals, row.productId, row.category, 'fabric'),
      );
      return true;
    }
    return false;
  };

  // Pattern: fabric, fabric, other, repeat… up to 7 badges.
  while (badgeById.size < FOR_YOU_BADGE_LIMIT) {
    const before = badgeById.size;
    takeNext(fabricQueue, 'fabric');
    if (badgeById.size >= FOR_YOU_BADGE_LIMIT) break;
    takeNext(fabricQueue, 'fabric');
    if (badgeById.size >= FOR_YOU_BADGE_LIMIT) break;
    takeNext(otherQueue, 'other');
    if (badgeById.size === before) {
      if (!takeNext(fabricQueue, 'fabric') && !takeNext(otherQueue, 'other')) break;
    }
  }

  return scored.map((row) => {
    const reason = badgeById.get(row.productId);
    row.product.forYou = Boolean(reason);
    row.product.forYouReason = reason || '';
    return row.product;
  });
};

export const personalizeForBuyer = async (buyerId, products) => {
  if (!buyerId || !products?.length) return products;
  const signals = await collectBuyerSignals(buyerId);
  return personalizeProductList(products, signals);
};
