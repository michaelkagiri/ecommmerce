import mongoose from 'mongoose';
const { Schema } = mongoose;
const int = { type: Number, validate: Number.isInteger };

const User = new Schema(
  {
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['cashier', 'manager'], required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// All money is stored as integer cents (1/100 KES). Never floats.
const Product = new Schema(
  {
    barcode: { type: String, required: true, unique: true, trim: true }, // unique index = fast scan lookup
    name: { type: String, required: true, trim: true },
    priceCents: { ...int, required: true, min: 0 },
    stock: { type: Number, default: 0 }, // may go negative after offline sync; the sale is flagged
    lowStockAt: { type: Number, default: 5 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const Line = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product' },
    barcode: String,
    name: String,
    unitPriceCents: int,
    qty: int,
    lineTotalCents: int,
    refundedQty: { type: Number, default: 0 },
  },
  { _id: false }
);

const Sale = new Schema(
  {
    clientId: { type: String, required: true, unique: true }, // UUID from the till: makes sync idempotent
    receiptNo: { type: String, required: true, index: true },
    till: { type: String, required: true },
    cashier: { type: Schema.Types.ObjectId, ref: 'User' },
    cashierName: String,
    lines: [Line],
    totalCents: int,
    changeCents: { ...int, default: 0 },
    payments: [
      {
        method: { type: String, enum: ['cash', 'card', 'mpesa'] },
        amountCents: int,
        ref: String,
        _id: false,
      },
    ],
    status: { type: String, enum: ['completed', 'partially_refunded', 'refunded'], default: 'completed' },
    flags: [String], // PRICE_MISMATCH, NEGATIVE_STOCK, UNDERPAID, INACTIVE_PRODUCT
    soldAt: { type: Date, index: true }, // till clock time
  },
  { timestamps: true }
);

const Refund = new Schema(
  {
    sale: { type: Schema.Types.ObjectId, ref: 'Sale', index: true },
    receiptNo: String,
    items: [{ barcode: String, name: String, qty: Number, amountCents: Number, _id: false }],
    amountCents: int,
    method: { type: String, enum: ['cash', 'card', 'mpesa'] },
    reason: String,
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    byName: String,
  },
  { timestamps: true }
);

const StockMovement = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', index: true },
    barcode: String,
    delta: Number,
    reason: { type: String, enum: ['sale', 'refund', 'delivery', 'damage', 'stocktake', 'correction'] },
    ref: String,
    note: String,
    byName: String,
  },
  { timestamps: true }
);

const Audit = new Schema(
  {
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    byName: String,
    action: String,
    entity: String,
    entityId: String,
    detail: Schema.Types.Mixed,
  },
  { timestamps: true }
);

const MpesaPayment = new Schema(
  {
    checkoutRequestId: { type: String, required: true, unique: true },
    merchantRequestId: String,
    phone: String,
    amountCents: int,
    status: { type: String, enum: ['pending', 'success', 'failed'], default: 'pending' },
    mpesaReceipt: String,
    resultDesc: String,
    usedBySale: { type: String, default: null }, // clientId of the sale that consumed it
  },
  { timestamps: true }
);

export const UserM = mongoose.model('User', User);
export const ProductM = mongoose.model('Product', Product);
export const SaleM = mongoose.model('Sale', Sale);
export const RefundM = mongoose.model('Refund', Refund);
export const StockMovementM = mongoose.model('StockMovement', StockMovement);
export const AuditM = mongoose.model('Audit', Audit);
export const MpesaPaymentM = mongoose.model('MpesaPayment', MpesaPayment);
