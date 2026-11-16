import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { UserM } from '../models.js';
import { asyncH, audit, HttpError, requireAuth, requireRole } from '../http.js';

const r = Router();
r.use(requireAuth, requireRole('manager'));

r.get('/', asyncH(async (_req, res) => res.json(await UserM.find().select('-passwordHash').lean())));

r.post('/', asyncH(async (req, res) => {
  const b = z.object({ username: z.string().min(2).max(40), password: z.string().min(8).max(100), role: z.enum(['cashier', 'manager']) }).parse(req.body);
  const u = await UserM.create({ username: b.username, role: b.role, passwordHash: await bcrypt.hash(b.password, 10) });
  await audit(req, 'user.create', 'User', u._id, { username: u.username, role: u.role });
  res.status(201).json({ id: u._id, username: u.username, role: u.role, active: u.active });
}));

// Reset password, change role, or disable. Disabling takes effect on the next request.
r.put('/:id', asyncH(async (req, res) => {
  const b = z.object({ password: z.string().min(8).max(100).optional(), role: z.enum(['cashier', 'manager']).optional(), active: z.boolean().optional() }).parse(req.body);
  if (String(req.user.id) === req.params.id && (b.active === false || (b.role && b.role !== 'manager')))
    throw new HttpError(409, 'You cannot lock yourself out');
  const u = await UserM.findById(req.params.id);
  if (!u) throw new HttpError(404, 'User not found');
  if (b.password) u.passwordHash = await bcrypt.hash(b.password, 10);
  if (b.role) u.role = b.role;
  if (b.active !== undefined) u.active = b.active;
  await u.save();
  await audit(req, 'user.update', 'User', u._id, { role: b.role, active: b.active, passwordReset: !!b.password });
  res.json({ id: u._id, username: u.username, role: u.role, active: u.active });
}));

export default r;
