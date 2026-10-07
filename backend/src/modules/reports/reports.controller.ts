import type { Request, Response } from 'express';
import { validatedPart } from '../../shared/http/validate.js';
import type { DashboardQuery, SummaryQuery } from './reports.schemas.js';
import type { ReportsService } from './reports.service.js';

// HTTP <-> service mapping only (03 §2).
export function createReportsController(reports: ReportsService) {
  return {
    dashboard: async (req: Request, res: Response) => {
      res.json(await reports.dashboard(validatedPart<DashboardQuery>(req, 'query')));
    },
    summary: async (req: Request, res: Response) => {
      res.json(await reports.summary(validatedPart<SummaryQuery>(req, 'query')));
    },
    summaryCsv: async (req: Request, res: Response) => {
      const { filename, csv } = await reports.summaryCsv(validatedPart<SummaryQuery>(req, 'query'));
      res.type('text/csv; charset=utf-8').attachment(filename).send(csv);
    },
  };
}

export type ReportsController = ReturnType<typeof createReportsController>;
