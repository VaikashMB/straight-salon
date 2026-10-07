import { Types } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import { createManualClock } from '../../../shared/time/clock.js';
import { createLogger } from '../../../shared/logger/index.js';
import type { NotificationDoc } from '../notifications.model.js';
import type { NewNotification, NotificationsRepository } from '../notifications.repository.js';
import { createNotificationSender, dedupeKeyFor, REDACTED } from '../notifications.sender.js';
import type {
  EmailMessage,
  EmailProvider,
  SentMessage,
  SmsMessage,
  SmsProvider,
} from '../providers/index.js';

const logger = createLogger({
  level: 'silent',
  pretty: false,
  env: 'test',
  version: 'test',
  processName: 'worker',
});
const clock = createManualClock('2026-10-12T03:30:00.000Z');
const salon = { name: 'Straight Salon' };

// In-memory repository with the same reserve semantics as the Mongo one.
function fakeRepository() {
  const rows = new Map<string, NotificationDoc>();
  const repository: NotificationsRepository = {
    reserve(input: NewNotification) {
      const existing = rows.get(input.dedupeKey);
      if (existing) return Promise.resolve(existing);
      const row = {
        ...input,
        _id: new Types.ObjectId(),
        userId: new Types.ObjectId(input.userId),
        status: 'QUEUED',
        attempts: 0,
        createdAt: clock.now(),
        updatedAt: clock.now(),
      } as NotificationDoc;
      rows.set(input.dedupeKey, row);
      return Promise.resolve(row);
    },
    markSent(id, providerMessageId, at) {
      const row = [...rows.values()].find((r) => r._id.equals(id))!;
      Object.assign(row, {
        status: 'SENT',
        providerMessageId,
        sentAt: at,
        attempts: row.attempts + 1,
      });
      delete row.error;
      return Promise.resolve();
    },
    markFailed(id, error) {
      const row = [...rows.values()].find((r) => r._id.equals(id))!;
      Object.assign(row, { status: 'FAILED', error, attempts: row.attempts + 1 });
      return Promise.resolve();
    },
    search: () => Promise.reject(new Error('not used')),
  };
  return { repository, rows };
}

function providers() {
  const emailSend = vi.fn<(message: EmailMessage) => Promise<SentMessage>>(() =>
    Promise.resolve({ messageId: 'email-1' }),
  );
  const smsSend = vi.fn<(message: SmsMessage) => Promise<SentMessage>>(() =>
    Promise.resolve({ messageId: 'sms-1' }),
  );
  const email: EmailProvider = { name: 'mock', send: emailSend, close: () => Promise.resolve() };
  const sms: SmsProvider = { name: 'mock', send: smsSend, close: () => Promise.resolve() };
  return { email, sms, emailSend, smsSend };
}

const userId = new Types.ObjectId().toHexString();
const welcome = {
  eventId: 'evt-1',
  userId,
  channel: 'EMAIL' as const,
  to: 'ananya@example.com',
  template: 'welcome' as const,
  data: { name: 'Ananya', salon, link: 'https://salon.example/book' },
};

describe('notification sender (09 §5, §6)', () => {
  it('renders, sends and records the message as SENT', async () => {
    const { repository, rows } = fakeRepository();
    const { email, sms, emailSend, smsSend } = providers();
    const sender = createNotificationSender({ repository, email, sms, clock, logger });

    await expect(sender.deliver(welcome)).resolves.toBe('sent');

    expect(emailSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'ananya@example.com', subject: 'Welcome to Straight Salon' }),
    );
    expect(smsSend).not.toHaveBeenCalled();
    const row = rows.get(dedupeKeyFor('evt-1', 'EMAIL', 'welcome'))!;
    expect(row).toMatchObject({
      status: 'SENT',
      provider: 'mock',
      providerMessageId: 'email-1',
      attempts: 1,
      sentAt: clock.now(),
      template: 'welcome',
      to: 'ananya@example.com',
    });
    expect(row.payload.subject).toBe('Welcome to Straight Salon');
    expect(row.payload.html).toContain('<!doctype html>');
  });

  it('a duplicate delivery of the same event, channel and template is a no-op', async () => {
    const { repository } = fakeRepository();
    const { email, sms, emailSend } = providers();
    const sender = createNotificationSender({ repository, email, sms, clock, logger });
    await sender.deliver(welcome);
    await expect(sender.deliver(welcome)).resolves.toBe('already_sent');
    expect(emailSend).toHaveBeenCalledTimes(1);
  });

  it('a provider failure marks the row FAILED and is rethrown so the job retries', async () => {
    const { repository, rows } = fakeRepository();
    const { email, sms, emailSend } = providers();
    emailSend.mockRejectedValueOnce(
      Object.assign(new Error('550 mailbox unavailable ananya@example.com'), { code: 'EENVELOPE' }),
    );
    const sender = createNotificationSender({ repository, email, sms, clock, logger });

    await expect(sender.deliver(welcome)).rejects.toThrow('550');
    const key = dedupeKeyFor('evt-1', 'EMAIL', 'welcome');
    expect(rows.get(key)).toMatchObject({ status: 'FAILED', attempts: 1 });
    expect(rows.get(key)!.error).toContain('550');

    // The retry sends it and clears the error.
    await expect(sender.deliver(welcome)).resolves.toBe('sent');
    expect(rows.get(key)).toMatchObject({ status: 'SENT', attempts: 2 });
    expect(rows.get(key)!.error).toBeUndefined();
  });

  it('sends SMS text through the SMS provider', async () => {
    const { repository, rows } = fakeRepository();
    const { email, sms, smsSend } = providers();
    const sender = createNotificationSender({ repository, email, sms, clock, logger });
    await sender.deliver({ ...welcome, channel: 'SMS', to: '+919876543212' });
    expect(smsSend).toHaveBeenCalledWith({
      to: '+919876543212',
      text: expect.stringContaining('welcome') as string,
    });
    const row = rows.get(dedupeKeyFor('evt-1', 'SMS', 'welcome'))!;
    expect(row.payload).toEqual({ text: expect.any(String) as string });
  });

  it('sends the reset link but never stores it (09 §7)', async () => {
    const { repository, rows } = fakeRepository();
    const { email, sms, emailSend } = providers();
    const sender = createNotificationSender({ repository, email, sms, clock, logger });
    const resetUrl = 'https://salon.example/reset-password?token=s3cr3t';
    await sender.deliver({
      ...welcome,
      template: 'password_reset',
      data: { name: 'Ananya', salon, resetUrl, validMinutes: 30 },
    });
    const sent = emailSend.mock.calls[0]![0];
    expect(sent.text).toContain(resetUrl);
    expect(sent.html).toContain(resetUrl);
    const stored = rows.get(dedupeKeyFor('evt-1', 'EMAIL', 'password_reset'))!.payload;
    expect(JSON.stringify(stored)).not.toContain('s3cr3t');
    expect(stored.text).toContain(REDACTED);
    expect(stored.html).toContain(REDACTED);
  });
});
