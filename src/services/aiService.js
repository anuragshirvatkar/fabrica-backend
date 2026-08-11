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
import { addToCart } from './cartService.js';
import { addFavorite } from './favoriteService.js';
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
  // Keep Specs: line intact for product Q&A (was truncating at 280).
  description: (product.description || '').slice(0, 1200),
  price: product.price,
  gsm: product.gsm,
  width: product.width,
  moq: product.moq,
  unit: product.unit || 'meter',
  colors: product.colors || [],
  inStock: (product.availableQuantity ?? 0) > 0,
});

/** Use-case profiles: prefer / exclude categories so "suit" never ranks denim. */
const USE_CASE_PROFILES = [
  {
    id: 'suit',
    terms: [
      'suit',
      'suits',
      'suite',
      'suites',
      'blazer',
      'trouser',
      'trousers',
      'formal wear',
      'formals',
      'office wear',
      'suiting',
    ],
    preferCategories: ['Cotton', 'Linen', 'Synthetic', 'Silk'],
    excludeCategories: ['Denim'],
    preferKeywords: [
      'twill',
      'poplin',
      'suiting',
      'formal',
      'polyester',
      'polycot',
      'crepe',
      'satin',
      'shirt',
      'uniform',
      'wool',
      'blend',
    ],
    excludeKeywords: ['denim', 'jeans', 'sportswear', 'activewear', 'active flex', 'oz'],
  },
  {
    id: 'tshirt',
    terms: [
      't-shirt',
      't-shirts',
      'tshirt',
      'tshirts',
      'tee shirt',
      'tee shirts',
      'tees',
    ],
    preferCategories: ['Cotton', 'Synthetic'],
    excludeCategories: ['Denim', 'Silk'],
    preferKeywords: [
      'jersey',
      'knit',
      'single jersey',
      'interlock',
      'soft',
      'cotton',
      'breathable',
      'flex',
      'sportswear',
      'active',
    ],
    excludeKeywords: ['denim', 'jeans', 'upholstery', 'bridal', 'suiting', 'formal'],
  },
  {
    id: 'shirt',
    terms: ['shirt', 'shirts', 'kurta', 'kurtas', 'uniform', 'uniforms'],
    preferCategories: ['Cotton', 'Linen', 'Synthetic'],
    excludeCategories: ['Denim'],
    preferKeywords: ['poplin', 'shirt', 'twill', 'cotton', 'linen', 'polycot', 'breathable'],
    excludeKeywords: ['denim', 'jeans', 'upholstery'],
  },
  {
    id: 'dress',
    terms: ['dress', 'dresses', 'gown', 'gowns', 'summer dress'],
    preferCategories: ['Cotton', 'Linen', 'Silk', 'Synthetic'],
    excludeCategories: ['Denim'],
    preferKeywords: ['dress', 'drape', 'linen', 'silk', 'crepe', 'satin', 'poplin'],
    excludeKeywords: ['denim', 'jeans', 'workwear denim'],
  },
  {
    id: 'denim',
    terms: ['jeans', 'denim', 'jean jacket', 'denim jacket'],
    preferCategories: ['Denim'],
    excludeCategories: [],
    preferKeywords: ['denim', 'jeans', 'indigo', 'stretch denim'],
    excludeKeywords: [],
  },
  {
    id: 'saree',
    terms: ['saree', 'sari', 'bridal', 'festive'],
    preferCategories: ['Silk'],
    excludeCategories: ['Denim'],
    preferKeywords: ['silk', 'mulberry', 'crepe', 'bridal', 'festive'],
    excludeKeywords: ['denim', 'jeans'],
  },
  {
    id: 'sofa',
    terms: ['sofa', 'upholstery', 'curtain', 'curtains', 'home furnishing', 'furnishing'],
    preferCategories: ['Cotton', 'Linen', 'Synthetic'],
    excludeCategories: ['Denim', 'Silk'],
    preferKeywords: ['upholstery', 'home', 'curtain', 'durable'],
    excludeKeywords: ['denim', 'jeans', 'bridal'],
  },
];

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const matchUseCaseProfile = (text) => {
  const use = String(text || '').toLowerCase();
  if (!use.trim()) return null;

  // Prefer longer terms first so "t-shirt" wins over bare "shirt".
  const ranked = [...USE_CASE_PROFILES].sort((a, b) => {
    const maxA = Math.max(...a.terms.map((term) => term.length));
    const maxB = Math.max(...b.terms.map((term) => term.length));
    return maxB - maxA;
  });

  return (
    ranked.find((profile) =>
      profile.terms.some((term) => {
        const pattern = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(term)}(?:$|[^a-z0-9])`, 'i');
        return pattern.test(use);
      }),
    ) || null
  );
};

/** Map common garment / slang terms to marketplace fabric categories. */
const TERM_TO_CATEGORY = {
  jeans: 'Denim',
  jean: 'Denim',
  denim: 'Denim',
  // Do NOT map jacket → Denim (suit jackets are not denim).
  shirts: 'Cotton',
  shirt: 'Cotton',
  saree: 'Silk',
  sari: 'Silk',
  linen: 'Linen',
  cotton: 'Cotton',
  silk: 'Silk',
  synthetic: 'Synthetic',
  polyester: 'Synthetic',
  polycot: 'Synthetic',
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
Map garment/use synonyms carefully:
- jeans → category Denim, but keep keyword/useCase as "jeans" (do not rewrite the word jeans to denim)
- denim / denim jacket → Denim; keep the word denim if they said denim
- shirt / shirts → Cotton (unless another fabric is named)
- saree / sari → Silk (unless another fabric is named)
- suit / suits / suite / blazer / formal trousers → do NOT use Denim; leave category null (or Cotton/Synthetic/Linen if clearly named). Suits need suiting, twill, poplin, polycot, linen, or silk — never denim.
Put the buyer's original words in useCase and keywords — never replace jeans with denim in those fields.
Only extract what is clearly stated or strongly implied. Do not invent prices or GSM.`,
    },
    { role: 'user', content: text },
  ]);

  const normalized = normalizeParsed(parsed);
  const profile = matchUseCaseProfile(text) || matchUseCaseProfile(normalized.useCase || '');

  // Never let the model force Denim for suit/formal use cases.
  if (
    profile?.excludeCategories?.includes('Denim') &&
    normalized.category === 'Denim'
  ) {
    normalized.category = null;
  }

  if (!normalized.category && !profile) {
    normalized.category = inferCategoryFromText(text);
  }
  if (!normalized.useCase) {
    normalized.useCase = text;
  } else {
    normalized.useCase = preserveJeansDenimWording(text, normalized.useCase);
  }
  if (normalized.keywords?.length) {
    normalized.keywords = normalized.keywords.map((k) =>
      preserveJeansDenimWording(text, k),
    );
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
    const profile =
      matchUseCaseProfile(parsed.useCase) || matchUseCaseProfile(parsed.keywords?.join(' ') || '');

    if (profile) {
      const withoutExcluded = result.filter((product) => {
        const category = String(product.category || '');
        const blob = `${product.name} ${product.description} ${category}`.toLowerCase();
        if (profile.excludeCategories.includes(category)) return false;
        if (profile.excludeKeywords.some((word) => blob.includes(word))) return false;
        return true;
      });
      if (withoutExcluded.length) result = withoutExcluded;

      const ranked = result.map((product) => {
        const category = String(product.category || '');
        const blob = `${product.name} ${product.description} ${category}`.toLowerCase();
        let score = 0;
        if (profile.preferCategories.includes(category)) score += 3;
        score += profile.preferKeywords.reduce(
          (sum, word) => (blob.includes(word) ? sum + 2 : sum),
          0,
        );
        return { product, score };
      });
      ranked.sort((a, b) => b.score - a.score);
      if (ranked.some((row) => row.score > 0)) {
        result = ranked.filter((row) => row.score > 0).map((row) => row.product);
      } else {
        result = ranked.map((row) => row.product);
      }
    } else {
      const use = parsed.useCase.toLowerCase();
      const ranked = result.map((product) => {
        const blob = `${product.name} ${product.description}`.toLowerCase();
        const score = use
          .split(/\s+/)
          .filter((word) => word.length > 3)
          .reduce((sum, word) => (blob.includes(word) ? sum + 1 : sum), 0);
        return { product, score };
      });
      ranked.sort((a, b) => b.score - a.score);
      if (ranked.some((row) => row.score > 0)) {
        result = ranked.filter((row) => row.score > 0).map((row) => row.product);
      }
    }
  }

  return result;
};

