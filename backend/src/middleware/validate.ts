import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

/**
 * Validate request parts against a Zod schema.
 * `source`: 'body' | 'query' | 'params' | 'all'
 * On success, validated data replaces the request part.
 */
export function validate(schema: ZodSchema, source: 'body' | 'query' | 'params' | 'all' = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (source === 'all') {
        const data = schema.parse({ body: req.body, query: req.query, params: req.params });
        req.body = (data as { body: unknown }).body;
        req.query = (data as { query: unknown }).query as Request['query'];
        req.params = (data as { params: unknown }).params as Request['params'];
      } else if (source === 'body') {
        req.body = schema.parse(req.body ?? {});
      } else if (source === 'query') {
        req.query = schema.parse(req.query) as Request['query'];
      } else {
        req.params = schema.parse(req.params) as Request['params'];
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Strip MongoDB operator keys from user input (NoSQL injection guard). */
export function sanitizeInput(req: Request, _res: Response, next: NextFunction): void {
  const clean = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (k.startsWith('$') || k.includes('.')) continue;
        out[k] = clean(v);
      }
      return out;
    }
    return value;
  };
  if (req.body) req.body = clean(req.body);
  if (req.query) req.query = clean(req.query) as Request['query'];
  next();
}
