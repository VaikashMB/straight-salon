'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { CheckboxField } from '@/components/form/checkbox-field';
import { FormError } from '@/components/form/form-error';
import { TextareaField } from '@/components/form/textarea-field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import type { Booking } from '../api';
import { useCancelBooking } from '../mutations';

// API-055. Customers cancel with an optional reason (FR-035); reception/admin inside the
// cut-off must override, with a reason (BR-006, audited).
export function CancelBookingDialog({
  booking,
  timeZone,
  open,
  onOpenChange,
  needsOverride = false,
}: {
  booking: Booking;
  timeZone: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  needsOverride?: boolean;
}) {
  const cancel = useCancelBooking(booking.id);
  const [reason, setReason] = useState('');
  const [override, setOverride] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasonMissing = needsOverride && !reason.trim();

  const submit = () => {
    setError(null);
    if (needsOverride && !override) {
      setError('Tick "Override the cut-off" to cancel this close to the appointment.');
      return;
    }
    if (reasonMissing) {
      setError('Give a reason for the override.');
      return;
    }
    cancel.mutate(
      {
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        ...(needsOverride ? { override } : {}),
      },
      {
        onSuccess: () => {
          toast.success(`Booking ${booking.bookingRef} cancelled.`);
          onOpenChange(false);
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel this booking?</DialogTitle>
          <DialogDescription>
            {booking.bookingRef} · {formatDateTime(booking.startAt, timeZone)} with{' '}
            {booking.staff.displayName}. The time becomes free for others straight away.
          </DialogDescription>
        </DialogHeader>
        <FormError>{error}</FormError>
        {needsOverride ? (
          <CheckboxField
            label="Override the cut-off"
            hint="The appointment is inside the cancellation cut-off. The override is audited."
            checked={override}
            onChange={(e) => setOverride(e.target.checked)}
          />
        ) : null}
        <TextareaField
          label={needsOverride ? 'Reason' : 'Reason (optional)'}
          maxLength={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep booking
          </Button>
          <Button variant="destructive" disabled={cancel.isPending} onClick={submit}>
            {cancel.isPending ? 'Cancelling…' : 'Cancel booking'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
