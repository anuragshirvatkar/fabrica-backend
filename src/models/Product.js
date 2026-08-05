import mongoose from 'mongoose';

const variantSchema = new mongoose.Schema(
  {
    colorHex: {
      type: String,
      default: '',
      trim: true,
    },
    images: {
      type: [String],
      default: [],
    },
  },
  { _id: true }
);

const productSchema = new mongoose.Schema(
  {
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Seller',
      required: true,
      index: true,
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      default: null,
    },
    category: {
      type: String,
      default: '',
      trim: true,
    },
    name: {
      type: String,
      default: '',
      trim: true,
    },
    description: {
      type: String,
      default: '',
    },
    price: {
      type: Number,
      default: null,
      min: 0,
    },
    gsm: {
      type: Number,
      default: null,
      min: 0,
    },
    width: {
      type: Number,
      default: null,
      min: 0,
    },
    moq: {
      type: Number,
      default: null,
      min: 1,
    },
    availableQuantity: {
      type: Number,
      default: null,
      min: 0,
    },
    unit: {
      type: String,
      default: 'meter',
      trim: true,
    },
    variants: {
      type: [variantSchema],
      default: [],
    },
    status: {
      type: String,
      enum: ['draft', 'published'],
      default: 'draft',
      index: true,
    },
    step: {
      type: Number,
      enum: [1, 2, 3],
      default: 1,
    },
  },
  { timestamps: true }
);

productSchema.index({ sellerId: 1, status: 1, updatedAt: -1 });

const Product = mongoose.model('Product', productSchema);

export default Product;
