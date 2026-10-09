'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/form/form-error';
import { TextareaField } from '@/components/form/textarea-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { unwrap } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';
import { ApiError, errorMessage } from '@/lib/errors';
import { formatDateTime, formatMoney } from '@/lib/format';
import { formatMinutes } from '@/lib/time';
import { newIdempotencyKey, type Booking, type Service, type Stylist } from '../api';
import { ANY } from '../params';
import { totals } from './step-services';
import { InlineSignIn } from './inline-sign-in';
import { SummaryBar } from './summary-bar';

const MAX_NOTES = 300;

// Step 4: summary, optional notes, sign in if needed, then API-050 with an Idempotency-Key.
// A double-clicked confirm replays the same key, so it can never book twice (03 §9).
export function StepReview({
  services,
  stylist,
  staff,
  start,
  timeZone,
  returnTo,
  onBooked,
  onSlotTaken,
}: {
  services: Service[];
  stylist: Stylist | null;
  staff: string;
  start: string;
  timeZone: string;
  returnTo: string;
  onBooked: (booking: Booking) => void;
  onSlotTaken: () => void;
}) {
  const { api, status, user } = useAuth();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const keys = useRef(new Map<string, string>());
  const sum = totals(services);

  const body = {
    serviceIds: services.map((s) => s.id),
    staffId: staff,
    startAt: start,
    ...(notes.trim() ? { notes: notes.trim() } : {}),
  };

  const create = useMutation({
    mutationFn: () => {
      // One key per distinct request body: retries of the same booking reuse it.
      const signature = JSON.stringify(body);
      const key = keys.current.get(signature) ?? newIdempotencyKey();
      keys.current.set(signature, key);
      return unwrap(
        api.POST('/api/v1/bookings', { params: { header: { 'Idempotency-Key': key } }, body }),
      );
    },
    onSuccess: async (booking) => {
      await queryClient.invalidateQueries({ queryKey: ['bookings'] });
      await queryClient.invalidateQueries({ queryKey: ['availability'] });
      toast.success(`Booked! Your reference is ${booking.bookingRef}.`);
      onBooked(booking);
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.code === 'SLOT_UNAVAILABLE') {
        toast.error(errorMessage(error));
        await queryClient.invalidateQueries({ queryKey: ['availability'] });
        onSlotTaken();
        return;
      }
      setFormError(errorMessage(error));
    },
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <section
        aria-labelledby="summary"
        className="grid content-start gap-4 rounded-2xl border bg-card p-5 shadow-soft sm:p-6"
      >
        <div className="grid gap-2">
          <h2 id="summary" className="text-lg font-semibold">
            Your appointment
          </h2>
          <div aria-hidden className="rule-brass" />
        </div>
        <dl className="grid gap-3 text-sm">
          <div className="grid gap-0.5">
            <dt className="text-muted-foreground">When</dt>
            <dd className="font-medium">{formatDateTime(start, timeZone)}</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-muted-foreground">Stylist</dt>
            <dd className="font-medium">
              {staff === ANY || !stylist ? 'Any available stylist' : stylist.displayName}
            </dd>
          </div>
          <div className="grid gap-1">
            <dt className="text-muted-foreground">Services</dt>
            <dd>
              <ul className="grid gap-1">
                {services.map((s) => (
                  <li key={s.id} className="flex justify-between gap-3">
                    <span>
                      {s.name} · {formatMinutes(s.durationMin)}
                    </span>
                    <span className="tabular-nums">
                      {formatMoney(s.price.amountMinor, s.price.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
          <div className="flex justify-between gap-3 border-t pt-3 text-base font-semibold">
            <dt>Total · {formatMinutes(sum.durationMin)}</dt>
            <dd className="tabular-nums">{formatMoney(sum.priceMinor, sum.currency)}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">Pay at the salon after your appointment.</p>
      </section>

      <div className="grid content-start gap-4">
        {status === 'loading' ? <Skeleton className="h-48 w-full" /> : null}
        {status === 'anonymous' ? <InlineSignIn returnTo={returnTo} /> : null}
        {status === 'authenticated' && user?.role !== 'CUSTOMER' ? (
          <Alert>
            <AlertDescription>
              You&apos;re signed in with a salon account. Book for customers from the admin area.
            </AlertDescription>
          </Alert>
        ) : null}
        {status === 'authenticated' && user?.role === 'CUSTOMER' ? (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setFormError(null);
              create.mutate();
            }}
          >
            <FormError>{formError}</FormError>
            <TextareaField
              label="Notes for the salon (optional)"
              maxLength={MAX_NOTES}
              hint={`${notes.length}/${MAX_NOTES}`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            {/* Pinned to the bottom on phones, in place under the notes from `sm` up. */}
            <SummaryBar
              services={services}
              layout="inline"
              action={
                <Button
                  type="submit"
                  size="lg"
                  className="min-w-40 sm:w-full"
                  disabled={create.isPending}
                >
                  {create.isPending ? 'Booking…' : 'Confirm booking'}
                </Button>
              }
            />
          </form>
        ) : null}
      </div>
    </div>
  );
}
