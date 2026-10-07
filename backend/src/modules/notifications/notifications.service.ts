import { paginated, skipFor, type Paginated } from '../../shared/http/pagination.js';
import { toNotificationDto } from './notifications.mapper.js';
import type { NotificationsRepository } from './notifications.repository.js';
import type {
  ListMyNotificationsQuery,
  ListNotificationsQuery,
  NotificationDto,
} from './notifications.schemas.js';

// Notification history (API-065, API-066). Sending lives in notifications.sender.ts and runs in
// the worker (09 §5).

export interface NotificationsService {
  listMine(userId: string, query: ListMyNotificationsQuery): Promise<Paginated<NotificationDto>>;
  list(query: ListNotificationsQuery): Promise<Paginated<NotificationDto>>;
}

export function createNotificationsService(deps: {
  repository: NotificationsRepository;
}): NotificationsService {
  const { repository } = deps;
  return {
    async listMine(userId, query) {
      const result = await repository.search({
        userId,
        skip: skipFor(query),
        limit: query.pageSize,
      });
      return paginated(
        result.data.map((doc) => toNotificationDto(doc, { admin: false })),
        result.total,
        query,
      );
    },

    async list({ page, pageSize, ...filters }) {
      const query = { page, pageSize };
      const result = await repository.search({
        ...filters,
        skip: skipFor(query),
        limit: pageSize,
      });
      return paginated(
        result.data.map((doc) => toNotificationDto(doc, { admin: true })),
        result.total,
        query,
      );
    },
  };
}
