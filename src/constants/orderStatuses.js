export const ORDER_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'PREPARING',
  'READY_FOR_DISPATCH',
  'COMPLETED',
  'CANCELLED',
];

/** Forward-only seller workflow (excluding CANCELLED). */
export const ORDER_FLOW = [
  'PENDING',
  'ACCEPTED',
  'PREPARING',
  'READY_FOR_DISPATCH',
  'COMPLETED',
];

export const ORDER_STATUS_LABELS = {
  PENDING: 'Pending',
  ACCEPTED: 'Accepted',
  PREPARING: 'Preparing',
  READY_FOR_DISPATCH: 'Ready for Dispatch',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

/** Seller-driven advances only (Completed is auto after Ready for Dispatch). */
export const NEXT_ORDER_STATUS = {
  PENDING: 'ACCEPTED',
  ACCEPTED: 'PREPARING',
  PREPARING: 'READY_FOR_DISPATCH',
};

export const SELLER_ACTION_LABELS = {
  PENDING: 'Accept order',
  ACCEPTED: 'Mark Order Prepared',
  PREPARING: 'Mark ready for dispatch',
};

/** Remap legacy statuses stored before the brief-aligned pipeline. */
export const LEGACY_STATUS_MAP = {
  PLACED: 'PENDING',
  DISPATCHED: 'READY_FOR_DISPATCH',
  DELIVERED: 'COMPLETED',
};
