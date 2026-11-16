import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { UserM } from '../models.js';
import { asyncH, HttpError, requireAuth, signToken } from '../http.js';

const r = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
const pub = (u) => ({ id: u._id, username: u.username, role: u.role });

r.post(
  '/login',
  limiter,
  asyncH(async (req, res) => {
    const { username, password } = z.object({ username: z.string().min(1), password: z.string().min(1) }).parse(req.body);
    const user = await UserM.findOne({ username: username.toLowerCase().trim() });
    const ok = user && user.active && (await bcrypt.compare(password, user.passwordHash));
    if (!ok) throw new HttpError(401, 'Wrong username or password');
    res.json({ token: signToken(user), user: pub(user) });
  })
);

// Called while online to extend a till's session before it expires.
r.post('/refresh', requireAuth, asyncH(async (req, res) => {
  const user = await UserM.findById(req.user.id);
  res.json({ token: signToken(user), user: pub(user) });
}));

export default r;
