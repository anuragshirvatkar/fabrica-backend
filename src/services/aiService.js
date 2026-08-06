import Product from '../models/Product.js';
import { PRODUCT_CATEGORIES } from '../constants/categories.js';
import { openai, openaiEnabled, openaiModel } from '../config/openai.js';
import {
  getMarketplaceProductById,
  listMarketplaceProducts,
} from './marketplaceService.js';
import { personalizeForBuyer } from './personalizationService.js';
import {
  formatBuyerPrefsForAi,
  getBuyerPreferencesLean,
} from './buyerService.js';
import { createError } from '../utils/errors.js';

const loadBuyerPrefsText = async (user) => {
  if (user?.role !== 'BUYER' || !user?._id) return '';
  const prefs = await getBuyerPreferencesLean(user._id);
  return formatBuyerPrefsForAi(prefs);
};

const enrichQueryWithPrefs = (query, prefsText) => {
  const base = String(query || '').trim();
  if (!prefsText) return base;
  if (!base) return `Recommend fabrics for this buyer profile: ${prefsText}`;
  return `${base}\nBuyer profile preferences: ${prefsText}`;
};

const SYSTEM_SOURCING =
  'You are Fabrica AI, a premium B2B textile sourcing expert for Indian and global fabric buyers. Speak warmly and professionally. Never invent products, prices, GSM, colors, or specs. Only use catalog data provided in the message. If data is missing, say so clearly.';

const ensureOpenAI = () => {
  if (!openaiEnabled || !openai) {
    throw createError(
      'AI assistant is not configured. Set OPENAI_API_KEY on the server.',
      503,
      'AI_UNAVAILABLE',
    );
  }
};

