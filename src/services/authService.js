import User from '../models/User.js';
import Seller from '../models/Seller.js';

const mapAuthProvider = (signInProvider) => {
  if (signInProvider === 'google.com') return 'GOOGLE';
  return 'LOCAL';
};

const getSellerSetupCompleted = async (user) => {
  if (user.role === 'BUYER') return true;

  const seller = await Seller.findOne({ userId: user._id }).select('_id').lean();
  return Boolean(seller);
};

const formatUser = (user) => ({
  _id: user._id,
  email: user.email,
  role: user.role,
  firebaseUid: user.firebaseUid,
  authProvider: user.authProvider,
  isEmailVerified: user.isEmailVerified,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

export const syncUserFromFirebase = async ({ decodedToken, role }) => {
  const firebaseUid = decodedToken.uid;
  const email = decodedToken.email?.toLowerCase();
  const signInProvider = decodedToken.firebase?.sign_in_provider;
  const authProvider = mapAuthProvider(signInProvider);
  const isEmailVerified = Boolean(decodedToken.email_verified);

  if (!email) {
    const error = new Error('Email is required on the Firebase account');
    error.statusCode = 400;
    error.code = 'EMAIL_REQUIRED';
    throw error;
  }

  if (!isEmailVerified) {
    const error = new Error('Please verify your email first.');
    error.statusCode = 403;
    error.code = 'EMAIL_NOT_VERIFIED';
    throw error;
  }

  let user = await User.findOne({
    $or: [{ firebaseUid }, { email }],
  });

  if (user) {
    let shouldSave = false;

    if (!user.firebaseUid) {
      user.firebaseUid = firebaseUid;
      shouldSave = true;
    }

    if (!user.isEmailVerified) {
      user.isEmailVerified = true;
      shouldSave = true;
    }

    if (shouldSave) {
      await user.save();
    }

    return {
      user: formatUser(user),
      sellerSetupCompleted: await getSellerSetupCompleted(user),
    };
  }

  if (!role || !['BUYER', 'SELLER'].includes(role)) {
    const error = new Error('Role is required for new users. Choose BUYER or SELLER.');
    error.statusCode = 400;
    error.code = 'ROLE_REQUIRED';
    throw error;
  }

  user = await User.create({
    email,
    password: null,
    role,
    firebaseUid,
    authProvider,
    isEmailVerified: true,
  });

  return {
    user: formatUser(user),
    sellerSetupCompleted: await getSellerSetupCompleted(user),
  };
};

export const getAuthProfile = async (user) => ({
  user: formatUser(user),
  sellerSetupCompleted: await getSellerSetupCompleted(user),
});
