import type { ClientSession } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import { runWithContext } from '../../http/requestContext.js';
import { createManualClock } from '../../time/clock.js';
import type { AuditRepository } from '../audit.repository.js';
import { createAuditService, SYSTEM_ACTOR } from '../audit.service.js';
import type { AuditLogDoc } from '../auditLog.model.js';

const session = {} as ClientSession;

function setup() {
  const inserted: AuditLogDoc[] = [];
  const insert = vi.fn((entry: AuditLogDoc) => {
    inserted.push(entry);
    return Promise.resolve();
  });
  const repository: AuditRepository = { insert, find: vi.fn(), count: vi.fn() };
  const clock = createManualClock('2026-10-06T09:12:44.123Z');
  return { service: createAuditService({ repository, clock }), inserted, insert };
}

describe('auditService.record (07 §2)', () => {
  it('records actor and requestId from the request context, with only changed fields', async () => {
    const { service, inserted, insert } = setup();
    await runWithContext(
      {
        requestId: 'req-1',
        userId: 'u-9',
        role: 'RECEPTIONIST',
        ip: '10.0.0.5',
        userAgent: 'Firefox',
      },
      () =>
        service.record(
          {
            action: 'booking.cancel',
            entityType: 'booking',
            entityId: 'b-1',
            before: { status: 'BOOKED', notes: 'unchanged' },
            after: {
              status: 'CANCELLED',
              notes: 'unchanged',
              cancellation: { reason: 'Customer called', overridden: true },
            },
            metadata: { override: true },
          },
          session,
        ),
    );

    expect(insert).toHaveBeenCalledWith(expect.any(Object), session);
    expect(inserted[0]).toEqual({
      at: new Date('2026-10-06T09:12:44.123Z'),
      actor: { id: 'u-9', role: 'RECEPTIONIST', ip: '10.0.0.5', userAgent: 'Firefox' },
      action: 'booking.cancel',
      entityType: 'booking',
      entityId: 'b-1',
      before: { status: 'BOOKED' },
      after: { status: 'CANCELLED', cancellation: { reason: 'Customer called', overridden: true } },
      diff: ['cancellation', 'status'],
      requestId: 'req-1',
      metadata: { override: true },
    });
  });

  it('masks email/phone for user entities', async () => {
    const { service, inserted } = setup();
    await service.record(
      {
        action: 'user.create',
        entityType: 'user',
        entityId: 'u-1',
        before: null,
        after: { name: 'Ananya', email: 'ananya@x.com', phone: '+919876543212' },
      },
      session,
    );
    expect(inserted[0]?.before).toBeNull();
    expect(inserted[0]?.after).toEqual({
      name: 'Ananya',
      email: 'a***@x.com',
      phone: '+9198******12',
    });
    expect(inserted[0]?.diff).toEqual(['email', 'name', 'phone']);
  });

  it('does not mask other entities', async () => {
    const { service, inserted } = setup();
    await service.record(
      {
        action: 'settings.update',
        entityType: 'settings',
        entityId: 'salon',
        before: { email: 'old@s.in' },
        after: { email: 'new@s.in' },
      },
      session,
    );
    expect(inserted[0]?.after).toEqual({ email: 'new@s.in' });
  });

  it('uses the system actor for jobs and an anonymous actor outside any context', async () => {
    const { service, inserted } = setup();
    await service.record(
      {
        action: 'booking.status_change',
        entityType: 'booking',
        entityId: 'b-2',
        before: { status: 'BOOKED' },
        after: { status: 'NO_SHOW' },
        actor: SYSTEM_ACTOR,
      },
      session,
    );
    await service.record(
      {
        action: 'holiday.delete',
        entityType: 'holiday',
        entityId: 'h-1',
        before: { date: '2026-11-01' },
        after: null,
      },
      session,
    );
    expect(inserted[0]?.actor).toEqual({ id: 'system', role: 'SYSTEM' });
    expect(inserted[1]?.actor).toEqual({ id: 'anonymous', role: 'ANONYMOUS' });
    expect(inserted[1]).not.toHaveProperty('requestId');
    expect(inserted[1]?.after).toBeNull();
    expect(inserted[1]?.diff).toEqual(['date']);
  });
});
