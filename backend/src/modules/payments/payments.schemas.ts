import { z } from '../../docs/zod.js';
import { PaymentMethodSchema } from '../bookings/bookings.schemas.js';

// API-057 (BR-011, FR-043)
export const RecordPaymentBodySchema = z
  .object({
    method: PaymentMethodSchema,
    amountPaidMinor: z.number().int().min(0).max(100_000_000).openapi({ example: 50_000 }),
    discountMinor: z.number().int().min(0).max(100_000_000).optional().openapi({ example: 5_000 }),
    discountReason: z.string().trim().min(1).max(200).optional().openapi({ example: 'Loyalty' }),
  })
  .strict()
  .refine((body) => !body.discountMinor || Boolean(body.discountReason), {
    error: 'A discount needs a reason (BR-011)',
    path: ['discountReason'],
  });

export type RecordPaymentBody = z.infer<typeof RecordPaymentBodySchema>;
