import jwt from 'jsonwebtoken';
import { ZodError } from 'zod';
import { config } from './config.js';
import { UserM, AuditM } from './models.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const signToken = (user) =>
  jwt.sign({ sub: String(user._id) }, config.jwtSecret, { expiresIn: config.jwtExpires });

// Role and active flag are read from the DB on every request, so disabling a user or
// changing a role takes effect immediately even though the JWT is long-lived.
export const requireAuth = asyncH(async (req, _res, next) => {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) throw new HttpError(401, 'Not signed in');
  let payload;
  try {
    payload = jwt.verify(h.slice(7), config.jwtSecret);
  } catch {
    throw new HttpError(401, 'Session expired');
  }
  const user = await UserM.findById(payload.sub).select('username role active');
  if (!user || !user.active) throw new HttpError(401, 'Account disabled');
  req.user = { id: user._id, username: user.username, role: user.role };
  next();
});

export const requireRole = (...roles) => (req, _res, next) =>
  roles.includes(req.user.role) ? next() : next(new HttpError(403, 'Not allowed for your role'));

export const audit = (req, action, entity, entityId, detail, session) =>
  AuditM.create(
    [{ by: req.user.id, byName: req.user.username, action, entity, entityId: String(entityId ?? ''), detail }],
    { session }
  );

export function errorHandler(err, _req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Invalid input', issues: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err?.code === 11000) return res.status(409).json({ error: 'Duplicate value' });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
}
