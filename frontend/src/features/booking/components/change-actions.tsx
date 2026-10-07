'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { usePublicSettings } from '@/lib/settings';
import { formatMinutes } from '@/lib/time';
import type { Booking } from '../api';
import { CancelBookingDialog } from './cancel-booking-dialog';
import { RescheduleBookingDialog } from './reschedule-booking-dialog';

// A customer's Reschedule / Cancel buttons (05 §4.2), driven by canReschedule / canCancel from
// the API so the UI never re-implements BR-006. Inside the cut-off they stay visible but
// disabled, with the reason in a tooltip (and for screen readers).
export function ChangeActions({ booking, timeZone }: { booking: Booking; timeZone: string }) {
  const { data: settings } = usePublicSettings();
  const [dialog, setDialog] = useState<'cancel' | 'reschedule' | null>(null);
  const reasonId = useId();
  if (booking.status !== 'BOOKED') return null;

  const cutoff = settings ? formatMinutes(settings.cancellationCutoffMin) : 'a short time';
  const phone = settings?.phone ? ` on ${settings.phone}` : '';
  const reason = `Online changes close ${cutoff} before the appointment. Please call the salon${phone}.`;

  const action = (label: string, allowed: boolean, onClick: () => void) =>
    allowed ? (
      <Button variant="outline" size="sm" onClick={onClick}>
        {label}
      </Button>
    ) : (
      <Tooltip>
        <TooltipTrigger asChild>
          {/* aria-disabled (not disabled) keeps it focusable, so the tooltip works by keyboard. */}
          <Button
            variant="outline"
            size="sm"
            aria-disabled="true"
            aria-describedby={reasonId}
            className="cursor-not-allowed opacity-50 hover:bg-background"
            onClick={(e) => e.preventDefault()}
          >
            {label}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
    );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {action('Reschedule', booking.canReschedule, () => setDialog('reschedule'))}
      {action('Cancel', booking.canCancel, () => setDialog('cancel'))}
      {!booking.canCancel || !booking.canReschedule ? (
        <span id={reasonId} className="sr-only">
          {reason}
        </span>
      ) : null}
      {dialog === 'cancel' ? (
        <CancelBookingDialog
          booking={booking}
          timeZone={timeZone}
          open
          onOpenChange={(open) => setDialog(open ? 'cancel' : null)}
        />
      ) : null}
      {dialog === 'reschedule' ? (
        <RescheduleBookingDialog
          booking={booking}
          timeZone={timeZone}
          open
          onOpenChange={(open) => setDialog(open ? 'reschedule' : null)}
        />
      ) : null}
    </div>
  );
}
