import type { ClientSession } from 'mongoose';
import { getRequestContext } from '../http/requestContext.js';
import { systemClock, type Clock } from '../time/clock.js';
import type { AuditRepository } from './audit.repository.js';
import type { AuditActor } from './auditLog.model.js';
import { diffPaths, pickTopLevel } from './diff.js';
import { maskPii } from './mask.js';

// Writes one audit row per business mutation (07 §2), inside the SAME transaction as the change
// so neither can commit without the other. The actor and requestId come from the request
// context; jobs pass SYSTEM_ACTOR explicitly.

export const SYSTEM_ACTOR: AuditActor = { id: 'system', role: 'SYSTEM' };

export interface AuditInput {
  action: string; // e.g. "booking.cancel"
  entityType: string; // e.g. "booking"
  entityId: string;
  before?: Record<string, unknown> | null; // full or partial previous state; null for creates
  after?: Record<string, unknown> | null; // new state; null for deletes
  metadata?: Record<string, unknown>;
  actor?: AuditActor;
}

export interface AuditService {
  // Pass the transaction's session whenever the audited action writes data (07 §2.2). Omit it
  // only for security events that change nothing, e.g. auth.login_failed.
  record(input: AuditInput, session?: ClientSession): Promise<void>;
}

// Entities whose audit rows must have email/phone masked (07 §2.2).
const PII_ENTITIES = new Set(['user']);

function actorFromContext(): AuditActor {
  const ctx = getRequestContext();
  const actor: AuditActor = { id: ctx?.userId ?? 'anonymous', role: ctx?.role ?? 'ANONYMOUS' };
  if (ctx?.ip) actor.ip = ctx.ip;
  if (ctx?.userAgent) actor.userAgent = ctx.userAgent;
  return actor;
}

export function createAuditService({
  repository,
  clock = systemClock,
}: {
  repository: AuditRepository;
  clock?: Clock;
}): AuditService {
  return {
    async record(input, session) {
      const before = input.before ?? null;
      const after = input.after ?? null;
      const diff = diffPaths(before ?? {}, after ?? {});
      const mask = PII_ENTITIES.has(input.entityType) ? maskPii : <T>(v: T) => v;
      const requestId = getRequestContext()?.requestId;

      await repository.insert(
        {
          at: clock.now(),
          actor: input.actor ?? actorFromContext(),
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          before: mask(pickTopLevel(before, diff)),
          after: mask(pickTopLevel(after, diff)),
          diff,
          ...(requestId ? { requestId } : {}),
          ...(input.metadata ? { metadata: input.metadata } : {}),
        },
        session,
      );
    },
  };
}
