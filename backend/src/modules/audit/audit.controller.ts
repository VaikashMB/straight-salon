import type { Request, Response } from 'express';
import { validatedPart } from '../../shared/http/validate.js';
import type { ListAuditLogsQuery } from './audit.schemas.js';
import type { AuditLogsService } from './audit.service.js';

// HTTP <-> service mapping only (03 §2).
export function createAuditController(auditLogs: AuditLogsService) {
  return {
    list: async (req: Request, res: Response) => {
      res.json(await auditLogs.list(validatedPart<ListAuditLogsQuery>(req, 'query')));
    },
  };
}

export type AuditController = ReturnType<typeof createAuditController>;
