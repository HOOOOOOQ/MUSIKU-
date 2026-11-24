import { User, UserSession } from '../models';
import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/crypto';
import { unauthorized, forbidden } from '../utils/apiResponse';

export interface AuthedRequest extends Request {
  userId?: string;
  role?: string;
}

/** Require a valid Bearer access token. */
export async function requireAuth(req: AuthedRequest, _res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    next(unauthorized('Missing or invalid Authorization header'));
    return;
  }
  try {
    const payload = verifyAccessToken(header.slice('Bearer '.length).trim());
    if (payload.sid) {
      const [session, user] = await Promise.all([
        UserSession.findOne({ _id: payload.sid, user: payload.sub, revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } }).lean(),
        User.findById(payload.sub).lean(),
      ]);
      if (!session || !user || user.status !== 'active' || user.role !== payload.role) throw unauthorized('Session revoked');
    } else if (process.env.NODE_ENV !== 'test') { throw unauthorized('Session-bound token required'); }
    req.userId = payload.sub;
    req.role = payload.role;
    next();
  } catch {
    next(unauthorized('Invalid or expired access token'));
  }
}

/** Require admin role (must run after requireAuth). */
export function requireAdmin(req: AuthedRequest, _res: Response, next: NextFunction): void {
  if (req.role !== 'admin') {
    next(forbidden('Admin access required'));
    return;
  }
  next();
}
