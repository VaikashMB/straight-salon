import type { Request, Response } from 'express';
import { validatedPart } from '../../shared/http/validate.js';
import type { CreateHolidayBody, ListHolidaysQuery } from './holidays.schemas.js';
import type { HolidaysService } from './holidays.service.js';

// HTTP <-> service mapping only (03 §2).
export function createHolidaysController(holidays: HolidaysService) {
  return {
    list: async (req: Request, res: Response) => {
      res.json(await holidays.list(validatedPart<ListHolidaysQuery>(req, 'query')));
    },
    create: async (req: Request, res: Response) => {
      res.status(201).json(await holidays.create(validatedPart<CreateHolidayBody>(req, 'body')));
    },
    delete: async (req: Request, res: Response) => {
      await holidays.delete(validatedPart<{ id: string }>(req, 'params').id);
      res.status(204).end();
    },
  };
}

export type HolidaysController = ReturnType<typeof createHolidaysController>;
