'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { CheckboxField } from '@/components/form/checkbox-field';
import { FormError } from '@/components/form/form-error';
import { SelectField } from '@/components/form/select-field';
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
import { ApiError, errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { qualifiedFor, useStylists, type Booking } from '../api';
import { useRescheduleBooking } from '../mutations';
import { DateTimePicker } from './date-time-picker';

// API-054 (BR-015): same booking and reference, new time. Reuses the wizard's date & time step
// (05 §4.2). Reception/admin may also move it to another qualified stylist, and must override
// inside the cut-off (BR-006).
export function RescheduleBookingDialog({
  booking,
  timeZone,
  open,
  onOpenChange,
  staffMode = false,
  needsOverride = false,
}: {
  booking: Booking;
  timeZone: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staffMode?: boolean;
  needsOverride?: boolean;
}) {
  const reschedule = useRescheduleBooking(booking.id);
  const stylists = useStylists();
  const serviceIds = booking.services.map((s) => s.serviceId);
  const [staffId, setStaffId] = useState(booking.staff.id);
  const [date, setDate] = useState<string | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    if (!start) return setError('Pick a new time.');
    if (needsOverride && (!override || !reason.trim())) {
      return setError('Tick "Override the cut-off" and give a reason.');
    }
    reschedule.mutate(
      {
        startAt: start,
        ...(staffId !== booking.staff.id ? { staffId } : {}),
        ...(needsOverride ? { override, reason: reason.trim() } : {}),
      },
      {
        onSuccess: (updated) => {
          toast.success(`Moved to ${formatDateTime(updated.startAt, timeZone)}.`);
          onOpenChange(false);
        },
        onError: (e) => {
          if (e instanceof ApiError && e.code === 'SLOT_UNAVAILABLE') setStart(null);
          setError(errorMessage(e));
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Reschedule {booking.bookingRef}</DialogTitle>
          <DialogDescription>
            Now {formatDateTime(booking.startAt, timeZone)} with {booking.staff.displayName}.
          </DialogDescription>
        </DialogHeader>
        <FormError>{error}</FormError>
        {staffMode ? (
          <SelectField
            label="Stylist"
            value={staffId}
            onChange={(e) => {
              setStaffId(e.target.value);
              setStart(null);
            }}
          >
            <option value={booking.staff.id}>{booking.staff.displayName}</option>
            {qualifiedFor(stylists.data ?? [], serviceIds)
              .filter((s) => s.id !== booking.staff.id)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName}
                </option>
              ))}
          </SelectField>
        ) : null}
        <DateTimePicker
          serviceIds={serviceIds}
          staffId={staffId}
          date={date}
          onDateChange={(d) => {
            setDate(d);
            setStart(null);
          }}
          value={start}
          onSelect={(slot) => setStart(slot.startAt)}
        />
        {needsOverride ? (
          <div className="grid gap-3">
            <CheckboxField
              label="Override the cut-off"
              hint="The appointment is inside the cancellation cut-off. The override is audited."
              checked={override}
              onChange={(e) => setOverride(e.target.checked)}
            />
            <TextareaField
              label="Reason"
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button disabled={!start || reschedule.isPending} onClick={submit}>
            {reschedule.isPending ? 'Saving…' : moveLabel(start, timeZone)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function moveLabel(start: string | null, timeZone: string): string {
  return start ? `Move to ${formatDateTime(start, timeZone)}` : 'Pick a time';
}
