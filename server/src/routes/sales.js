import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { MpesaPaymentM, ProductM, RefundM, SaleM, StockMovementM } from '../models.js';
import { asyncH, audit, HttpError, requireAuth, requireRole } from '../http.js';

const r = Router();
r.use(requireAuth);

const SaleIn = z.object({
  clientId: z.string().uuid(),
  receiptNo: z.string().min(1).max(40),
  till: z.string().min(1).max(20),
  soldAt: z.string().datetime(),
  lines: z.array(z.object({
    barcode: z.string().min(1),
    qty: z.number().int().positive().max(1000),
    unitPriceCents: z.number().int().nonnegative(), // what the till showed; used only to detect mismatches
  })).min(1).max(200),
  payments: z.array(z.object({
    method: z.enum(['cash', 'card', 'mpesa']),
    amountCents: z.number().int().positive(),
    ref: z.string().max(60).optional(),
  })).min(1).max(4),
});

const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);

// Create a sale. The server re-prices from its own catalog, so the browser can never set prices.
// Idempotent on clientId: a retried sync returns the stored sale and never double-deducts stock.
// Saving the sale, decrementing stock and writing movements happen in ONE transaction.
r.post('/', asyncH(async (req, res) => {
  const body = SaleIn.parse(req.body);
  const dup = await SaleM.findOne({ clientId: body.clientId }).lean();
  if (dup) return res.json({ sale: dup, duplicate: true });

  const session = await mongoose.startSession();
  let sale;
  try {
    await session.withTransaction(async () => {
      const flags = new Set();
      const barcodes = [...new Set(body.lines.map((l) => l.barcode))];
      const products = await ProductM.find({ barcode: { $in: barcodes } }).session(session);
      const byCode = new Map(products.map((p) => [p.barcode, p]));
      const qtyByProduct = new Map();
      const lines = body.lines.map((l) => {
        const p = byCode.get(l.barcode);
        if (!p) throw new HttpError(422, `Unknown barcode ${l.barcode}`);
        if (!p.active) flags.add('INACTIVE_PRODUCT');
        if (p.priceCents !== l.unitPriceCents) flags.add('PRICE_MISMATCH');
        qtyByProduct.set(p.id, (qtyByProduct.get(p.id) || 0) + l.qty);
        return { product: p._id, barcode: p.barcode, name: p.name, unitPriceCents: p.priceCents, qty: l.qty, lineTotalCents: p.priceCents * l.qty };
      });

      const totalCents = sum(lines, (l) => l.lineTotalCents);
      const paid = sum(body.payments, (p) => p.amountCents);
      const cashTendered = sum(body.payments.filter((p) => p.method === 'cash'), (p) => p.amountCents);
      // An offline sale already happened, so a shortfall is recorded and flagged, never rejected.
      if (paid < totalCents) flags.add('UNDERPAID');
      const changeCents = Math.max(0, paid - totalCents);
      if (changeCents > cashTendered) throw new HttpError(422, 'Change cannot exceed cash tendered');

      // M-Pesa payments must match a confirmed Daraja callback, used once.
      for (const p of body.payments.filter((x) => x.method === 'mpesa')) {
        const m = await MpesaPaymentM.findOneAndUpdate(
          { checkoutRequestId: p.ref, status: 'success', usedBySale: null, amountCents: p.amountCents },
          { usedBySale: body.clientId },
          { session }
        );
        if (!m) throw new HttpError(422, 'M-Pesa payment not confirmed or already used');
      }

      for (const [id, qty] of qtyByProduct) {
        const updated = await ProductM.findByIdAndUpdate(id, { $inc: { stock: -qty } }, { new: true, session });
        if (updated.stock < 0) flags.add('NEGATIVE_STOCK');
        await StockMovementM.create([{ product: updated._id, barcode: updated.barcode, delta: -qty, reason: 'sale', ref: body.receiptNo, byName: req.user.username }], { session });
      }

      [sale] = await SaleM.create([{
        clientId: body.clientId, receiptNo: body.receiptNo, till: body.till,
        cashier: req.user.id, cashierName: req.user.username,
        lines, totalCents, changeCents, payments: body.payments,
        flags: [...flags], soldAt: new Date(body.soldAt),
      }], { session });
    });
  } catch (e) {
    // Two syncs of the same sale racing each other: the loser hits the unique index.
    if (e?.code === 11000) {
      const existing = await SaleM.findOne({ clientId: body.clientId }).lean();
      if (existing) return res.json({ sale: existing, duplicate: true });
    }
    throw e;
  } finally {
    await session.endSession();
  }
  res.status(201).json({ sale });
}));

const mgr = requireRole('manager');

r.get('/', mgr, asyncH(async (req, res) => {
  const q = {};
  if (req.query.flagged === '1') q['flags.0'] = { $exists: true };
  if (req.query.receiptNo) q.receiptNo = String(req.query.receiptNo);
  res.json(await SaleM.find(q).sort({ soldAt: -1 }).limit(200).lean());
}));

// Refund or void: never deletes. Omit `lines` to refund everything not yet refunded.
r.post('/:id/refund', mgr, asyncH(async (req, res) => {
  const b = z.object({
    lines: z.array(z.object({ barcode: z.string(), qty: z.number().int().positive() })).optional(),
    method: z.enum(['cash', 'card', 'mpesa']).default('cash'),
    reason: z.string().min(3).max(200),
  }).parse(req.body);

  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const sale = await SaleM.findById(req.params.id).session(session);
      if (!sale) throw new HttpError(404, 'Sale not found');
      const want = b.lines ?? sale.lines.map((l) => ({ barcode: l.barcode, qty: l.qty - l.refundedQty })).filter((x) => x.qty > 0);
      if (!want.length) throw new HttpError(409, 'Nothing left to refund');

      let amountCents = 0;
      const items = new Map();
      const restock = new Map();
      for (const w of want) {
        let left = w.qty;
        for (const l of sale.lines) {
          if (l.barcode !== w.barcode || left === 0) continue;
          const take = Math.min(left, l.qty - l.refundedQty);
          if (take <= 0) continue;
          l.refundedQty += take;
          left -= take;
          const amt = take * l.unitPriceCents;
          amountCents += amt;
          const it = items.get(l.barcode) || { barcode: l.barcode, name: l.name, qty: 0, amountCents: 0 };
          it.qty += take; it.amountCents += amt; items.set(l.barcode, it);
          restock.set(String(l.product), (restock.get(String(l.product)) || 0) + take);
        }
        if (left > 0) throw new HttpError(422, `Cannot refund ${w.qty} x ${w.barcode}`);
      }
      sale.status = sale.lines.every((l) => l.refundedQty === l.qty) ? 'refunded' : 'partially_refunded';
      await sale.save({ session });

      for (const [pid, qty] of restock) {
        const p = await ProductM.findByIdAndUpdate(pid, { $inc: { stock: qty } }, { new: true, session });
        await StockMovementM.create([{ product: p._id, barcode: p.barcode, delta: qty, reason: 'refund', ref: sale.receiptNo, byName: req.user.username }], { session });
      }
      const [refund] = await RefundM.create([{ sale: sale._id, receiptNo: sale.receiptNo, items: [...items.values()], amountCents, method: b.method, reason: b.reason, by: req.user.id, byName: req.user.username }], { session });
      await audit(req, 'sale.refund', 'Sale', sale._id, { amountCents, reason: b.reason, receiptNo: sale.receiptNo }, session);
      result = { sale, refund };
    });
  } finally { await session.endSession(); }
  res.json(result);
}));

export default r;
