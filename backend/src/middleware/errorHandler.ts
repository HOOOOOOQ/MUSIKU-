import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { ApiError, fail } from '../utils/apiResponse';

/** Central error handler — no stack traces leak to clients. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    fail(res, err.status, err.code, err.message, err.details);
    return;
  }
  if (err instanceof ZodError) {
    fail(res, 400, 'VALIDATION_ERROR', 'Request validation failed', err.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    })));
    return;
  }
  if (err instanceof Error && ['CastError', 'ValidationError'].includes(err.name)) {
    fail(res, 400, 'VALIDATION_ERROR', 'Invalid document identifier or fields');
    return;
  }
  // Mongoose duplicate key
  const mongoErr = err as { code?: number; keyPattern?: Record<string, unknown> };
  if (mongoErr && mongoErr.code === 11000) {
    fail(res, 409, 'CONFLICT', 'Resource already exists', mongoErr.keyPattern);
    return;
  }
  // eslint-disable-next-line no-console
  console.error('[error]', err);
  fail(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
}

export function notFoundHandler(_req: Request, res: Response): void {
  fail(res, 404, 'NOT_FOUND', 'Route not found');
}

/** Wrap async route handlers so rejections reach the error handler. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
