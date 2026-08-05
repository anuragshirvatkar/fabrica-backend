import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      default: null,
    },
    role: {
      type: String,
      enum: ['BUYER', 'SELLER'],
      required: true,
    },
    firebaseUid: {
      type: String,
      default: null,
      unique: true,
      sparse: true,
    },
    authProvider: {
      type: String,
      enum: ['LOCAL', 'GOOGLE'],
      required: true,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    fcmTokens: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true }
);

const User = mongoose.model('User', userSchema);

export default User;
