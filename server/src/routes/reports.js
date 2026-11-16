import { Router } from 'express';
import { z } from 'zod';
import { AuditM, ProductM, RefundM, SaleM } from '../models.js';
import { asyncH, requireAuth, requireRole } from '../http.js';

const r = Router();
r.use(requireAuth, requireRole('manager'));

// Shift / day summary. `from` and `to` are ISO timestamps (the browser sends local-day bounds).
// expectedCashCents is what should be in the drawer: cash taken minus change given minus cash refunds.
r.get('/summary', asyncH(async (req, res) => {
  const q = z.object({ from: z.string().datetime(), to: z.string().datetime(), till: z.string().optional() }).parse(req.query);
  const sq = { soldAt: { $gte: new Date(q.from), $lt: new Date(q.to) } };
  if (q.till) sq.till = q.till;
  const sales = await SaleM.find(sq).lean();
  const refunds = await RefundM.find({ createdAt: { $gte: new Date(q.from), $lt: new Date(q.to) } }).lean();

  const byMethod = { cash: 0, card: 0, mpesa: 0 };
  let changeCents = 0, grossCents = 0;
  const byTill = {};
  for (const s of sales) {
    grossCents += s.totalCents;
    changeCents += s.changeCents || 0;
    for (const p of s.payments) byMethod[p.method] += p.amountCents;
    byTill[s.till] = (byTill[s.till] || 0) + s.totalCents;
  }
  const refundsByMethod = { cash: 0, card: 0, mpesa: 0 };
  for (const f of refunds) refundsByMethod[f.method] += f.amountCents;
  const refundsCents = refunds.reduce((a, f) => a + f.amountCents, 0);

  res.json({
    from: q.from, to: q.to, salesCount: sales.length, grossCents, refundsCents,
    netCents: grossCents - refundsCents, byMethod, changeCents, refundsByMethod,
    expectedCashCents: byMethod.cash - changeCents - refundsByMethod.cash,
    flaggedCount: sales.filter((s) => s.flags?.length).length, byTill,
  });
}));

r.get('/low-stock', asyncH(async (_req, res) => {
  res.json(await ProductM.find({ active: true, $expr: { $lte: ['$stock', '$lowStockAt'] } }).sort({ stock: 1 }).lean());
}));

r.get('/audit', asyncH(async (_req, res) => {
  res.json(await AuditM.find().sort({ createdAt: -1 }).limit(200).lean());
}));

export default r;
