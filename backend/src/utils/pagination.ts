import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function pageMeta(page: number, limit: number, total: number): PageMeta {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

/** Cursor pagination for large collections (createdAt + _id). */
export const cursorSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export function decodeCursor(cursor?: string): { before?: Date; beforeId?: string } {
  if (!cursor) return {};
  try {
    const raw = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { t?: string; id?: string };
    return { before: raw.t ? new Date(raw.t) : undefined, beforeId: raw.id };
  } catch {
    return {};
  }
}

export function encodeCursor(date: Date, id: string): string {
  return Buffer.from(JSON.stringify({ t: date.toISOString(), id }), 'utf8').toString('base64url');
}
