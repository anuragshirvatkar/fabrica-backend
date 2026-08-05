import PDFDocument from 'pdfkit';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import Seller from '../models/Seller.js';
import { createError } from '../utils/errors.js';
import { ensurePaymentForDeliveredOrder } from './paymentService.js';

const formatMoney = (amount) =>
  `Rs ${Number(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const formatDate = (value) => {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

const buildPdfBuffer = (draw) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    draw(doc);
    doc.end();
  });

const drawHeader = (doc, { title, subtitle }) => {
  doc
    .fontSize(18)
    .fillColor('#111111')
    .font('Helvetica-Bold')
    .text('FABRICA', 48, 48, { continued: false });
  doc
    .fontSize(9)
    .fillColor('#6b7280')
    .font('Helvetica')
    .text('B2B Fabric Marketplace', 48, 70);

  doc
    .fontSize(16)
    .fillColor('#111111')
    .font('Helvetica-Bold')
    .text(title, 300, 48, { align: 'right', width: 247 });
  doc
    .fontSize(9)
    .fillColor('#6b7280')
    .font('Helvetica')
    .text(subtitle, 300, 70, { align: 'right', width: 247 });

  doc
    .moveTo(48, 100)
    .lineTo(547, 100)
    .strokeColor('#e5e7eb')
    .lineWidth(1)
    .stroke();
};

const drawPartyBlock = (doc, x, y, heading, lines) => {
  doc.fontSize(9).fillColor('#6b7280').font('Helvetica').text(heading, x, y);
  let cursorY = y + 14;
  lines.filter(Boolean).forEach((line, index) => {
    doc
      .fontSize(index === 0 ? 11 : 9)
      .fillColor('#111111')
      .font(index === 0 ? 'Helvetica-Bold' : 'Helvetica')
      .text(line, x, cursorY, { width: 220 });
    cursorY += index === 0 ? 16 : 13;
  });
  return cursorY;
};

const drawItemsTable = (doc, startY, items) => {
  const colX = [48, 250, 320, 400, 480];
  let y = startY;

  doc.rect(48, y, 499, 22).fill('#f5f3ef');
  doc.fillColor('#374151').fontSize(8).font('Helvetica-Bold');
  doc.text('ITEM', colX[0] + 8, y + 7);
  doc.text('QTY', colX[1], y + 7);
  doc.text('UNIT', colX[2], y + 7);
  doc.text('RATE', colX[3], y + 7);
  doc.text('AMOUNT', colX[4], y + 7);

  y += 28;
  doc.font('Helvetica').fontSize(9).fillColor('#111111');

  items.forEach((item) => {
    if (y > 700) {
      doc.addPage();
      y = 48;
    }
    const lineTotal = Number(item.price || 0) * Number(item.quantity || 0);
    const name = item.colorHex
      ? `${item.productName} (${item.colorHex})`
      : item.productName;

    doc.text(name, colX[0] + 8, y, { width: 190 });
    doc.text(String(item.quantity), colX[1], y);
    doc.text(String(item.unit || 'meter'), colX[2], y);
    doc.text(formatMoney(item.price), colX[3], y);
    doc.text(formatMoney(lineTotal), colX[4], y);
    y += 22;
  });

  return y;
};

const drawTotals = (doc, y, totalAmount) => {
  doc
    .moveTo(320, y + 8)
    .lineTo(547, y + 8)
    .strokeColor('#e5e7eb')
    .stroke();
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor('#111111')
    .text('Total', 320, y + 18);
  doc.text(formatMoney(totalAmount), 400, y + 18, { width: 147, align: 'right' });
};

const drawFooter = (doc) => {
  doc
    .fontSize(8)
    .fillColor('#9ca3af')
    .font('Helvetica')
    .text(
      'This is a system-generated invoice from Fabrica. No physical signature is required.',
      48,
      780,
      { align: 'center', width: 499 },
    );
};

const loadInvoiceContext = async (orderId) => {
  const order = await Order.findById(orderId);
  if (!order) throw createError('Order not found', 404, 'ORDER_NOT_FOUND');
  if (order.status === 'CANCELLED') {
    throw createError('Invoice is not available for cancelled orders', 400, 'INVALID_STATUS');
  }

  const seller = await Seller.findById(order.sellerId);
  let payment = null;
  if (order.status === 'DELIVERED') {
    payment = await ensurePaymentForDeliveredOrder(order);
  } else if (order.paymentId) {
    const existing = await Payment.findById(order.paymentId);
    payment = existing
      ? {
          _id: existing._id,
          reference: existing.reference,
          amount: existing.amount,
          payerName: existing.payerName,
          createdAt: existing.createdAt,
        }
      : null;
  }

  return { order, seller, payment };
};

const renderInvoicePdf = async ({
  type,
  order,
  seller,
  payment,
}) => {
  const orderCode = String(order._id).slice(-6).toUpperCase();
  const invoiceNo =
    type === 'SALES'
      ? payment?.reference || `SI-${orderCode}`
      : `PI-${orderCode}`;

  const title = type === 'SALES' ? 'SALES INVOICE' : 'PURCHASE INVOICE';
  const ship = order.shippingAddress || {};

  return buildPdfBuffer((doc) => {
    drawHeader(doc, {
      title,
      subtitle: `Invoice No. ${invoiceNo}`,
    });

    doc.fontSize(9).fillColor('#6b7280').font('Helvetica').text('Invoice date', 48, 118);
    doc
      .fontSize(10)
      .fillColor('#111111')
      .font('Helvetica')
      .text(formatDate(payment?.createdAt || order.deliveredAt || order.createdAt), 48, 132);

    doc.fontSize(9).fillColor('#6b7280').text('Order', 200, 118);
    doc.fontSize(10).fillColor('#111111').text(`#${orderCode}`, 200, 132);

    doc.fontSize(9).fillColor('#6b7280').text('Status', 320, 118);
    doc.fontSize(10).fillColor('#111111').text(order.status, 320, 132);

    const sellerLines = [
      seller?.companyName || 'Fabrica Seller',
      seller?.gst ? `GSTIN: ${seller.gst}` : null,
      seller?.phone ? `Phone: ${seller.phone}` : null,
    ];

    const buyerLines = [
      ship.name || payment?.payerName || 'Buyer',
      ship.companyName || null,
      [ship.addressLine1, ship.addressLine2].filter(Boolean).join(', ') || null,
      [ship.city, ship.state, ship.postalCode].filter(Boolean).join(', ') || null,
      ship.phone ? `Phone: ${ship.phone}` : null,
    ];

    if (type === 'SALES') {
      drawPartyBlock(doc, 48, 170, 'FROM (SELLER)', sellerLines);
      drawPartyBlock(doc, 300, 170, 'BILL TO (BUYER)', buyerLines);
    } else {
      drawPartyBlock(doc, 48, 170, 'FROM (SELLER)', sellerLines);
      drawPartyBlock(doc, 300, 170, 'SHIP / BILL TO', buyerLines);
    }

    const tableEnd = drawItemsTable(doc, 280, order.items || []);
    drawTotals(doc, tableEnd + 8, order.totalAmount);

    doc
      .fontSize(9)
      .fillColor('#6b7280')
      .font('Helvetica')
      .text(
        type === 'SALES'
          ? 'Sales invoice for seller records. Generated automatically by Fabrica.'
          : 'Purchase invoice for buyer records. Generated automatically by Fabrica.',
        48,
        tableEnd + 55,
        { width: 499 },
      );

    drawFooter(doc);
  });
};

