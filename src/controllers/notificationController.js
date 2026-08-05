import asyncHandler from '../utils/asyncHandler.js';
import {
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/notificationService.js';
import { registerFcmToken, removeFcmToken } from '../services/pushService.js';

export const getNotifications = asyncHandler(async (req, res) => {
  const notifications = await listNotifications(req.user._id, {
    unreadOnly: req.query.unread === 'true',
  });
  const unreadCount = await getUnreadCount(req.user._id);
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.status(200).json({ success: true, notifications, unreadCount });
});

export const readNotification = asyncHandler(async (req, res) => {
  const notification = await markNotificationRead(req.user._id, req.params.id);
  res.status(200).json({ success: true, notification });
});

export const readAllNotifications = asyncHandler(async (req, res) => {
  await markAllNotificationsRead(req.user._id);
  res.status(200).json({ success: true });
});

export const saveFcmToken = asyncHandler(async (req, res) => {
  await registerFcmToken(req.user._id, req.body?.token);
  res.status(200).json({ success: true });
});

export const deleteFcmToken = asyncHandler(async (req, res) => {
  await removeFcmToken(req.user._id, req.body?.token);
  res.status(200).json({ success: true });
});
