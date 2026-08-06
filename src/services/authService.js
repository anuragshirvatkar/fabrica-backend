import admin from '../config/firebase.js';
import User from '../models/User.js';
import Seller, { isSellerProfileComplete } from '../models/Seller.js';
import Buyer from '../models/Buyer.js';

const mapAuthProvider = (signInProvider) => {
  if (signInProvider === 'google.com') return 'GOOGLE';
  return 'LOCAL';
};

const getSellerSetupCompleted = async (user) => {
  if (user.role === 'BUYER') return true;

  const seller = await Seller.findOne({ userId: user._id }).lean();
  return isSellerProfileComplete(seller);
};

const getBuyerSetupCompleted = async (user) => {
  if (user.role === 'SELLER') return true;

  const buyer = await Buyer.findOne({ userId: user._id }).select('_id').lean();
  return Boolean(buyer);
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

const withSetupFlags = async (user) => ({
  user: formatUser(user),
  sellerSetupCompleted: await getSellerSetupCompleted(user),
  buyerSetupCompleted: await getBuyerSetupCompleted(user),
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

  // Prefer active account by Firebase UID, then by email (never revive soft-deleted rows).
  let user =
    (await User.findOne({ firebaseUid, deletedAt: null })) ||
    (await User.findOne({ email, deletedAt: null }));

  const deletedMatch = !user
    ? await User.findOne({
        deletedAt: { $ne: null },
        $or: [{ firebaseUid }, { email }],
      })
    : null;

  if (deletedMatch) {
    const error = new Error(
      'This account has been deleted. Sign up again with a different email, or contact support.',
    );
    error.statusCode = 403;
    error.code = 'ACCOUNT_DELETED';
    throw error;
  }

  if (user) {
    let shouldSave = false;

    // Firebase user was recreated for the same email — re-link UID.
    if (user.firebaseUid !== firebaseUid) {
      user.firebaseUid = firebaseUid;
      shouldSave = true;
    }

    if (!user.isEmailVerified) {
      user.isEmailVerified = true;
      shouldSave = true;
    }

    if (user.authProvider !== authProvider) {
      user.authProvider = authProvider;
      shouldSave = true;
    }

    if (shouldSave) {
      await user.save();
    }

    return withSetupFlags(user);
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

  return withSetupFlags(user);
};

export const getAuthProfile = async (user) => {
  if (user.deletedAt) {
    const error = new Error('This account has been deleted.');
    error.statusCode = 403;
    error.code = 'ACCOUNT_DELETED';
    throw error;
  }
  return withSetupFlags(user);
};

const anonymizeDeletedUser = (user) => {
  const tombstoneEmail = `deleted+${user._id}@deleted.fabrica.local`;
  const previousEmail = user.email;
  const previousFirebaseUid = user.firebaseUid;

  user.email = tombstoneEmail;
  user.firebaseUid = null;
  user.fcmTokens = [];
  if (!user.deletedAt) user.deletedAt = new Date();

  return { previousEmail, previousFirebaseUid, tombstoneEmail };
};

/**
 * Soft-delete an account by email.
 * Keeps Mongo orders/products/seller/buyer rows; frees the email for a fresh signup;
 * disables Firebase Auth for the old identity.
 */
export const softDeleteUserByEmail = async (email) => {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) {
    const error = new Error('Email is required');
    error.statusCode = 400;
    error.code = 'INVALID_EMAIL';
    throw error;
  }

  // Match live email, or already-tombstoned rows still holding the original via lookup miss.
  let user = await User.findOne({ email: normalized });
  if (!user && !normalized.startsWith('deleted+')) {
    // Also allow re-running soft-delete by original email after a partial delete
    // where deletedAt was set but email was not anonymized yet.
    user = await User.findOne({ email: normalized, deletedAt: { $ne: null } });
  }

  if (!user) {
    const error = new Error(`No Mongo user found for ${normalized}`);
    error.statusCode = 404;
    error.code = 'USER_NOT_FOUND';
    throw error;
  }

  const alreadyDeleted = Boolean(user.deletedAt);
  const needsAnonymize = !String(user.email).startsWith('deleted+');
  const previousFirebaseUid = user.firebaseUid;
  let previousEmail = user.email;
  let tombstoneEmail = user.email;

  if (!alreadyDeleted || needsAnonymize) {
    const anon = anonymizeDeletedUser(user);
    previousEmail = anon.previousEmail;
    tombstoneEmail = anon.tombstoneEmail;
    await user.save();
  }

  // Remove Firebase Auth identities so the email can sign up again as a new account.
  // Mongo rows (orders, etc.) stay on the anonymized user id.
  let firebaseRemoved = false;
  let firebaseNote = 'no firebase identity to remove';
  const firebaseTargets = [previousFirebaseUid].filter(Boolean);

  try {
    const fbUser = await admin.auth().getUserByEmail(normalized);
    if (fbUser?.uid && !firebaseTargets.includes(fbUser.uid)) {
      firebaseTargets.push(fbUser.uid);
    }
  } catch {
    // ignore — email may already be unused in Firebase
  }

  for (const uid of firebaseTargets) {
    try {
      await admin.auth().deleteUser(uid);
      firebaseRemoved = true;
      firebaseNote = 'Firebase user deleted';
    } catch (error) {
      if (error?.code === 'auth/user-not-found') {
        firebaseNote = 'Firebase user already missing';
      } else {
        try {
          await admin.auth().updateUser(uid, { disabled: true });
          firebaseRemoved = true;
          firebaseNote = `Firebase delete failed, disabled instead: ${error.message}`;
        } catch (inner) {
          firebaseNote = `Firebase cleanup failed: ${inner.message || error.message}`;
        }
      }
    }
  }

  return {
    alreadyDeleted,
    userId: user._id,
    email: previousEmail,
    tombstoneEmail,
    role: user.role,
    deletedAt: user.deletedAt,
    firebaseRemoved,
    firebaseNote,
  };
};

/** Public hint after a failed email/password login (providers for precise error copy). */
export const getSignInHint = async (email) => {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) {
    const error = new Error('A valid email is required');
    error.statusCode = 400;
    error.code = 'INVALID_EMAIL';
    throw error;
  }

  try {
    const firebaseUser = await admin.auth().getUserByEmail(normalized);
    const providers = (firebaseUser.providerData || [])
      .map((entry) => entry.providerId)
      .filter(Boolean);
    return { exists: true, providers };
  } catch (error) {
    if (error?.code === 'auth/user-not-found') {
      return { exists: false, providers: [] };
    }
    throw error;
  }
};
