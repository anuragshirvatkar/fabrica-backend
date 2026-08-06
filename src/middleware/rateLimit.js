import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

const rateLimitedBody = {
  success: false,
  message: 'Too many requests. Please slow down and try again later.',
  code: 'RATE_LIMITED',
};

const baseOptions = {
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitedBody,
};

/** Broad protection for all API traffic (per IP). */
export const apiLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60 * 1000,
  max: 20_000,
});

/** Auth routes — login sync, me, etc. (per IP). */
export const authLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60 * 1000,
  max: 3_000,
  message: {
    ...rateLimitedBody,
    message: 'Too many auth attempts. Please wait a few minutes and try again.',
  },
});

/** Public email lookup — easy to abuse for probing accounts. */
export const signInHintLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60 * 1000,
  max: 1_000,
  message: {
    ...rateLimitedBody,
    message: 'Too many sign-in checks. Please wait a few minutes and try again.',
  },
});

/** AI endpoints are expensive — keep tighter than general API. */
export const aiLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60 * 1000,
  max: 2_000,
  message: {
    ...rateLimitedBody,
    message: 'Too many AI requests. Please wait a few minutes and try again.',
  },
});

/**
 * Per signed-in account limit (after requireAuth / verifyFirebaseToken).
 * Falls back to IP if user is not attached yet.
 */
export const accountLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60 * 1000,
  max: 15_000,
  keyGenerator: (req) => {
    const uid = req.user?._id?.toString() || req.firebaseUser?.uid;
    if (uid) return `user:${uid}`;
    return ipKeyGenerator(req.ip);
  },
  message: {
    ...rateLimitedBody,
    message: 'This account is making too many requests. Please wait and try again.',
  },
});
