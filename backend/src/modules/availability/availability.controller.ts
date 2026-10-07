import type { Request, Response } from 'express';
import { validatedPart } from '../../shared/http/validate.js';
import type { AvailabilityQuery, AvailableDaysQuery } from './availability.schemas.js';
import type { AvailabilityService } from './availability.service.js';

// HTTP <-> service mapping only (03 §2).
export function createAvailabilityController(availability: AvailabilityService) {
  return {
    slots: async (req: Request, res: Response) => {
      res.json(await availability.slots(validatedPart<AvailabilityQuery>(req, 'query'), req.auth));
    },
    days: async (req: Request, res: Response) => {
      res.json(await availability.days(validatedPart<AvailableDaysQuery>(req, 'query'), req.auth));
    },
  };
}

export type AvailabilityController = ReturnType<typeof createAvailabilityController>;
