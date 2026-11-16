import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { ProductM, StockMovementM } from '../models.js';
import { asyncH, audit, HttpError, requireAuth, requireRole } from '../http.js';

const r = Router();
r.use(requireAuth);
const mgr = requireRole('manager');
const cents = z.number().int().nonnegative();

// Cashiers get the sellable catalog (cached offline by the till). Managers can see everything.
r.get('/', asyncH(async (req, res) => {
  const all = req.user.role === 'manager' && req.query.all === '1';
  const items = await ProductM.find(all ? {} : { active: true }).sort({ name: 1 }).lean();
  res.json({ items, at: new Date().toISOString() });
}));

r.post('/', mgr, asyncH(async (req, res) => {
  const b = z.object({
    barcode: z.string().min(1).max(64), name: z.string().min(1).max(120), priceCents: cents,
    stock: z.number().int().default(0), lowStockAt: z.number().int().nonnegative().default(5),
  }).parse(req.body);
  const p = await ProductM.create(b);
  await audit(req, 'product.create', 'Product', p._id, b);
  res.status(201).json(p);
}));

r.put('/:id', mgr, asyncH(async (req, res) => {
  const b = z.object({
    name: z.string().min(1).max(120).optional(), priceCents: cents.optional(),
    active: z.boolean().optional(), lowStockAt: z.number().int().nonnegative().optional(),
  }).parse(req.body);
  const before = await ProductM.findById(req.params.id);
  if (!before) throw new HttpError(404, 'Product not found');
  const changes = {};
  for (const k of Object.keys(b)) if (before[k] !== b[k]) changes[k] = { from: before[k], to: b[k] };
  Object.assign(before, b);
  await before.save();
  if (Object.keys(changes).length) await audit(req, 'product.update', 'Product', before._id, changes);
  res.json(before);
}));

// Deliveries, damage, stocktake corrections: always a movement record, never a silent edit.
r.post('/:id/adjust', mgr, asyncH(async (req, res) => {
  const b = z.object({
    delta: z.number().int().refine((n) => n !== 0, 'delta cannot be 0'),
    reason: z.enum(['delivery', 'damage', 'stocktake', 'correction']), note: z.string().max(200).optional(),
  }).parse(req.body);
  const session = await mongoose.startSession();
  let product;
  try {
    await session.withTransaction(async () => {
      product = await ProductM.findByIdAndUpdate(req.params.id, { $inc: { stock: b.delta } }, { new: true, session });
      if (!product) throw new HttpError(404, 'Product not found');
      await StockMovementM.create([{ product: product._id, barcode: product.barcode, delta: b.delta, reason: b.reason, note: b.note, byName: req.user.username }], { session });
      await audit(req, 'stock.adjust', 'Product', product._id, b, session);
    });
  } finally { await session.endSession(); }
  res.json(product);
}));

r.get('/:id/movements', mgr, asyncH(async (req, res) => {
  res.json(await StockMovementM.find({ product: req.params.id }).sort({ createdAt: -1 }).limit(100).lean());
}));

export default r;
