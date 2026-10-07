'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/form/form-error';
import { SelectField } from '@/components/form/select-field';
import { TextField } from '@/components/form/text-field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { unwrap } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';
import { errorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/format';
import { toMinor } from '@/lib/money';
import { newIdempotencyKey, type Booking } from '../api';

export const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'CARD', label: 'Card' },
  { value: 'UPI', label: 'UPI' },
  { value: 'OTHER', label: 'Other' },
] as const;

type Method = (typeof PAYMENT_METHODS)[number]['value'];

// FR-043 / API-057. Amount paid + discount must equal the total (BR-011), so the amount paid is
// derived from the discount; a discount needs a reason. Idempotent, like booking creation.
export function PaymentDialog({
  booking,
  open,
  onOpenChange,
}: {
  booking: Booking;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const key = useRef(newIdempotencyKey());
  const { amountMinor: total, currency } = booking.total;
  const [method, setMethod] = useState<Method>('CASH');
  const [discount, setDiscount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const discountMinor = discount.trim() ? toMinor(discount, currency) : 0;
  const invalidDiscount = discountMinor === null || discountMinor > total;
  const paid = invalidDiscount ? null : total - discountMinor;

  const record = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/api/v1/bookings/{id}/payment', {
          params: { path: { id: booking.id }, header: { 'Idempotency-Key': key.current } },
          body: {
            method,
            amountPaidMinor: paid!,
            ...(discountMinor ? { discountMinor, discountReason: reason.trim() } : {}),
          },
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['bookings'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(`Payment recorded for ${booking.bookingRef}.`);
      onOpenChange(false);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const submit = () => {
    setError(null);
    if (invalidDiscount) return setError('Enter a discount between zero and the total.');
    if (discountMinor && !reason.trim()) return setError('Give a reason for the discount.');
    record.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            {booking.bookingRef} · {booking.customer.name} · total {formatMoney(total, currency)}
          </DialogDescription>
        </DialogHeader>
        <FormError>{error}</FormError>
        <SelectField
          label="Method"
          value={method}
          onChange={(e) => setMethod(e.target.value as Method)}
        >
          {PAYMENT_METHODS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Discount (optional)"
          inputMode="decimal"
          value={discount}
          error={invalidDiscount ? 'Enter a valid amount up to the total' : undefined}
          onChange={(e) => setDiscount(e.target.value)}
        />
        {discountMinor ? (
          <TextField
            label="Discount reason"
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
          />
        ) : null}
        <p className="text-sm" aria-live="polite">
          Amount to collect: <strong>{paid === null ? '—' : formatMoney(paid, currency)}</strong>
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button disabled={record.isPending} onClick={submit}>
            {record.isPending ? 'Saving…' : 'Record payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
