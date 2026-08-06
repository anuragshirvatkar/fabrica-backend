import admin from '../config/firebase.js';
import User from '../models/User.js';
import { accountLimiter } from './rateLimit.js';

export const verifyFirebaseToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authorization token is required',
        code: 'UNAUTHORIZED',
      });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);

    req.firebaseUser = decodedToken;
    return accountLimiter(req, res, next);
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired authentication token',
      code: 'INVALID_TOKEN',
    });
  }
};

export const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authorization token is required',
        code: 'UNAUTHORIZED',
      });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);

    const user = await User.findOne({ firebaseUid: decodedToken.uid });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found. Please complete registration.',
        code: 'USER_NOT_FOUND',
      });
    }

    req.firebaseUser = decodedToken;
    req.user = user;
    return accountLimiter(req, res, next);
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired authentication token',
      code: 'INVALID_TOKEN',
    });
  }
};

/** Attaches req.user when a valid token is present; never blocks the request. */
export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return next();

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const user = await User.findOne({ firebaseUid: decodedToken.uid });
    if (user) {
      req.firebaseUser = decodedToken;
      req.user = user;
    }
  } catch {
    // Ignore invalid tokens for public endpoints.
  }
  next();
};