const chatJson = async (messages, temperature = 0.2) => {
  ensureOpenAI();
  const completion = await openai.chat.completions.create({
    model: openaiModel,
    temperature,
    response_format: { type: 'json_object' },
    messages,
  });
  const raw = completion.choices?.[0]?.message?.content || '{}';
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

const chatText = async (messages, temperature = 0.4) => {
  ensureOpenAI();
  const completion = await openai.chat.completions.create({
    model: openaiModel,
    temperature,
    messages,
  });
  return completion.choices?.[0]?.message?.content?.trim() || '';
};

const productCard = (product) => {
  const variants = (product.variants || []).map((variant) => ({
    _id: variant._id,
    colorHex: variant.colorHex || '',
    images: variant.images || [],
  }));
  const colors =
    product.colors?.length
      ? product.colors
      : variants.map((variant) => variant.colorHex).filter(Boolean);
  const coverImage =
    product.coverImage ||
    variants.find((variant) => variant.images.length)?.images[0] ||
    '';

  return {
    _id: String(product._id),
    name: product.name,
    category: product.category || '',
    description: product.description || '',
    price: product.price,
    gsm: product.gsm,
    width: product.width,
    moq: product.moq,
    availableQuantity: product.availableQuantity,
    unit: product.unit || 'meter',
    colors,
    variants,
    coverImage,
    seller: product.seller
      ? {
          _id: product.seller._id,
          companyName: product.seller.companyName,
          verified: product.seller.verified,
          description: product.seller.description || '',
        }
      : null,
    forYou: Boolean(product.forYou || product._forYou),
    forYouReason: String(product.forYouReason || '').trim(),
  };
};

const compactProduct = (product) => ({
  id: String(product._id),
  name: product.name,
  category: product.category || null,
  description: (product.description || '').slice(0, 280),
  price: product.price,
  gsm: product.gsm,
  width: product.width,
  moq: product.moq,
  unit: product.unit || 'meter',
  colors: product.colors || [],
  inStock: (product.availableQuantity ?? 0) > 0,
});

const USE_CASE_KEYWORDS = {
  shirt: ['shirt', 'shirts', 'office', 'formal', 'uniform'],
  dress: ['dress', 'dresses', 'summer dress', 'gown'],
  sofa: ['sofa', 'upholstery', 'curtain', 'home', 'furnishing'],
  denim: ['jeans', 'jacket', 'denim'],
  saree: ['saree', 'sari'],
};

/** Map common garment / slang terms to marketplace fabric categories. */
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

const inferCategoryFromText = (text) => {
  const lower = String(text || '').toLowerCase();
  if (!lower.trim()) return null;
  for (const [term, category] of Object.entries(TERM_TO_CATEGORY)) {
    if (new RegExp(`\\b${term}\\b`, 'i').test(lower)) return category;
  }
  return null;
};

const toOptionalNumber = (value, { allowZero = false } = {}) => {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (!allowZero && num <= 0) return null;
  return num;
};

const normalizeParsed = (parsed = {}) => {
  const categoryRaw = String(parsed.category || '').trim();
  const category = PRODUCT_CATEGORIES.find(
    (item) => item.toLowerCase() === categoryRaw.toLowerCase(),
  ) || null;

  return {
    category,
    color: parsed.color ? String(parsed.color).trim().toLowerCase() : null,
    minPrice: toOptionalNumber(parsed.minPrice, { allowZero: true }),
    maxPrice: toOptionalNumber(parsed.maxPrice, { allowZero: true }),
    minGsm: toOptionalNumber(parsed.minGsm),
    maxGsm: toOptionalNumber(parsed.maxGsm),
    keywords: Array.isArray(parsed.keywords)
      ? parsed.keywords
          .map((k) => String(k).trim())
          .filter((k) => k && !['lightweight', 'premium', 'cheap', 'good'].includes(k.toLowerCase()))
      : [],
    useCase: parsed.useCase ? String(parsed.useCase).trim() : null,
  };
};

export const parseNaturalLanguageQuery = async (query) => {
  const text = String(query || '').trim();
  if (!text) throw createError('Query is required', 400, 'QUERY_REQUIRED');

  const parsed = await chatJson([
    {
      role: 'system',
      content: `Extract fabric marketplace search filters from the buyer query.
Return JSON with keys:
category (one of ${PRODUCT_CATEGORIES.join(', ')} or null),
color (string or null),
minPrice (number or null),
maxPrice (number or null),
minGsm (number or null),
maxGsm (number or null),
keywords (string array),
useCase (string or null).
Map garment/use synonyms to fabric categories when strongly implied:
- jeans / jean jacket → Denim
- shirt / shirts → Cotton (unless another fabric is named)
- saree / sari → Silk (unless another fabric is named)
Put the buyer's original words in useCase when they describe a garment or use.
Only extract what is clearly stated or strongly implied. Do not invent prices or GSM.`,
    },
    { role: 'user', content: text },
  ]);

  const normalized = normalizeParsed(parsed);
  if (!normalized.category) {
    normalized.category = inferCategoryFromText(text);
  }
  if (!normalized.useCase && inferCategoryFromText(text)) {
    normalized.useCase = text;
  }
  return normalized;
};

const filterByColorAndKeywords = (products, parsed) => {
  let result = products;

  if (parsed.color) {
    const color = parsed.color.toLowerCase();
    const colorMatched = result.filter((product) => {
      const names = (product.colorNames || []).join(' ');
      const blob = `${product.name} ${product.description} ${(product.colors || []).join(' ')} ${names}`.toLowerCase();
      return blob.includes(color);
    });
    if (colorMatched.length) result = colorMatched;
  }

  if (parsed.minGsm != null || parsed.maxGsm != null) {
    const gsmMatched = result.filter((product) => {
      if (product.gsm == null) return false;
      if (parsed.minGsm != null && product.gsm < parsed.minGsm) return false;
      if (parsed.maxGsm != null && product.gsm > parsed.maxGsm) return false;
      return true;
    });
    if (gsmMatched.length) result = gsmMatched;
  }

  if (parsed.keywords?.length) {
    const keys = parsed.keywords.map((k) => k.toLowerCase());
    const matched = result.filter((product) => {
      const blob = `${product.name} ${product.description} ${product.category}`.toLowerCase();
      return keys.some((key) => blob.includes(key));
    });
    // Soft filter: keep prior matches if keyword text is not present on listings.
    if (matched.length) result = matched;
  }

  if (parsed.useCase) {
    const use = parsed.useCase.toLowerCase();
    const related = Object.values(USE_CASE_KEYWORDS)
      .find((list) => list.some((word) => use.includes(word))) || [use];
    const ranked = result.map((product) => {
      const blob = `${product.name} ${product.description}`.toLowerCase();
      const score = related.reduce((sum, word) => (blob.includes(word) ? sum + 1 : sum), 0);
      return { product, score };
    });
    ranked.sort((a, b) => b.score - a.score);
    if (ranked.some((row) => row.score > 0)) {
      result = ranked.filter((row) => row.score > 0).map((row) => row.product);
    }
  }

  return result;
};

const searchCatalog = async (query, parsed, user = null) => {
  const category =
    parsed.category ||
    inferCategoryFromText(query) ||
    inferCategoryFromText((parsed.keywords || []).join(' ')) ||
    inferCategoryFromText(parsed.useCase || '');

  const priceParams = {
    minPrice: parsed.minPrice ?? undefined,
    maxPrice: parsed.maxPrice ?? undefined,
  };

  let products = [];

  // Catalog fetch without user — personalize once after NL soft-filters.
  if (category) {
    products = await listMarketplaceProducts({
      category,
      ...priceParams,
    });
  }

  if (!products.length) {
    products = await listMarketplaceProducts({
      q: query,
      category: category || undefined,
      ...priceParams,
    });
  }

  if (!products.length && (category || parsed.maxPrice != null || parsed.minPrice != null)) {
    products = await listMarketplaceProducts({
      category: category || undefined,
      ...priceParams,
    });
  }

  if (!products.length) {
    products = await listMarketplaceProducts({ q: query });
  }

  const enriched = {
    ...parsed,
    category: category || parsed.category,
    useCase: parsed.useCase || query,
  };

  let matched = filterByColorAndKeywords(products, enriched);

  if (user?.role === 'BUYER' && user?._id) {
    matched = await personalizeForBuyer(user._id, matched);
  }

  return matched;
};

export const aiSearch = async (query, options = {}) => {
  const text = String(query || '').trim();
  if (!text) throw createError('Query is required', 400, 'QUERY_REQUIRED');

  const silent = Boolean(options.silent);
  const user = options.user || null;
  const parsed = await parseNaturalLanguageQuery(text);
  const products = await searchCatalog(text, parsed, user);
  const cards = products.slice(0, 24).map(productCard);

  // Silent search (normal marketplace search bars) skips the spoken summary.
  let summary = '';
  if (!silent) {
    if (cards.length) {
      summary = await chatText([
        { role: 'system', content: SYSTEM_SOURCING },
        {
          role: 'user',
          content: `Buyer asked: "${text}"
Extracted filters: ${JSON.stringify(parsed)}
Matching catalog products (JSON): ${JSON.stringify(cards.map(compactProduct))}
Write 2-3 short sentences summarizing what you found. Mention only these products. If few matches, say so.`,
        },
      ]);
    } else {
      summary =
        'I could not find published fabrics that match that request in the Fabrica catalog. Try adjusting category, price, or fabric type.';
    }
  }

  return {
    query: text,
    filters: parsed,
    summary,
    products: cards,
    count: cards.length,
  };
};

export const aiRecommend = async (query, options = {}) => {
  const text = String(query || '').trim();
  const user = options.user || null;
  const prefsText = await loadBuyerPrefsText(user);
  const enriched = enrichQueryWithPrefs(text, prefsText);
  if (!enriched) throw createError('Query is required', 400, 'QUERY_REQUIRED');

  const parsed = await parseNaturalLanguageQuery(enriched);
  const products = (await searchCatalog(enriched, parsed, user)).slice(0, 6).map(productCard);

  if (!products.length) {
    return {
      query: text || enriched,
      message:
        'No matching published fabrics were found in the catalog for that use case. Try a broader request.',
      products: [],
      recommendations: [],
    };
  }

  const explained = await chatJson([
    { role: 'system', content: SYSTEM_SOURCING },
    {
      role: 'user',
      content: `Buyer need: "${text || enriched}"
${prefsText ? `Known buyer preferences (also consider cart/favorites ranking already applied): ${prefsText}` : ''}
Catalog matches (use only these): ${JSON.stringify(products.map(compactProduct))}
Return JSON: { "message": string, "recommendations": [ { "productId": string, "reason": string } ] }
Give a short reason for each product based only on provided fields. Do not invent specs.`,
    },
  ]);

  const recommendations = Array.isArray(explained.recommendations)
    ? explained.recommendations
        .map((row) => {
          const product = products.find((p) => p._id === String(row.productId));
          if (!product) return null;
          return {
            product,
            reason: String(row.reason || '').trim(),
          };
        })
        .filter(Boolean)
    : products.map((product) => ({
        product,
        reason: 'Matches your sourcing request based on available catalog details.',
      }));

  return {
    query: text,
    message: String(explained.message || 'Here are suitable fabrics from the catalog.'),
    products,
    recommendations,
  };
};

export const aiCompare = async (productIdA, productIdB) => {
  if (!productIdA || !productIdB) {
    throw createError('Two product IDs are required', 400, 'PRODUCTS_REQUIRED');
  }
  if (String(productIdA) === String(productIdB)) {
    throw createError('Choose two different products to compare', 400, 'SAME_PRODUCT');
  }

  const [a, b] = await Promise.all([
    getMarketplaceProductById(productIdA),
    getMarketplaceProductById(productIdB),
  ]);

  const left = compactProduct(productCard(a));
  const right = compactProduct(productCard(b));

  const comparison = await chatJson([
    { role: 'system', content: SYSTEM_SOURCING },
    {
      role: 'user',
      content: `Compare these two catalog fabrics only. Never invent missing specs.
Product A: ${JSON.stringify(left)}
Product B: ${JSON.stringify(right)}
Return JSON:
{
  "summary": string,
  "dimensions": [
    { "label": "Price", "productA": string, "productB": string },
    { "label": "GSM", "productA": string, "productB": string },
    { "label": "Applications", "productA": string, "productB": string },
    { "label": "Durability", "productA": string, "productB": string },
    { "label": "Comfort", "productA": string, "productB": string },
    { "label": "Breathability", "productA": string, "productB": string },
    { "label": "Best use cases", "productA": string, "productB": string }
  ],
  "verdict": string
}
If a field is missing, say "Not specified in catalog".`,
    },
  ]);

  return {
    productA: productCard(a),
    productB: productCard(b),
    summary: String(comparison.summary || ''),
    dimensions: Array.isArray(comparison.dimensions) ? comparison.dimensions : [],
    verdict: String(comparison.verdict || ''),
  };
};

export const findSimilarProducts = async (productId, limit = 8) => {
  const product = await Product.findOne({ _id: productId, status: 'published' });
  if (!product) throw createError('Product not found', 404, 'PRODUCT_NOT_FOUND');

  const price = product.price;
  const gsm = product.gsm;
  const filter = {
    status: 'published',
    _id: { $ne: product._id },
    category: product.category,
  };

  const and = [];
  if (price != null) {
    and.push({ price: { $gte: price * 0.7, $lte: price * 1.3 } });
  }
  if (gsm != null) {
    and.push({ gsm: { $gte: Math.max(0, gsm - 80), $lte: gsm + 80 } });
  }
  if (and.length) filter.$and = and;

  let similar = await Product.find(filter).sort({ updatedAt: -1 }).limit(limit);
  if (similar.length < 3) {
    similar = await Product.find({
      status: 'published',
      _id: { $ne: product._id },
      category: product.category,
    })
      .sort({ updatedAt: -1 })
      .limit(limit);
  }

  const catalog = await listMarketplaceProducts({ category: product.category });
  const idOrder = similar.map((p) => String(p._id));
  const byId = new Map(catalog.map((p) => [String(p._id), p]));

  const ordered = idOrder
    .map((id) => byId.get(id))
    .filter(Boolean)
    .slice(0, limit);

  if (ordered.length) return ordered.map(productCard);

  return catalog
    .filter((p) => String(p._id) !== String(productId))
    .slice(0, limit)
    .map(productCard);
};

export const productQa = async (productId, question) => {
  const q = String(question || '').trim();
  if (!q) throw createError('Question is required', 400, 'QUESTION_REQUIRED');

  const product = await getMarketplaceProductById(productId);
  const data = compactProduct(productCard(product));

  const answer = await chatText([
    {
      role: 'system',
      content: `${SYSTEM_SOURCING}
Answer ONLY from the product JSON. If the answer is not supported by the data, reply exactly with:
"This information isn't available in the product specifications."
Do not guess stretch, composition, certifications, or care unless stated.`,
    },
    {
      role: 'user',
      content: `Product: ${JSON.stringify(data)}
Buyer question: ${q}`,
    },
  ]);

  return {
    productId: String(product._id),
    question: q,
    answer,
    product: productCard(product),
  };
};

const detectIntent = async (message, history = []) => {
  const parsed = await chatJson([
    {
      role: 'system',
      content: `Classify the buyer message for a fabric marketplace assistant.
Return JSON:
{
  "intent": "search" | "recommend" | "compare" | "question" | "general",
  "query": string,
  "productIds": string[],
  "replyHint": string
}
- search: find fabrics by filters
- recommend: use-case based suggestions
- compare: comparing two products (include ids if present in history/message)
- question: asking about a specific product (include productId if known)
- general: greetings or sourcing advice without catalog lookup
Use only product ids that appear in the conversation context.`,
    },
    {
      role: 'user',
      content: `History: ${JSON.stringify(history.slice(-6))}
Message: ${message}`,
    },
  ]);

  return {
    intent: parsed.intent || 'search',
    query: String(parsed.query || message).trim(),
    productIds: Array.isArray(parsed.productIds)
      ? parsed.productIds.map(String).filter(Boolean)
      : [],
    replyHint: String(parsed.replyHint || ''),
  };
};

export const aiChat = async ({ message, history = [], productId = null, user = null }) => {
  const text = String(message || '').trim();
  if (!text) throw createError('Message is required', 400, 'MESSAGE_REQUIRED');

  const lower = text.toLowerCase();
  const looksLikeUseCase =
    lower.includes('for ') ||
    lower.includes('recommend') ||
    lower.includes('suggest') ||
    lower.includes('uniform') ||
    lower.includes('sofa') ||
    lower.includes('dress');

  const intentInfo = await detectIntent(text, history);
  let intent = intentInfo.intent;

  if (looksLikeUseCase && intent === 'search') intent = 'recommend';
  if (productId && (intent === 'question' || lower.includes('this fabric') || lower.includes('this product'))) {
    intent = 'question';
  }

  if (intent === 'compare' && intentInfo.productIds.length >= 2) {
    const result = await aiCompare(intentInfo.productIds[0], intentInfo.productIds[1]);
    return {
      intent: 'compare',
      reply: `${result.summary}\n\n${result.verdict}`.trim(),
      products: [result.productA, result.productB],
      comparison: result,
      filters: null,
    };
  }

  if (intent === 'question' && (productId || intentInfo.productIds[0])) {
    const id = productId || intentInfo.productIds[0];
    const qa = await productQa(id, text);
    return {
      intent: 'question',
      reply: qa.answer,
      products: [qa.product],
      filters: null,
    };
  }

  if (intent === 'recommend') {
    const result = await aiRecommend(intentInfo.query || text, { user });
    const reasons = result.recommendations
      .slice(0, 4)
      .map((row, index) => `${index + 1}. ${row.product.name}: ${row.reason}`)
      .join('\n');
    return {
      intent: 'recommend',
      reply: `${result.message}${reasons ? `\n\n${reasons}` : ''}`,
      products: result.products,
      recommendations: result.recommendations,
      filters: null,
    };
  }

  const prefsText = await loadBuyerPrefsText(user);

  if (intent === 'general') {
    const reply = await chatText([
      { role: 'system', content: SYSTEM_SOURCING },
      {
        role: 'user',
        content: `Conversation: ${JSON.stringify(history.slice(-6))}
Buyer: ${text}
${prefsText ? `Buyer preferences on file: ${prefsText}` : ''}
Respond as Fabrica's textile sourcing expert. Do not invent specific marketplace SKUs. Invite them to describe fabric needs (category, use case, budget).`,
      },
    ]);
    return { intent: 'general', reply, products: [], filters: null };
  }

  const result = await aiSearch(intentInfo.query || text, { user });
  return {
    intent: 'search',
    reply: result.summary,
    products: result.products,
    filters: result.filters,
  };
};
