'use client';

import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/errors';
import type { Booking } from '../api';
import { useChangeStatus } from '../mutations';
import { ACTION_LABEL, nextStatuses, STATUS_LABEL } from '../status';

// Only the next valid status change(s) for a booking (API-056, BR-010; 05 §4.3).
export function StatusActions({
  booking,
  size = 'sm',
}: {
  booking: Booking;
  size?: 'sm' | 'default';
}) {
  const change = useChangeStatus(booking.id);
  const actions = nextStatuses(booking);
  if (actions.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((status) => (
        <Button
          key={status}
          size={size}
          variant={status === 'NO_SHOW' ? 'outline' : 'default'}
          disabled={change.isPending}
          aria-label={`${ACTION_LABEL[status]}: ${booking.customer.name}`}
          onClick={() =>
            change.mutate(
              { status },
              {
                onSuccess: () => toast.success(`${booking.bookingRef}: ${STATUS_LABEL[status]}`),
                onError: (e) => toast.error(errorMessage(e)),
              },
            )
          }
        >
          {ACTION_LABEL[status]}
        </Button>
      ))}
    </div>
  );
}
