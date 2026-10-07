import { paginated, skipFor, type Paginated } from '../../shared/http/pagination.js';
import { addDays, startOfZonedDay } from '../../shared/time/tz.js';
import type { SettingsService } from '../settings/settings.service.js';
import { toAuditLogDto } from './audit.mapper.js';
import type { AuditLogsRepository } from './audit.repository.js';
import type { AuditLogDto, ListAuditLogsQuery } from './audit.schemas.js';

// Read API over audit_logs (API-073, FR-073). Writing happens in shared/audit inside each
// business transaction (07 §2); reading is not itself audited in v1 (07 §2.3).

export interface AuditLogsService {
  list(query: ListAuditLogsQuery): Promise<Paginated<AuditLogDto>>;
}

export function createAuditLogsService(deps: {
  repository: AuditLogsRepository;
  settings: Pick<SettingsService, 'get'>;
}): AuditLogsService {
  const { repository, settings } = deps;
  return {
    async list({ page, pageSize, from, to, ...filters }) {
      const { timezone } = await settings.get();
      const result = await repository.search({
        ...filters,
        // Salon-local dates, inclusive (04 §1).
        ...(from ? { from: startOfZonedDay(from, timezone) } : {}),
        ...(to ? { to: startOfZonedDay(addDays(to, 1), timezone) } : {}),
        skip: skipFor({ page, pageSize }),
        limit: pageSize,
      });
      return paginated(result.data.map(toAuditLogDto), result.total, { page, pageSize });
    },
  };
}
