import type { ClientSession, QueryFilter } from 'mongoose';
import { AuditLogModel, type AuditLogDoc } from './auditLog.model.js';

// Insert and find only: no update or delete exists in code (07 §2.3).
export interface AuditRepository {
  // session: the business transaction; omitted only for events with no data change (failed login).
  insert(entry: AuditLogDoc, session?: ClientSession): Promise<void>;
  find(
    filter: QueryFilter<AuditLogDoc>,
    options: { skip: number; limit: number; sort?: Record<string, 1 | -1> },
  ): Promise<AuditLogDoc[]>;
  count(filter: QueryFilter<AuditLogDoc>): Promise<number>;
}

export const auditRepository: AuditRepository = {
  async insert(entry, session) {
    await AuditLogModel.create([entry], session ? { session } : {});
  },
  async find(filter, { skip, limit, sort = { at: -1 } }) {
    return AuditLogModel.find(filter).sort(sort).skip(skip).limit(limit).lean<AuditLogDoc[]>();
  },
  async count(filter) {
    return AuditLogModel.countDocuments(filter);
  },
};
