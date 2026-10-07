'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { usePublicSettings } from '@/lib/settings';
import type { Booking } from '../api';
import { insideCutoff } from '../mutations';
import { CancelBookingDialog } from './cancel-booking-dialog';
import { PaymentDialog } from './payment-dialog';
import { RescheduleBookingDialog } from './reschedule-booking-dialog';
import { StatusActions } from './status-actions';

// Front-desk actions on one booking (05 §4.4): next status, reschedule, cancel (with the cut-off
// override, BR-006) and record payment on completed bookings (FR-043).
export function BookingActions({ booking, timeZone }: { booking: Booking; timeZone: string }) {
  const { data: settings } = usePublicSettings();
  const [dialog, setDialog] = useState<'cancel' | 'reschedule' | 'payment' | null>(null);
  const needsOverride = settings
    ? insideCutoff(booking.startAt, settings.cancellationCutoffMin)
    : false;
  const close = (open: boolean) => {
    if (!open) setDialog(null);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusActions booking={booking} />
      {booking.canReschedule ? (
        <Button variant="outline" size="sm" onClick={() => setDialog('reschedule')}>
          Reschedule
        </Button>
      ) : null}
      {booking.canCancel ? (
        <Button variant="outline" size="sm" onClick={() => setDialog('cancel')}>
          Cancel
        </Button>
      ) : null}
      {booking.status === 'COMPLETED' && booking.payment.status === 'UNPAID' ? (
        <Button variant="accent" size="sm" onClick={() => setDialog('payment')}>
          Record payment
        </Button>
      ) : null}
      {dialog === 'cancel' ? (
        <CancelBookingDialog
          booking={booking}
          timeZone={timeZone}
          open
          onOpenChange={close}
          needsOverride={needsOverride}
        />
      ) : null}
      {dialog === 'reschedule' ? (
        <RescheduleBookingDialog
          booking={booking}
          timeZone={timeZone}
          open
          onOpenChange={close}
          staffMode
          needsOverride={needsOverride}
        />
      ) : null}
      {dialog === 'payment' ? <PaymentDialog booking={booking} open onOpenChange={close} /> : null}
    </div>
  );
}
