import type { Request, Response } from 'express';
import { validatedPart } from '../../shared/http/validate.js';
import type { UpdateSettingsBody } from './settings.schemas.js';
import type { SettingsService } from './settings.service.js';

// HTTP <-> service mapping only (03 §2).
export function createSettingsController(settings: SettingsService) {
  return {
    getPublic: async (_req: Request, res: Response) => {
      res.json(await settings.getPublic());
    },
    get: async (_req: Request, res: Response) => {
      res.json(await settings.get());
    },
    update: async (req: Request, res: Response) => {
      res.json(await settings.update(validatedPart<UpdateSettingsBody>(req, 'body')));
    },
  };
}

export type SettingsController = ReturnType<typeof createSettingsController>;
