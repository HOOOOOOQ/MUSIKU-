import mongoose, { Schema } from 'mongoose';

/* ── admin_users / admin_roles ───────────────────────────────────────────
 * Admins are Users with role=admin; these collections hold the extended
 * admin profile and role definitions. */

const adminRoleSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, index: true },
    permissions: { type: [String], default: [] },
    description: { type: String, default: '' },
  },
  { timestamps: true },
);
export const AdminRole = mongoose.model('AdminRole', adminRoleSchema, 'admin_roles');

const adminUserSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    role: { type: Schema.Types.ObjectId, ref: 'AdminRole', default: undefined },
    mfaEnabled: { type: Boolean, default: false },
    lastAdminLoginAt: { type: Date, default: undefined },
  },
  { timestamps: true },
);
export const AdminUser = mongoose.model('AdminUser', adminUserSchema, 'admin_users');

/* ── audit_logs ────────────────────────────────────────────────────────── */
const auditLogSchema = new Schema(
  {
    actor: { type: Schema.Types.ObjectId, ref: 'User', default: undefined, index: true },
    action: { type: String, required: true, index: true },
    targetType: { type: String, default: '' },
    targetId: { type: String, default: '' },
    details: { type: Schema.Types.Mixed, default: undefined },
    ip: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
auditLogSchema.index({ actor: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
export const AuditLog = mongoose.model('AuditLog', auditLogSchema, 'audit_logs');

/* ── reports / moderation_logs / system_events ─────────────────────────── */
const reportSchema = new Schema(
  {
    reporter: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    targetType: { type: String, required: true },
    targetId: { type: String, required: true },
    reason: { type: String, required: true },
    status: { type: String, enum: ['open', 'reviewing', 'resolved', 'dismissed'], default: 'open', index: true },
    handledBy: { type: Schema.Types.ObjectId, ref: 'User', default: undefined },
  },
  { timestamps: true },
);
reportSchema.index({ status: 1, createdAt: -1 });
export const Report = mongoose.model('Report', reportSchema, 'reports');

const moderationLogSchema = new Schema(
  {
    moderator: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    action: { type: String, required: true },
    targetType: { type: String, default: '' },
    targetId: { type: String, default: '' },
    reason: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
moderationLogSchema.index({ moderator: 1, createdAt: -1 });
export const ModerationLog = mongoose.model('ModerationLog', moderationLogSchema, 'moderation_logs');

const systemEventSchema = new Schema(
  {
    level: { type: String, enum: ['info', 'warn', 'error'], default: 'info', index: true },
    source: { type: String, required: true, index: true },
    message: { type: String, required: true },
    details: { type: Schema.Types.Mixed, default: undefined },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
systemEventSchema.index({ source: 1, createdAt: -1 });
systemEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 }); // 90d TTL
export const SystemEvent = mongoose.model('SystemEvent', systemEventSchema, 'system_events');
