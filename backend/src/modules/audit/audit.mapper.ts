import type { AuditLogRecord } from '../../shared/audit/auditLog.model.js';
import type { AuditLogDto } from './audit.schemas.js';

// Model -> DTO.
export function toAuditLogDto(row: AuditLogRecord): AuditLogDto {
  const actor: AuditLogDto['actor'] = { id: row.actor.id, role: row.actor.role };
  if (row.actor.ip) actor.ip = row.actor.ip;
  if (row.actor.userAgent) actor.userAgent = row.actor.userAgent;
  return {
    id: row._id.toHexString(),
    at: row.at.toISOString(),
    actor,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    before: row.before,
    after: row.after,
    diff: row.diff,
    ...(row.requestId ? { requestId: row.requestId } : {}),
    ...(row.metadata ? { metadata: row.metadata } : {}),
  };
}
