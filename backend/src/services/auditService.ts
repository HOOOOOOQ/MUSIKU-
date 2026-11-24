import { AuditLog, SystemEvent } from '../models';

/** Audit trail for admin + security-sensitive actions. */
export const auditService = {
  async log(actor: string | undefined, action: string, targetType = '', targetId = '', details?: unknown, ip = '') {
    try {
      await AuditLog.create({ actor, action, targetType, targetId, details, ip });
    } catch {
      /* audit failures must never break the request path */
    }
  },

  async event(level: 'info' | 'warn' | 'error', source: string, message: string, details?: unknown) {
    try {
      await SystemEvent.create({ level, source, message, details });
    } catch {
      /* ignore */
    }
  },
};
