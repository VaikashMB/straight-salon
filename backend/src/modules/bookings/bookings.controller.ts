import type { Request, Response } from 'express';
import { requireAuth } from '../../shared/auth/middleware.js';
import { validatedPart } from '../../shared/http/validate.js';
import type {
  CancelBody,
  CreateBookingBody,
  ListBookingsQuery,
  MyBookingsQuery,
  RescheduleBody,
  StatusBody,
} from './bookings.schemas.js';
import type { BookingsService } from './bookings.service.js';

// HTTP <-> service mapping only (03 §2).
export function createBookingsController(bookings: BookingsService) {
  const id = (req: Request) => validatedPart<{ id: string }>(req, 'params').id;

  return {
    create: async (req: Request, res: Response) => {
      res
        .status(201)
        .json(
          await bookings.create(validatedPart<CreateBookingBody>(req, 'body'), requireAuth(req)),
        );
    },
    listMine: async (req: Request, res: Response) => {
      res.json(
        await bookings.listMine(validatedPart<MyBookingsQuery>(req, 'query'), requireAuth(req)),
      );
    },
    list: async (req: Request, res: Response) => {
      res.json(
        await bookings.list(validatedPart<ListBookingsQuery>(req, 'query'), requireAuth(req)),
      );
    },
    get: async (req: Request, res: Response) => {
      res.json(await bookings.get(id(req), requireAuth(req)));
    },
    reschedule: async (req: Request, res: Response) => {
      res.json(
        await bookings.reschedule(
          id(req),
          validatedPart<RescheduleBody>(req, 'body'),
          requireAuth(req),
        ),
      );
    },
    cancel: async (req: Request, res: Response) => {
      res.json(
        await bookings.cancel(id(req), validatedPart<CancelBody>(req, 'body'), requireAuth(req)),
      );
    },
    changeStatus: async (req: Request, res: Response) => {
      res.json(
        await bookings.changeStatus(
          id(req),
          validatedPart<StatusBody>(req, 'body'),
          requireAuth(req),
        ),
      );
    },
    history: async (req: Request, res: Response) => {
      res.json(await bookings.history(id(req)));
    },
  };
}

export type BookingsController = ReturnType<typeof createBookingsController>;
