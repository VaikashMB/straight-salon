'use client';

import { Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormError } from '@/components/form/form-error';
import { TextField } from '@/components/form/text-field';
import { EmptyState, ErrorState, LoadingList } from '@/components/states/list-states';
import { Button } from '@/components/ui/button';
import { ApiError, errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { usePublicSettings } from '@/lib/settings';
import { todayInZone, zonedToUtc } from '@/lib/time';
import { useAddTimeOff, useDeleteTimeOff, useTimeOff, type TimeOff } from '../api';

interface Draft {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  reason: string;
}

// Time-off blocks (FR-024, API-035..037), for stylists themselves and for admins on a stylist's
// page. Over active bookings the API refuses (422); only an admin may force it, which cancels
// those bookings and notifies the customers.
export function TimeOffManager({ staffId, canForce }: { staffId: string; canForce: boolean }) {
  const { data: settings } = usePublicSettings();
  if (!settings) return <LoadingList label="Loading time off" />;
  return <Manager staffId={staffId} canForce={canForce} timeZone={settings.timezone} />;
}

function Manager({
  staffId,
  canForce,
  timeZone,
}: {
  staffId: string;
  canForce: boolean;
  timeZone: string;
}) {
  const today = todayInZone(timeZone);
  const blocks = useTimeOff(staffId, today);
  const add = useAddTimeOff(staffId);
  const remove = useDeleteTimeOff(staffId);
  const [draft, setDraft] = useState<Draft>({
    startDate: today,
    startTime: '09:00',
    endDate: today,
    endTime: '18:00',
    reason: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [forcing, setForcing] = useState<{
    startAt: string;
    endAt: string;
    reason?: string;
  } | null>(null);
  const [deleting, setDeleting] = useState<TimeOff | null>(null);

  const set = (field: keyof Draft) => (e: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, [field]: e.target.value }));

  const save = (body: { startAt: string; endAt: string; reason?: string; force?: boolean }) =>
    add.mutate(body, {
      onSuccess: () => {
        toast.success(
          body.force ? 'Time off added; clashing bookings were cancelled.' : 'Time off added.',
        );
        setForcing(null);
        setDraft((d) => ({ ...d, reason: '' }));
      },
      onError: (e) => {
        if (
          e instanceof ApiError &&
          e.code === 'ACTIVE_BOOKINGS_EXIST' &&
          canForce &&
          !body.force
        ) {
          setForcing(body);
          return;
        }
        setForcing(null);
        setError(
          e instanceof ApiError && e.code === 'ACTIVE_BOOKINGS_EXIST'
            ? 'You have bookings in that time. Ask the front desk to move them first.'
            : errorMessage(e),
        );
      },
    });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const startAt = zonedToUtc(draft.startDate, draft.startTime, timeZone);
    const endAt = zonedToUtc(draft.endDate, draft.endTime, timeZone);
    if (endAt <= startAt) return setError('The end must be after the start.');
    save({ startAt, endAt, ...(draft.reason.trim() ? { reason: draft.reason.trim() } : {}) });
  };

  const renderBlocks = () => {
    if (blocks.isPending) return <LoadingList rows={2} label="Loading time off" />;
    if (blocks.error)
      return <ErrorState error={blocks.error} onRetry={() => void blocks.refetch()} />;
    if (blocks.data.length === 0) return <EmptyState title="No time off planned" />;
    return (
      <ul className="grid gap-2">
        {blocks.data.map((block) => (
          <li
            key={block.id}
            className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3 text-sm"
          >
            <span>
              <span className="font-medium">
                {formatDateTime(block.startAt, timeZone)} – {formatDateTime(block.endAt, timeZone)}
              </span>
              {block.reason ? (
                <span className="text-muted-foreground"> · {block.reason}</span>
              ) : null}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove time off from ${formatDateTime(block.startAt, timeZone)}`}
              onClick={() => setDeleting(block)}
            >
              <Trash2 aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="grid gap-8">
      <form
        onSubmit={submit}
        className="grid gap-4 rounded-lg border bg-card p-5"
        aria-labelledby="add-time-off"
      >
        <h2 id="add-time-off" className="text-lg font-semibold">
          Add time off
        </h2>
        <FormError>{error}</FormError>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="From date"
            type="date"
            min={today}
            value={draft.startDate}
            onChange={set('startDate')}
            required
          />
          <TextField
            label="From time"
            type="time"
            value={draft.startTime}
            onChange={set('startTime')}
            required
          />
          <TextField
            label="To date"
            type="date"
            min={draft.startDate}
            value={draft.endDate}
            onChange={set('endDate')}
            required
          />
          <TextField
            label="To time"
            type="time"
            value={draft.endTime}
            onChange={set('endTime')}
            required
          />
        </div>
        <TextField
          label="Reason (optional)"
          maxLength={200}
          value={draft.reason}
          onChange={set('reason')}
        />
        <Button type="submit" disabled={add.isPending} className="justify-self-start">
          {add.isPending ? 'Saving…' : 'Add time off'}
        </Button>
      </form>

      <section aria-labelledby="upcoming-time-off" className="grid gap-3">
        <h2 id="upcoming-time-off" className="text-lg font-semibold">
          Upcoming time off
        </h2>
        {renderBlocks()}
      </section>

      <ConfirmDialog
        open={forcing !== null}
        onOpenChange={(open) => !open && setForcing(null)}
        title="Bookings in the way"
        description="This stylist has bookings in that time. Add the time off anyway? Those bookings will be cancelled and the customers notified. To keep them, reschedule them to another stylist first."
        confirmLabel="Cancel bookings and add"
        pending={add.isPending}
        onConfirm={() => forcing && save({ ...forcing, force: true })}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Remove this time off?"
        description={
          deleting
            ? `${formatDateTime(deleting.startAt, timeZone)} – ${formatDateTime(deleting.endAt, timeZone)}`
            : ''
        }
        confirmLabel="Remove"
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success('Time off removed.');
              setDeleting(null);
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </div>
  );
}