export const getSalesInvoiceForPayment = async (user, paymentId) => {
  if (user.role !== 'SELLER') throw createError('Forbidden', 403, 'FORBIDDEN');

  const seller = await Seller.findOne({ userId: user._id });
  if (!seller) throw createError('Seller profile not found', 404, 'SELLER_NOT_FOUND');

  const payment = await Payment.findOne({ _id: paymentId, sellerId: seller._id });
  if (!payment) throw createError('Payment not found', 404, 'PAYMENT_NOT_FOUND');

  const { order, seller: orderSeller, payment: linkedPayment } = await loadInvoiceContext(
    payment.orderId,
  );

  if (String(order.sellerId) !== String(seller._id)) {
    throw createError('Payment not found', 404, 'PAYMENT_NOT_FOUND');
  }

  const buffer = await renderInvoicePdf({
    type: 'SALES',
    order,
    seller: orderSeller,
    payment: linkedPayment || {
      reference: payment.reference,
      amount: payment.amount,
      payerName: payment.payerName,
      createdAt: payment.createdAt,
    },
  });

  const filename = `sales-invoice-${payment.reference || String(payment._id).slice(-6)}.pdf`;
  return { buffer, filename };
};

export const getPurchaseInvoiceForOrder = async (user, orderId) => {
  if (user.role !== 'BUYER') throw createError('Forbidden', 403, 'FORBIDDEN');

  const { order, seller, payment } = await loadInvoiceContext(orderId);
  if (String(order.buyerId) !== String(user._id)) {
    throw createError('Order not found', 404, 'ORDER_NOT_FOUND');
  }

  if (order.status !== 'DELIVERED') {
    throw createError('Purchase invoice is available after delivery', 400, 'INVALID_STATUS');
  }

  const buffer = await renderInvoicePdf({
    type: 'PURCHASE',
    order,
    seller,
    payment,
  });

  const orderCode = String(order._id).slice(-6).toUpperCase();
  return { buffer, filename: `purchase-invoice-${orderCode}.pdf` };
};

export const getSalesInvoiceForOrder = async (user, orderId) => {
  if (user.role !== 'SELLER') throw createError('Forbidden', 403, 'FORBIDDEN');

  const seller = await Seller.findOne({ userId: user._id });
  if (!seller) throw createError('Seller profile not found', 404, 'SELLER_NOT_FOUND');

  const { order, seller: orderSeller, payment } = await loadInvoiceContext(orderId);
  if (String(order.sellerId) !== String(seller._id)) {
    throw createError('Order not found', 404, 'ORDER_NOT_FOUND');
  }

  if (order.status !== 'DELIVERED') {
    throw createError('Sales invoice is available after delivery', 400, 'INVALID_STATUS');
  }

  const buffer = await renderInvoicePdf({
    type: 'SALES',
    order,
    seller: orderSeller,
    payment,
  });

  const orderCode = String(order._id).slice(-6).toUpperCase();
  return { buffer, filename: `sales-invoice-${orderCode}.pdf` };
};
