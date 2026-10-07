import type { Services } from '../../modules/index.js';
import type { NotificationSender } from '../../modules/notifications/notifications.sender.js';
import type { Logger } from '../../shared/logger/index.js';
import type { ConsumerHandlers } from '../registerConsumers.js';
import { createCacheInvalidationConsumer } from './cacheInvalidation.consumer.js';
import { createNotificationsConsumer } from './notifications.consumer.js';
import { createRatingsConsumer } from './ratings.consumer.js';
import { createStaffNotificationsConsumer } from './staffNotifications.consumer.js';
import { createStatsConsumer } from './stats.consumer.js';

// Every consumer (09 §5), built on the module services.
export function buildConsumerHandlers(deps: {
  services: Pick<
    Services,
    'bookings' | 'users' | 'staff' | 'settings' | 'cache' | 'reviews' | 'reports'
  >;
  sender: NotificationSender;
  appBaseUrl: string;
  encryptionKey: string;
  logger: Logger;
}): ConsumerHandlers {
  const { services, sender, appBaseUrl, logger } = deps;
  const { bookings, users, staff, settings, cache, reviews, reports } = services;
  return {
    notifications: createNotificationsConsumer({
      bookings,
      users,
      staff,
      settings,
      sender,
      appBaseUrl,
      encryptionKey: deps.encryptionKey,
      logger,
    }),
    'staff-notifications': createStaffNotificationsConsumer({
      bookings,
      users,
      staff,
      settings,
      sender,
      appBaseUrl,
      logger,
    }),
    'cache-invalidation': createCacheInvalidationConsumer({ cache, settings, bookings, logger }),
    ratings: createRatingsConsumer({ reviews, logger }),
    stats: createStatsConsumer({ reports, bookings, settings, logger }),
  };
}
