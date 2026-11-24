import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/crypto';
import { unauthorized, forbidden } from '../utils/apiResponse';

export interface AuthedRequest extends Request {
  userId?: string;
  role?: string;
}

/** Require a valid Bearer access token. */
export function requireAuth(req: AuthedRequest, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    next(unauthorized('Missing or invalid Authorization header'));
    return;
  }
  try {
    const payload = verifyAccessToken(header.slice('Bearer '.length).trim());
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
