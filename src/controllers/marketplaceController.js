import asyncHandler from '../utils/asyncHandler.js';
import {
  getMarketplaceFacets,
  getMarketplaceProductById,
  listMarketplaceProducts,
  suggestMarketplace,
} from '../services/marketplaceService.js';
import { isFavorite } from '../services/favoriteService.js';

export const listProducts = asyncHandler(async (req, res) => {
  const products = await listMarketplaceProducts(
    {
      q: req.query.q,
      category: req.query.category,
      categories: req.query.categories,
      minPrice: req.query.minPrice,
      maxPrice: req.query.maxPrice,
      gsm: req.query.gsm,
      width: req.query.width,
      widths: req.query.widths,
      minWidth: req.query.minWidth,
      maxWidth: req.query.maxWidth,
      moqMax: req.query.moqMax,
      moqRanges: req.query.moqRanges,
    },
    req.user || null,
  );

  res.status(200).json({ success: true, products });
});

export const suggestProducts = asyncHandler(async (req, res) => {
  const result = await suggestMarketplace(req.query.q);
  res.status(200).json({ success: true, ...result });
});

export const getFacets = asyncHandler(async (req, res) => {
  const facets = await getMarketplaceFacets({
    q: req.query.q,
    category: req.query.category,
    categories: req.query.categories,
    minPrice: req.query.minPrice,
    maxPrice: req.query.maxPrice,
    gsm: req.query.gsm,
    width: req.query.width,
    widths: req.query.widths,
    minWidth: req.query.minWidth,
    maxWidth: req.query.maxWidth,
    moqMax: req.query.moqMax,
    moqRanges: req.query.moqRanges,
  });
  res.status(200).json({ success: true, facets });
});

export const getProduct = asyncHandler(async (req, res) => {
  const product = await getMarketplaceProductById(req.params.id);
  let favorited = false;

  if (req.user) {
    favorited = await isFavorite(req.user, product._id);
  }

  res.status(200).json({ success: true, product, favorited });
});
