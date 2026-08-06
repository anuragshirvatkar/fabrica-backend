import { PRODUCT_CATEGORIES } from './categories.js';

export const BUSINESS_TYPES = [
  'Manufacturer',
  'Wholesaler',
  'Retailer',
  'Designer / Studio',
  'Brand / Label',
  'Trading House',
  'Other',
];

export const INDUSTRIES = [
  'Apparel',
  'Home Textiles',
  'Fashion',
  'Uniforms',
  'Soft Furnishings',
  'Industrial',
  'Other',
];

export const INTEREST_OPTIONS = [
  'Everyday wear',
  'Premium / luxury',
  'Workwear / uniforms',
  'Home & interiors',
  'Seasonal collections',
  'Private label',
  'Export orders',
];

export const FABRIC_PREFERENCES = [...PRODUCT_CATEGORIES];

export const ORDER_QUANTITY_RANGES = [
  'Under 100 m',
  '100 – 500 m',
  '500 – 2,000 m',
  '2,000 m+',
];

export const BUDGET_RANGES = [
  'Under ₹50,000',
  '₹50,000 – ₹2 Lakh',
  '₹2 Lakh – ₹10 Lakh',
  '₹10 Lakh+',
];