const searchCatalog = async (query, parsed, user = null) => {
  const profile =
    matchUseCaseProfile(query) ||
    matchUseCaseProfile(parsed.useCase || '') ||
    matchUseCaseProfile((parsed.keywords || []).join(' '));

  let category = parsed.category || null;
  // For multi-category use cases (suits), search the full catalog then rank — don't lock to Denim.
  if (!category && !profile) {
    category =
      inferCategoryFromText(query) ||
      inferCategoryFromText((parsed.keywords || []).join(' ')) ||
      inferCategoryFromText(parsed.useCase || '');
  }
  if (profile?.excludeCategories?.includes(category)) {
    category = null;
  }

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
      // Keep buyer text (e.g. jeans) even when a use-case profile matched —
      // synonyms still expand jeans↔denim in Mongo; do not drop the query.
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
    products = await listMarketplaceProducts({ q: query, ...priceParams });
  }

  const enriched = {
    ...parsed,
    category: category || parsed.category,
    useCase: parsed.useCase || query,
  };

  let matched = filterByColorAndKeywords(products, enriched);

  if (user?.role === 'BUYER' && user?._id && matched.length) {
    // Keep use-case exclusions; only re-order within the allowed set.
    const allowedIds = new Set(matched.map((p) => String(p._id)));
    const personalized = await personalizeForBuyer(user._id, matched);
    const kept = personalized.filter((p) => allowedIds.has(String(p._id)));
    if (kept.length) matched = kept;
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
Write 2-3 short sentences summarizing what you found. Mention only these products. If few matches, say so.
Keep the buyer's wording — if they said jeans, say jeans (do not rewrite to denim).`,
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
Give a short reason for each product based only on provided fields. Do not invent specs.
If the buyer asked for suits/formals, only recommend fabrics suitable for suiting (twill, poplin, polycot, linen, silk, polyester) — never denim/jeans.`,
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

const MONGO_ID_RE = /^[a-f0-9]{24}$/i;

const extractCatalogIdsFromHistory = (history = []) => {
  const ids = [];
  for (const item of [...history].reverse()) {
    const content = String(item?.content || '');
    const match = content.match(/\[catalog:([^\]]+)\]/i);
    if (!match) continue;
    for (const part of match[1].split(';')) {
      const id = part.trim().split('|')[0]?.trim();
      if (id && MONGO_ID_RE.test(id) && !ids.includes(id)) ids.push(id);
    }
    if (ids.length) break;
  }
  return ids;
};

const loadProductsByIds = async (productIds = []) => {
  const products = [];
  for (const id of productIds.slice(0, 8)) {
    if (!MONGO_ID_RE.test(String(id))) continue;
    try {
      const product = await getMarketplaceProductById(id);
      products.push(productCard(product));
    } catch {
      // skip invalid / unpublished ids
    }
  }
  return products;
};

const productsAboutOptions = async (productIds, question) => {
  const products = await loadProductsByIds(productIds);
  if (!products.length) {
    throw createError('Product not found', 404, 'PRODUCT_NOT_FOUND');
  }

  const answer = await chatText([
    {
      role: 'system',
      content: `${SYSTEM_SOURCING}
The buyer is asking about fabrics already shown from the live catalog.
Answer ONLY using the product JSON below. Rank or shortlist when asked which is best for a use case.
If a detail is missing, say it is not in the catalog specs — do not invent.`,
    },
    {
      role: 'user',
      content: `Catalog options: ${JSON.stringify(products.map(compactProduct))}
Buyer question: ${question}`,
    },
  ]);

  return { answer, products };
};

const NAVIGATE_TARGETS = {
  profile: {
    navigateTo: 'profile',
    reply: 'Opening your profile on Fabrica.',
    exact: ['profile', 'my profile', 'the profile'],
    aliases: [
      'profile',
      'my profile',
      'the profile',
      'profile section',
      'profile page',
    ],
  },
  marketplace: {
    navigateTo: 'marketplace',
    reply: 'Opening the marketplace on Fabrica.',
    exact: ['marketplace', 'the marketplace', 'market place', 'store', 'the store'],
    aliases: [
      'marketplace',
      'the marketplace',
      'marketplace section',
      'marketplace page',
      'market place',
      'the market place',
      'store',
      'the store',
      'shop',
      'the shop',
    ],
  },
  cart: {
    navigateTo: 'cart',
    reply: 'Opening your cart on Fabrica.',
    exact: ['cart', 'my cart', 'the cart', 'shopping cart'],
    aliases: ['cart', 'my cart', 'the cart', 'shopping cart', 'cart section', 'cart page'],
  },
  orders: {
    navigateTo: 'orders',
    reply: 'Opening your orders on Fabrica.',
    exact: ['orders', 'my orders', 'the orders', 'order'],
    aliases: [
      'orders',
      'my orders',
      'the orders',
      'order',
      'order section',
      'orders section',
      'orders page',
      'order history',
    ],
  },
  favorites: {
    navigateTo: 'favorites',
    reply: 'Opening your favorites on Fabrica.',
    exact: [
      'favorites',
      'favourites',
      'the favorites',
      'the favourites',
      'my favorites',
      'my favourites',
      'wishlist',
    ],
    aliases: [
      'favorites',
      'favourites',
      'my favorites',
      'my favourites',
      'the favorites',
      'the favourites',
      'wishlist',
      'saved items',
      'favorites section',
      'favourites section',
    ],
  },
  addresses: {
    navigateTo: 'addresses',
    reply: 'Opening your address section on Fabrica.',
    exact: [
      'address',
      'addresses',
      'my address',
      'my addresses',
      'address section',
      'the address section',
    ],
    aliases: [
      'address',
      'addresses',
      'my address',
      'my addresses',
      'the address',
      'the addresses',
      'address section',
      'addresses section',
      'address page',
      'addresses page',
    ],
  },
};

const normalizeNavigateText = (message = '') => {
  let t = String(message || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return '';

  if (!/\baddress/.test(t)) {
    t = t.replace(/\bcard\b/g, 'cart').replace(/\bkart\b/g, 'cart');
  }

  return t
    .replace(/\bfavourites\b/g, 'favorites')
    .replace(/\bfavourite\b/g, 'favorite')
    .replace(/\bmarket place\b/g, 'marketplace')
    .replace(/\bwish list\b/g, 'wishlist');
};

const AUTH_REFUSAL_REPLY =
  "I can't do that. For your security I can't log you in, log you out, or use account credentials. Please use the account menu in the top right for login, logout, or account access.";

const detectAuthRefusal = (message = '') => {
  const t = normalizeNavigateText(message);
  if (!t) return null;

  const refused =
    /\b(log\s*out|logout|sign\s*out|signout)\b/.test(t) ||
    /\b(log\s*in|login|sign\s*in|signin)\b/.test(t) ||
    /\b(password|credentials?|otp|one time password)\b/.test(t) ||
    /\b(my email|my password|here are my (creds|credentials|details))\b/.test(t) ||
    /^(open|go to|show|take me to|navigate to|view)\s+(the\s+)?(my\s+)?account(\s+section|\s+page)?$/.test(
      t,
    ) ||
    t === 'account' ||
    t === 'my account' ||
    t === 'the account' ||
    t === 'open my account' ||
    t === 'delete my account' ||
    t === 'close my account';

  return refused ? AUTH_REFUSAL_REPLY : null;
};

const detectLocalNavigate = (message = '') => {
  const t = normalizeNavigateText(message);
  if (!t) return null;

  for (const rule of Object.values(NAVIGATE_TARGETS)) {
    if (rule.exact.includes(t)) {
      return { navigateTo: rule.navigateTo, reply: rule.reply };
    }
  }

  const openMatch = t.match(
    /^(please\s+|can you\s+)?(open|go to|show|take me to|navigate to|view)\s+(.+)$/,
  );
  if (!openMatch) return null;
  const rest = String(openMatch[3] || '').trim();
  if (!rest) return null;

  for (const rule of Object.values(NAVIGATE_TARGETS)) {
    if (rule.aliases.includes(rest)) {
      return { navigateTo: rule.navigateTo, reply: rule.reply };
    }
  }

  return null;
};

const NAVIGATE_TO_VALUES = new Set(Object.keys(NAVIGATE_TARGETS));

const detectIntent = async (message, history = []) => {
  const parsed = await chatJson([
    {
      role: 'system',
      content: `Classify the buyer message for a fabric marketplace assistant.
Return JSON:
{
  "intent": "search" | "recommend" | "compare" | "question" | "options" | "navigate" | "general",
  "query": string,
  "productIds": string[],
  "navigateTo": "profile" | "marketplace" | "cart" | "orders" | "favorites" | "addresses" | null,
  "replyHint": string
}
- search: find fabrics by filters
- recommend: use-case based suggestions from the full catalog
- compare: comparing two products (include ids if present in history/message)
- question: asking about ONE specific product (include that productId if known)
- options: asking which among previously listed products is best / suitable (include those productIds from [catalog:...] in history)
- navigate: ONLY when the buyer wants to open a buyer account section: profile, marketplace, cart, orders, favorites/wishlist, or addresses (set navigateTo). Do not use navigate for adding items or editing data.
- general: greetings or sourcing advice without catalog lookup
Use only product ids that appear in the conversation context (especially [catalog:id|name|category; ...]).
Keep the buyer's wording in "query" — never rewrite jeans to denim or denim to jeans.`,
    },
    {
      role: 'user',
      content: `History: ${JSON.stringify(history.slice(-6))}
Message: ${message}`,
    },
  ]);

  const navigateTo = NAVIGATE_TO_VALUES.has(parsed.navigateTo) ? parsed.navigateTo : null;

  return {
    intent: parsed.intent || 'search',
    query: preserveJeansDenimWording(message, String(parsed.query || message).trim()),
    productIds: Array.isArray(parsed.productIds)
      ? parsed.productIds.map(String).filter(Boolean)
      : [],
    navigateTo,
    replyHint: String(parsed.replyHint || ''),
  };
};

