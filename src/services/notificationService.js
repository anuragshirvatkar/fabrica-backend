import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { buildNotificationEmail, sendEmail } from './emailService.js';
import { sendPushToUser } from './pushService.js';

/**
 * Create an in-app notification and fan out the same message via push + email.
 * Email uses the same title/body as the notification (branded template).
 */
export async function createNotification({
  userId,
  title,
  body,
  type = 'GENERAL',
  orderId = null,
  link = '',
  email,
  emailSubject,
  emailHtml,
}) {
  const notification = await Notification.create({
    userId,
    title,
    body,
    type,
    orderId,
    link,
  });

  let recipientEmail = email;
  if (!recipientEmail) {
    const user = await User.findById(userId).select('email');
    recipientEmail = user?.email || '';
  }

  const html =
    emailHtml ||
    buildNotificationEmail({
      title,
      body,
      link,
    });

  await Promise.allSettled([
    sendPushToUser(userId, {
      title,
      body,
      link,
      data: { type, orderId: orderId || '' },
    }),
    recipientEmail
      ? sendEmail({
          to: recipientEmail,
          subject: emailSubject || `Fabrica — ${title}`,
          html,
          text: body,
        })
      : Promise.resolve(),
  ]);

  return notification;
}

export async function listNotifications(userId, { unreadOnly = false } = {}) {
  const query = { userId };
  if (unreadOnly) query.read = false;
  return Notification.find(query).sort({ createdAt: -1 }).limit(50);
}

export async function markNotificationRead(userId, notificationId) {
  const notification = await Notification.findOneAndUpdate(
    { _id: notificationId, userId },
    { read: true },
    { new: true },
  );
  return notification;
}

export async function markAllNotificationsRead(userId) {
  await Notification.updateMany({ userId, read: false }, { read: true });
  return { success: true };
}

export async function getUnreadCount(userId) {
  return Notification.countDocuments({ userId, read: false });
}
