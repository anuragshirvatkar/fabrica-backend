import admin from '../config/firebase.js';
import User from '../models/User.js';

export async function registerFcmToken(userId, token) {
  if (!token?.trim()) return;
  await User.findByIdAndUpdate(userId, {
    $addToSet: { fcmTokens: token.trim() },
  });
}

export async function removeFcmToken(userId, token) {
  if (!token?.trim()) return;
  await User.findByIdAndUpdate(userId, {
    $pull: { fcmTokens: token.trim() },
  });
}

export async function sendPushToUser(userId, { title, body, link = '', data = {} }) {
  const user = await User.findById(userId).select('fcmTokens');
  const tokens = user?.fcmTokens || [];
  if (!tokens.length) return { sent: 0 };

  const payload = {
    notification: { title, body },
    data: {
      link: String(link || ''),
      ...Object.fromEntries(
        Object.entries(data).map(([key, value]) => [key, String(value ?? '')]),
      ),
    },
  };

  try {
    const response = await admin.messaging().sendEachForMulticast({
      tokens,
      ...payload,
      webpush: {
        fcmOptions: {
          link: link || '/',
        },
      },
    });

    const invalid = [];
    response.responses.forEach((result, index) => {
      if (!result.success) {
        const code = result.error?.code || '';
        if (
          code.includes('registration-token-not-registered') ||
          code.includes('invalid-registration-token')
        ) {
          invalid.push(tokens[index]);
        }
      }
    });

    if (invalid.length) {
      await User.findByIdAndUpdate(userId, { $pull: { fcmTokens: { $in: invalid } } });
    }

    return { sent: response.successCount, failed: response.failureCount };
  } catch (error) {
    console.error('[push] failed', error.message);
    return { sent: 0, error: error.message };
  }
}
