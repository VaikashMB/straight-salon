import { randomUUID } from 'node:crypto';
import RedisMock from 'ioredis-mock';
import mongoose from 'mongoose';
import { buildServices } from '../../src/modules/index.js';
import { NotificationModel } from '../../src/modules/notifications/notifications.model.js';
import { notificationsRepository } from '../../src/modules/notifications/notifications.repository.js';
import { createNotificationSender } from '../../src/modules/notifications/notifications.sender.js';
import type {
  EmailMessage,
  EmailProvider,
  SmsMessage,
  SmsProvider,
} from '../../src/modules/notifications/providers/index.js';
import { createInMemoryEventBus } from '../../src/shared/events/inMemoryEventBus.js';
import { outboxRepository } from '../../src/shared/events/outbox.repository.js';
import { createOutboxRelay } from '../../src/shared/events/relay.js';
import { createMetrics } from '../../src/shared/metrics/index.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { buildConsumerHandlers } from '../../src/workers/consumers/index.js';
import { registerConsumers } from '../../src/workers/registerConsumers.js';
import { encryptionKey } from '../factories/index.js';
import { testModulesConfig } from '../setup/testApp.js';
import { captureLogger } from './logger.js';
import { createMemoryStorage } from './storage.js';

// The worker process on the test database (10-testing §3): real services, consumers and relay,
// an in-memory bus (publish runs the consumers synchronously) and recording providers.
// Share `redis` and `key` with buildApiTestApp so caches and encrypted secrets line up.

export const APP_BASE_URL = 'http://salon.test';

export function recordingProviders() {
  const emails: EmailMessage[] = [];
  const texts: SmsMessage[] = [];
  let failures = 0;
  const maybeFail = () => {
    if (failures > 0) {
      failures--;
      throw new Error('Provider unavailable');
    }
  };
  const email: EmailProvider = {
    name: 'test',
    send(message) {
      maybeFail();
      emails.push(message);
      return Promise.resolve({ messageId: `email-${emails.length}` });
    },
    close: () => Promise.resolve(),
  };
  const sms: SmsProvider = {
    name: 'test',
    send(message) {
      maybeFail();
      texts.push(message);
      return Promise.resolve({ messageId: `sms-${texts.length}` });
    },
    close: () => Promise.resolve(),
  };
  return {
    email,
    sms,
    emails,
    texts,
    failNext: (count = 1) => {
      failures = count;
    },
  };
}

export function buildWorkerHarness(options: {
  clock: Clock;
  redis?: InstanceType<typeof RedisMock>;
  key?: string;
}) {
  const redis = options.redis ?? new RedisMock({ host: `worker-${randomUUID()}` });
  const key = options.key ?? encryptionKey();
  const { logger, lines } = captureLogger();
  const services = buildServices({
    connection: mongoose.connection,
    redis,
    clock: options.clock,
    logger,
    metrics: createMetrics({ defaultMetrics: false }),
    storage: createMemoryStorage(),
    config: testModulesConfig({ outboxEncryptionKey: key }),
  });
  const providers = recordingProviders();
  const sender = createNotificationSender({
    repository: notificationsRepository,
    email: providers.email,
    sms: providers.sms,
    clock: options.clock,
    logger,
  });
  const bus = createInMemoryEventBus();
  registerConsumers(
    bus,
    buildConsumerHandlers({
      services,
      sender,
      appBaseUrl: APP_BASE_URL,
      encryptionKey: key,
      logger,
    }),
    { logger, clock: options.clock },
  );
  const relay = createOutboxRelay({
    repository: outboxRepository,
    bus,
    logger,
    clock: options.clock,
  });
  return {
    services,
    bus,
    relay,
    providers,
    redis,
    key,
    logs: lines,
    // Relays everything pending (as the worker does within ~500 ms).
    drain: () => relay.runOnce(),
    notifications: () => NotificationModel.find().sort({ createdAt: 1, _id: 1 }).lean(),
  };
}
