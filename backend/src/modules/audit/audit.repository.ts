import mongoose, { type QueryFilter } from 'mongoose';
import {
  AuditLogModel,
  type AuditLogDoc,
  type AuditLogRecord,
} from '../../shared/audit/auditLog.model.js';

// Read-only access for the audit log API (API-073). Writes stay in shared/audit, whose
// repository can only insert (07 §2.3); this one can only search.

// Each filter is served by one of the audit_logs indexes (02 §2.14).
export interface AuditSearch {
  entityType?: string;
  entityId?: string;
  actorId?: string;
  action?: string;
  from?: Date; // at >= from
  to?: Date; // at < to
  skip: number;
  limit: number;
}

export interface AuditLogsRepository {
  // Newest first.
  search(search: AuditSearch): Promise<{ data: AuditLogRecord[]; total: number }>;
}

export function auditSearchFilter(
  search: Omit<AuditSearch, 'skip' | 'limit'>,
): QueryFilter<AuditLogDoc> {
  const filter: QueryFilter<AuditLogDoc> = {};
  if (search.entityType) filter.entityType = search.entityType;
  if (search.entityId) filter.entityId = search.entityId;
  if (search.actorId) filter['actor.id'] = search.actorId;
  if (search.action) filter.action = search.action;
  if (search.from || search.to) {
    filter.at = mongoose.trusted({
      ...(search.from ? { $gte: search.from } : {}),
      ...(search.to ? { $lt: search.to } : {}),
    });
  }
  return filter;
}

export const auditLogsRepository: AuditLogsRepository = {
  async search({ skip, limit, ...criteria }) {
    const filter = auditSearchFilter(criteria);
    const [data, total] = await Promise.all([
      AuditLogModel.find(filter)
        .sort({ at: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean<AuditLogRecord[]>(),
      AuditLogModel.countDocuments(filter),
    ]);
    return { data, total };
  },
};
