import mongoose, { Schema, type Types } from 'mongoose';

// audit_logs (02-database §2.14), append-only. The app's DB role can only insert and find here
// (infra/docker/mongo-init.js), and the repository exposes nothing else (07 §2.3).
export interface AuditActor {
  id: string;
  role: string;
  ip?: string;
  userAgent?: string;
}

export interface AuditLogDoc {
  at: Date;
  actor: AuditActor;
  action: string;
  entityType: string;
  entityId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  diff: string[];
  requestId?: string;
  metadata?: Record<string, unknown>;
}

// A stored row, as read back.
export type AuditLogRecord = AuditLogDoc & { _id: Types.ObjectId };

const auditLogSchema = new Schema<AuditLogDoc>(
  {
    at: { type: Date, required: true },
    actor: {
      id: { type: String, required: true },
      role: { type: String, required: true },
      ip: String,
      userAgent: String,
    },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String, required: true },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    diff: { type: [String], default: [] },
    requestId: String,
    metadata: Schema.Types.Mixed,
  },
  { collection: 'audit_logs', versionKey: false, minimize: false },
);

auditLogSchema.index({ entityType: 1, entityId: 1, at: -1 });
auditLogSchema.index({ 'actor.id': 1, at: -1 });
auditLogSchema.index({ action: 1, at: -1 });
auditLogSchema.index({ at: -1 });

export const AuditLogModel =
  (mongoose.models.AuditLog as mongoose.Model<AuditLogDoc> | undefined) ??
  mongoose.model<AuditLogDoc>('AuditLog', auditLogSchema);
