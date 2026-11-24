import { Response } from 'express';

/** Standard success envelope: { success, data, meta? } */
export function ok(res: Response, data: unknown, status = 200, meta?: Record<string, unknown>): Response {
  return res.status(status).json({ success: true, data, ...(meta ? { meta } : {}) });
}

export function created(res: Response, data: unknown): Response {
  return ok(res, data, 201);
}

/** Standard error envelope: { success:false, error:{ code, message, details? } } */
export function fail(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): Response {
  return res.status(status).json({ success: false, error: { code, message, ...(details !== undefined ? { details } : {}) } });
}

/** 501 for integrations that need credentials — never fake success. */
export function needsCredentials(res: Response, integration: string, missing: string[]): Response {
  return fail(res, 501, 'NEEDS_CREDENTIALS', `${integration} is not configured`, {
    integration,
    missing,
    hint: 'Set the required environment variables on the backend (see backend/.env.example).',
  });
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const badRequest = (msg: string, details?: unknown) => new ApiError(400, 'BAD_REQUEST', msg, details);
export const unauthorized = (msg = 'Authentication required') => new ApiError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'Forbidden') => new ApiError(403, 'FORBIDDEN', msg);
export const notFound = (msg = 'Resource not found') => new ApiError(404, 'NOT_FOUND', msg);
export const conflict = (msg: string) => new ApiError(409, 'CONFLICT', msg);