const normalizeProductKey = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const scoreProductName = (query, name) => {
  const q = normalizeProductKey(query);
  const n = normalizeProductKey(name);
  if (!q || !n) return 0;
  if (n === q) return 120;
  if (n.includes(q) || q.includes(n)) return 100;
  const qTokens = q.split(' ').filter((token) => token.length > 1);
  if (!qTokens.length) return 0;
  const hits = qTokens.filter((token) => n.includes(token)).length;
  return (hits / qTokens.length) * 90;
};

const extractCatalogEntriesFromHistory = (history = []) => {
  const entries = [];
  for (const item of [...history].reverse()) {
    const content = String(item?.content || '');
    const match = content.match(/\[catalog:([^\]]+)\]/i);
    if (!match) continue;
    for (const part of match[1].split(';')) {
      const [id, name, category] = part.trim().split('|');
      if (id && MONGO_ID_RE.test(id)) {
        entries.push({
          _id: id,
          name: name || '',
          category: category || '',
        });
      }
    }
    if (entries.length) break;
  }
  return entries;
};

const cleanActionQuery = (raw = '') => {
  let query = String(raw || '').trim();
  query = query.replace(/^(the|a|an)\s+/i, '').trim();
  if (/^(this|it|that)(\s+one)?$/i.test(query)) return '';
  return query;
};

