import asyncHandler from '../utils/asyncHandler.js';
import {
  cancelOrder,
  rejectOrder,
  advanceOrder,
  dispatchOrder,
  getOrderForUser,
  listBuyerOrders,
  listSellerOrders,
  placeOrder,
} from '../services/orderService.js';
import {
  getPurchaseInvoiceForOrder,
  getSalesInvoiceForOrder,
} from '../services/invoiceService.js';

export const createOrder = asyncHandler(async (req, res) => {
  const order = await placeOrder(req.user, req.body || {});
  res.status(201).json({ success: true, order });
});

export const getMyOrders = asyncHandler(async (req, res) => {
  const orders =
    req.user.role === 'SELLER'
      ? await listSellerOrders(req.user)
      : await listBuyerOrders(req.user);
  res.status(200).json({ success: true, orders });
});

export const getOrder = asyncHandler(async (req, res) => {
  const order = await getOrderForUser(req.user, req.params.id);
  res.status(200).json({ success: true, order });
});

export const cancelMyOrder = asyncHandler(async (req, res) => {
  const order = await cancelOrder(req.user, req.params.id);
  res.status(200).json({ success: true, order });
});

export const rejectMyOrder = asyncHandler(async (req, res) => {
  const order = await rejectOrder(req.user, req.params.id);
  res.status(200).json({ success: true, order });
});

export const advanceMyOrder = asyncHandler(async (req, res) => {
  const order = await advanceOrder(req.user, req.params.id);
  res.status(200).json({ success: true, order });
});

export const dispatchMyOrder = asyncHandler(async (req, res) => {
  const order = await dispatchOrder(req.user, req.params.id);
  res.status(200).json({ success: true, order });
});

export const downloadOrderInvoice = asyncHandler(async (req, res) => {
  const result =
    req.user.role === 'SELLER'
      ? await getSalesInvoiceForOrder(req.user, req.params.id)
      : await getPurchaseInvoiceForOrder(req.user, req.params.id);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.send(result.buffer);
});
