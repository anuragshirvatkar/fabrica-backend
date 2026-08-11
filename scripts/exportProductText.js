import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import connectDB from '../src/config/db.js';
import Product from '../src/models/Product.js';
import Seller from '../src/models/Seller.js';
import User from '../src/models/User.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath =
  process.argv[2] ||
  path.join(__dirname, '..', 'product-catalog-text.txt');

const fmt = (value) => {
  if (value === null || value === undefined || value === '') return '(empty)';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '(empty)';
  return String(value);
};

const run = async () => {
  await connectDB();

  const products = await Product.find({})
    .sort({ status: -1, updatedAt: -1 })
    .lean();

  const sellerIds = [...new Set(products.map((p) => String(p.sellerId)).filter(Boolean))];
  const sellers = await Seller.find({ _id: { $in: sellerIds } }).lean();
  const sellerById = new Map(sellers.map((s) => [String(s._id), s]));

  const userIds = [...new Set(sellers.map((s) => String(s.userId)).filter(Boolean))];
  const users = await User.find({ _id: { $in: userIds } }).select('email role deletedAt').lean();
  const userById = new Map(users.map((u) => [String(u._id), u]));

  const lines = [];
  lines.push('FABRICA — PRODUCT TEXTUAL DATA EXPORT');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Total products: ${products.length}`);
  lines.push('');

  products.forEach((product, index) => {
    const seller = sellerById.get(String(product.sellerId));
    const user = seller ? userById.get(String(seller.userId)) : null;
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const colors = variants.map((v) => v.colorHex).filter(Boolean);
    const imageCount = variants.reduce((n, v) => n + (v.images?.length || 0), 0);

    lines.push('='.repeat(72));
    lines.push(`PRODUCT ${index + 1} of ${products.length}`);
    lines.push('='.repeat(72));
    lines.push(`_id: ${product._id}`);
    lines.push(`status: ${fmt(product.status)}`);
    lines.push(`step: ${fmt(product.step)}`);
    lines.push(`name: ${fmt(product.name)}`);
    lines.push(`category: ${fmt(product.category)}`);
    lines.push(`description: ${fmt(product.description)}`);
    lines.push(`price: ${fmt(product.price)}`);
    lines.push(`gsm: ${fmt(product.gsm)}`);
    lines.push(`width: ${fmt(product.width)}`);
    lines.push(`moq: ${fmt(product.moq)}`);
    lines.push(`availableQuantity: ${fmt(product.availableQuantity)}`);
    lines.push(`unit: ${fmt(product.unit)}`);
    lines.push(`variantColors: ${fmt(colors)}`);
    lines.push(`variantCount: ${variants.length}`);
    lines.push(`imageCount: ${imageCount}`);
    lines.push(`createdAt: ${fmt(product.createdAt)}`);
    lines.push(`updatedAt: ${fmt(product.updatedAt)}`);
    lines.push('');
    lines.push('--- Seller ---');
    if (seller) {
      lines.push(`sellerId: ${seller._id}`);
      lines.push(`companyName: ${fmt(seller.companyName)}`);
      lines.push(`phone: ${fmt(seller.phone)}`);
      lines.push(`gst: ${fmt(seller.gst)}`);
      lines.push(`description: ${fmt(seller.description)}`);
      lines.push(`operatingHours: ${fmt(seller.operatingHours)}`);
      lines.push(`productCategories: ${fmt(seller.productCategories)}`);
      lines.push(`fabricTypes: ${fmt(seller.fabricTypes)}`);
      lines.push(`moqRange: ${fmt(seller.moqRange)}`);
      lines.push(`verified: ${fmt(seller.verified)}`);
      const address = seller.address || {};
      lines.push(
        `address: ${[address.line1, address.city, address.state, address.pincode, address.country]
          .filter(Boolean)
          .join(', ') || '(empty)'}`,
      );
      lines.push(`sellerEmail: ${fmt(user?.email)}`);
    } else {
      lines.push('(no seller document found)');
    }
    lines.push('');
  });

  // Field coverage summary for gap analysis
  const keys = [
    'name',
    'category',
    'description',
    'price',
    'gsm',
    'width',
    'moq',
    'availableQuantity',
    'unit',
  ];
  lines.push('='.repeat(72));
  lines.push('FIELD COVERAGE SUMMARY');
  lines.push('='.repeat(72));
  for (const key of keys) {
    const filled = products.filter((p) => {
      const v = p[key];
      if (v === null || v === undefined) return false;
      if (typeof v === 'string') return v.trim().length > 0;
      return true;
    }).length;
    lines.push(`${key}: ${filled}/${products.length} filled`);
  }
  const withVariants = products.filter((p) => (p.variants || []).length > 0).length;
  const withColors = products.filter((p) =>
    (p.variants || []).some((v) => v.colorHex),
  ).length;
  const withImages = products.filter((p) =>
    (p.variants || []).some((v) => (v.images || []).length > 0),
  ).length;
  const published = products.filter((p) => p.status === 'published').length;
  lines.push(`variants: ${withVariants}/${products.length} have at least one`);
  lines.push(`colors: ${withColors}/${products.length} have colorHex`);
  lines.push(`images: ${withImages}/${products.length} have images`);
  lines.push(`published: ${published}/${products.length}`);
  lines.push('');

  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log(`Wrote ${products.length} products → ${outPath}`);
  process.exit(0);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
