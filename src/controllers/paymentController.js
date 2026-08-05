import asyncHandler from '../utils/asyncHandler.js';
import {
  getPaymentForOrder,
  getSellerPayment,
  listSellerPayments,
} from '../services/paymentService.js';
import { getSalesInvoiceForPayment } from '../services/invoiceService.js';

export const getPayments = asyncHandler(async (req, res) => {
  const payments = await listSellerPayments(req.user);
  res.status(200).json({ success: true, payments });
});

export const getPayment = asyncHandler(async (req, res) => {
  const payment = await getSellerPayment(req.user, req.params.id);
  res.status(200).json({ success: true, payment });
});

export const getOrderPayment = asyncHandler(async (req, res) => {
  const payment = await getPaymentForOrder(req.user, req.params.orderId);
  res.status(200).json({ success: true, payment });
});

export const downloadPaymentInvoice = asyncHandler(async (req, res) => {
  const { buffer, filename } = await getSalesInvoiceForPayment(req.user, req.params.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
});
