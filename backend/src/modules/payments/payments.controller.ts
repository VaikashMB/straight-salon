import type { Request, Response } from 'express';
import { requireAuth } from '../../shared/auth/middleware.js';
import { validatedPart } from '../../shared/http/validate.js';
import type { RecordPaymentBody } from './payments.schemas.js';
import type { PaymentsService } from './payments.service.js';

// HTTP <-> service mapping only (03 §2).
export function createPaymentsController(payments: PaymentsService) {
  return {
    record: async (req: Request, res: Response) => {
      const { id } = validatedPart<{ id: string }>(req, 'params');
      res.json(
        await payments.record(id, validatedPart<RecordPaymentBody>(req, 'body'), requireAuth(req)),
      );
    },
  };
}

export type PaymentsController = ReturnType<typeof createPaymentsController>;
