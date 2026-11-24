import { pageMeta, encodeCursor, decodeCursor } from '../../src/utils/pagination';

describe('pagination', () => {
  it('computes page meta', () => {
    expect(pageMeta(1, 20, 100)).toEqual({ page: 1, limit: 20, total: 100, totalPages: 5 });
    expect(pageMeta(3, 20, 41).totalPages).toBe(3);
    expect(pageMeta(1, 20, 0).totalPages).toBe(1);
  });

  it('round-trips cursor', () => {
    const date = new Date('2026-01-15T10:00:00.000Z');
    const cursor = encodeCursor(date, 'abc123');
    const decoded = decodeCursor(cursor);
    expect(decoded.before?.toISOString()).toBe(date.toISOString());
    expect(decoded.beforeId).toBe('abc123');
  });

  it('handles invalid cursor gracefully', () => {
    expect(decodeCursor('not-a-cursor')).toEqual({});
    expect(decodeCursor(undefined)).toEqual({});
  });
});
