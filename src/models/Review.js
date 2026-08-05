import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema(
  {
    buyerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    review: {
      type: String,
      default: '',
      trim: true,
    },
  },
  { timestamps: true }
);

reviewSchema.index({ buyerId: 1, productId: 1 }, { unique: true });

const Review = mongoose.model('Review', reviewSchema);

export default Review;