const detectCartOrFavoriteAction = (message = '') => {
  const raw = String(message || '')
    .normalize('NFKC')
    .replace(/[“”"']/g, '')
    .trim();
  const t = raw.replace(/[.!?]+$/g, '').replace(/\s+/g, ' ').trim();
  if (!t) return null;

  const lower = t.toLowerCase();
  const wantsCart = /\b(add|put)\b/i.test(lower) && /\bcart\b/i.test(lower);
  const wantsFavorite =
    /\b(add|put|save)\b/i.test(lower) && /\b(favorites|favourites|wishlist)\b/i.test(lower);

  if (wantsCart && !wantsFavorite) {
    let query = lower
      .replace(/^(please|can you)\s+/, '')
      .replace(/^(add|put)\s+/, '')
      .replace(/\s+(to|in|into)\s+(my\s+)?(the\s+)?cart$/, '')
      .trim();
    if (/^(to|in|into)\s+(my\s+)?(the\s+)?cart\s+/.test(query)) {
      query = query.replace(/^(to|in|into)\s+(my\s+)?(the\s+)?cart\s+/, '').trim();
    }
    return { action: 'cart', query: cleanActionQuery(query) };
  }

  if (wantsFavorite) {
    let query = lower
      .replace(/^(please|can you)\s+/, '')
      .replace(/^(add|put|save)\s+/, '')
      .replace(/\s+(to|in|into)\s+(my\s+)?(favorites|favourites|wishlist)$/, '')
      .trim();
    if (/^(to|in|into)\s+(my\s+)?(favorites|favourites|wishlist)\s+/.test(query)) {
      query = query
        .replace(/^(to|in|into)\s+(my\s+)?(favorites|favourites|wishlist)\s+/, '')
        .trim();
    }
    return { action: 'favorites', query: cleanActionQuery(query) };
  }

  return null;
};

/** Prefer buyer's jeans/denim word over model rewrites. */
const preserveJeansDenimWording = (original, rewritten) => {
  const source = String(original || '');
  let next = String(rewritten ?? '');
  if (!next) return next;
  if (/\bjeans\b/i.test(source) && /\bdenim\b/i.test(next) && !/\bjeans\b/i.test(next)) {
    next = next.replace(/\bdenim\b/gi, 'jeans');
  }
  if (/\bdenim\b/i.test(source) && /\bjeans\b/i.test(next) && !/\bdenim\b/i.test(next)) {
    next = next.replace(/\bjeans\b/gi, 'denim');
  }
  return next;
};

const looksLikeFabricSearch = (message = '') => {
  const t = String(message || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return false;
  // Catalog browse — never treat as “open this SKU”.
  if (
    /^(please\s+|can you\s+)?(show\s+me|find(\s+me)?|search(\s+for)?|look(\s+for)?|browse|recommend|suggest|i\s+(need|want))\b/.test(
      t,
    )
  ) {
    if (/\b(details?|product page)\b/.test(t)) return false;
    return true;
  }
  if (/\b(show me|find me|looking for)\b/.test(t)) {
    if (/\b(details?|product page)\b/.test(t)) return false;
    return true;
  }
  if (/\b(fabrics?\s+for|fabric\s+for)\b/.test(t)) return true;
  if (/\b(fabrics?|for|under|below|above|budget|gsm|meter|metres?)\b/.test(t)) {
    if (/\b(details?|product page)\b/.test(t)) return false;
    if (/^(please\s+|can you\s+)?open\b/.test(t)) return false;
    // Bare "show X" without "me" still searches when fabric/for/budget cues exist.
    return true;
  }
  return false;
};

const detectOpenProductAction = (message = '') => {
  if (detectLocalNavigate(message) || detectCartOrFavoriteAction(message)) return null;
  if (looksLikeFabricSearch(message)) return null;
  const t = String(message || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return null;
  // Never open from show-me / find browse phrasing.
  if (/^(please\s+|can you\s+)?(show\s+me|find(\s+me)?|search)\b/.test(t)) return null;

  const patterns = [
    /^(please\s+|can you\s+)?(open|view)\s+(the\s+)?(product\s+)?details?\s+(for|of)\s+(.+)$/,
    /^(please\s+|can you\s+)?(open|view)\s+(.+?)\s+(product\s+)?details?$/,
    /^(please\s+|can you\s+)?(open|view)\s+(the\s+)?product\s+(page\s+(for\s+)?)?(.+)$/,
    /^(please\s+|can you\s+)?(open|view)\s+(the\s+)?(.+?)\s+product\s+page$/,
    /^(please\s+|can you\s+)?(open|view)\s+(the\s+)?(.+)$/,
  ];

  const blocked = new Set([
    'cart',
    'marketplace',
    'orders',
    'favorites',
    'favourites',
    'profile',
    'address',
    'addresses',
    'wishlist',
    'store',
    'shop',
    'account',
    'home',
    'faq',
  ]);

  for (const re of patterns) {
    const match = t.match(re);
    if (!match) continue;
    const query = cleanActionQuery(match[match.length - 1] || '');
    if (!query) continue;
    if (blocked.has(query)) continue;
    if (
      /^(my|the)\s+(cart|marketplace|orders|favorites|favourites|profile|address|addresses|wishlist|store|shop|account)$/.test(
        query,
      )
    ) {
      continue;
    }
    return { query };
  }
  return null;
};

const resolveProductForAction = async ({
  query,
  productId = null,
  history = [],
  hintIds = [],
}) => {
  const candidates = [];

  if (productId && MONGO_ID_RE.test(String(productId))) {
    try {
      candidates.push(productCard(await getMarketplaceProductById(productId)));
    } catch {
      // ignore
    }
  }

  for (const id of hintIds) {
    if (!MONGO_ID_RE.test(String(id))) continue;
    try {
      candidates.push(productCard(await getMarketplaceProductById(id)));
    } catch {
      // ignore
    }
  }

  for (const entry of extractCatalogEntriesFromHistory(history)) {
    candidates.push(entry);
  }

  const q = String(query || '').trim();
  if (q) {
    const searched = await listMarketplaceProducts({ q });
    for (const product of searched.slice(0, 12)) {
      candidates.push(productCard(product));
    }
  }

  const unique = [];
  const seen = new Set();
  for (const product of candidates) {
    const id = String(product._id || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(product);
  }

  if (!unique.length) return null;
  if (!q) return unique[0];

  const ranked = unique
    .map((product) => ({
      product,
      score: scoreProductName(q, product.name || ''),
    }))
    .sort((a, b) => b.score - a.score);

  if (!ranked[0] || ranked[0].score < 45) return null;
  return ranked[0].product;
};

const handleCartOrFavoriteAction = async ({
  action,
  query,
  user,
  productId = null,
  history = [],
  hintIds = [],
}) => {
  if (!user || user.role !== 'BUYER') {
    return {
      intent: action === 'cart' ? 'cart_add' : 'favorite_add',
      reply: 'Please sign in as a buyer to do that.',
      products: [],
      filters: null,
      navigateTo: null,
    };
  }

  const product = await resolveProductForAction({
    query,
    productId,
    history,
    hintIds,
  });

  if (!product?._id) {
    return {
      intent: action === 'cart' ? 'cart_add' : 'favorite_add',
      reply:
        'I couldn’t find that fabric in the live catalog. Open it from marketplace, or say the exact product name.',
      products: [],
      filters: null,
      navigateTo: null,
    };
  }

  try {
    if (action === 'cart') {
      const full = await getMarketplaceProductById(product._id);
      const moq = full.moq || 1;
      const firstVariantId = full.variants?.[0]?._id
        ? String(full.variants[0]._id)
        : undefined;
      await addToCart(user, {
        productId: product._id,
        variantId: firstVariantId,
        quantity: moq,
      });
      const card = productCard(full);
      return {
        intent: 'cart_add',
        reply: `Added ${card.name} to your cart${moq > 1 ? ` (${moq} ${card.unit || 'meters'} MOQ)` : ''}. Say “open cart” to view it.`,
        products: [card],
        filters: null,
        navigateTo: null,
        cartUpdated: true,
      };
    }

    await addFavorite(user, product._id);
    const full = await getMarketplaceProductById(product._id);
    const card = productCard(full);
    return {
      intent: 'favorite_add',
      reply: `Saved ${card.name} to your favorites.`,
      products: [card],
      filters: null,
      navigateTo: null,
    };
  } catch (err) {
    return {
      intent: action === 'cart' ? 'cart_add' : 'favorite_add',
      reply: err?.message || 'I couldn’t complete that right now. Please try from the product page.',
      products: [product],
      filters: null,
      navigateTo: null,
    };
  }
};

export const aiChat = async ({ message, history = [], productId = null, user = null }) => {
  const text = String(message || '').trim();
  if (!text) throw createError('Message is required', 400, 'MESSAGE_REQUIRED');

  const authRefusal = detectAuthRefusal(text);
  if (authRefusal) {
    return {
      intent: 'refuse',
      reply: authRefusal,
      navigateTo: null,
      products: [],
      filters: null,
    };
  }

  const localNav = detectLocalNavigate(text);
  if (localNav) {
    return {
      intent: 'navigate',
      reply: localNav.reply,
      navigateTo: localNav.navigateTo,
      products: [],
      filters: null,
    };
  }

  const cartFavoriteAction = detectCartOrFavoriteAction(text);
  if (cartFavoriteAction) {
    return handleCartOrFavoriteAction({
      action: cartFavoriteAction.action,
      query: cartFavoriteAction.query,
      user,
      productId,
      history,
    });
  }

  const openProductAction = detectOpenProductAction(text);
  if (openProductAction) {
    const product = await resolveProductForAction({
      query: openProductAction.query,
      productId,
      history,
    });
    if (!product?._id) {
      return {
        intent: 'product_open',
        reply:
          'I couldn’t find that product. Try the exact name, or browse the marketplace.',
        products: [],
        filters: null,
        navigateTo: null,
        openProductId: null,
      };
    }
    return {
      intent: 'product_open',
      reply: `Opening ${product.name}.`,
      products: [product],
      filters: null,
      navigateTo: null,
      openProductId: String(product._id),
    };
  }

  const lower = text.toLowerCase();
  const looksLikeUseCase =
    lower.includes('for ') ||
    lower.includes('recommend') ||
    lower.includes('suggest') ||
    lower.includes('uniform') ||
    lower.includes('sofa') ||
    lower.includes('dress');
  const looksLikeOptionsFollowUp =
    /\b(among|amongst|these options|those options|the options|which (one|fabric|fabrics)|best (for|among|amongst)|from (these|those|the list))\b/i.test(
      text,
    );

  const catalogIds = extractCatalogIdsFromHistory(history);
  const intentInfo = await detectIntent(text, history);
  let intent = intentInfo.intent;

  if (intent === 'navigate' && NAVIGATE_TO_VALUES.has(intentInfo.navigateTo)) {
    const rule = NAVIGATE_TARGETS[intentInfo.navigateTo];
    return {
      intent: 'navigate',
      reply: rule.reply,
      navigateTo: intentInfo.navigateTo,
      products: [],
      filters: null,
    };
  }
  const optionIds = [
    ...new Set(
      [...(intentInfo.productIds || []), ...catalogIds].filter((id) => MONGO_ID_RE.test(String(id))),
    ),
  ];

  if (looksLikeUseCase && intent === 'search') intent = 'recommend';
  if (looksLikeOptionsFollowUp && optionIds.length >= 2) intent = 'options';
  if (intent === 'options' && optionIds.length < 2 && catalogIds.length >= 2) {
    optionIds.push(...catalogIds.filter((id) => !optionIds.includes(id)));
  }
  if (productId && (intent === 'question' || lower.includes('this fabric') || lower.includes('this product'))) {
    intent = 'question';
  }

  if (intent === 'options' && optionIds.length >= 2) {
    const result = await productsAboutOptions(optionIds, text);
    return {
      intent: 'options',
      reply: result.answer,
      products: result.products,
      filters: null,
    };
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
    try {
      const qa = await productQa(id, text);
      return {
        intent: 'question',
        reply: qa.answer,
        products: [qa.product],
        filters: null,
      };
    } catch (err) {
      if (optionIds.length >= 2) {
        const result = await productsAboutOptions(optionIds, text);
        return {
          intent: 'options',
          reply: result.answer,
          products: result.products,
          filters: null,
        };
      }
      throw err;
    }
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
