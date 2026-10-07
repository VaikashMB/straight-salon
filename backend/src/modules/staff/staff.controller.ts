import type { Request, Response } from 'express';
import { requireAuth } from '../../shared/auth/middleware.js';
import { validatedPart } from '../../shared/http/validate.js';
import type {
  CreateStaffBody,
  CreateTimeOffBody,
  ListStaffQuery,
  ListTimeOffQuery,
  PutScheduleBody,
  UpdateStaffBody,
} from './staff.schemas.js';
import type { StaffService } from './staff.service.js';

// HTTP <-> service mapping only (03 §2).
export function createStaffController(staff: StaffService) {
  const id = (req: Request) => validatedPart<{ id: string }>(req, 'params').id;

  return {
    list: async (req: Request, res: Response) => {
      res.json(await staff.list(validatedPart<ListStaffQuery>(req, 'query'), req.auth));
    },
    get: async (req: Request, res: Response) => {
      res.json(await staff.getProfile(id(req), req.auth));
    },
    create: async (req: Request, res: Response) => {
      res.status(201).json(await staff.create(validatedPart<CreateStaffBody>(req, 'body')));
    },
    update: async (req: Request, res: Response) => {
      res.json(await staff.update(id(req), validatedPart<UpdateStaffBody>(req, 'body')));
    },
    getSchedule: async (req: Request, res: Response) => {
      res.json(await staff.getSchedule(id(req), requireAuth(req)));
    },
    putSchedule: async (req: Request, res: Response) => {
      res.json(await staff.putSchedule(id(req), validatedPart<PutScheduleBody>(req, 'body')));
    },
    listTimeOff: async (req: Request, res: Response) => {
      res.json(
        await staff.listTimeOff(
          id(req),
          validatedPart<ListTimeOffQuery>(req, 'query'),
          requireAuth(req),
        ),
      );
    },
    createTimeOff: async (req: Request, res: Response) => {
      res
        .status(201)
        .json(
          await staff.createTimeOff(
            id(req),
            validatedPart<CreateTimeOffBody>(req, 'body'),
            requireAuth(req),
          ),
        );
    },
    deleteTimeOff: async (req: Request, res: Response) => {
      const params = validatedPart<{ id: string; timeOffId: string }>(req, 'params');
      await staff.deleteTimeOff(params.id, params.timeOffId, requireAuth(req));
      res.status(204).end();
    },
  };
}

export type StaffController = ReturnType<typeof createStaffController>;
