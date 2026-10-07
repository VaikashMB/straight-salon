import type { Request, Response } from 'express';
import { requireAuth } from '../../shared/auth/middleware.js';
import { validatedPart } from '../../shared/http/validate.js';
import type { ListMyNotificationsQuery, ListNotificationsQuery } from './notifications.schemas.js';
import type { NotificationsService } from './notifications.service.js';

// HTTP <-> service mapping only (03 §2).
export function createNotificationsController(notifications: NotificationsService) {
  return {
    listMine: async (req: Request, res: Response) => {
      res.json(
        await notifications.listMine(
          requireAuth(req).userId,
          validatedPart<ListMyNotificationsQuery>(req, 'query'),
        ),
      );
    },
    list: async (req: Request, res: Response) => {
      res.json(await notifications.list(validatedPart<ListNotificationsQuery>(req, 'query')));
    },
  };
}

export type NotificationsController = ReturnType<typeof createNotificationsController>;
