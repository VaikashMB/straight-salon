'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormError } from '@/components/form/form-error';
import { TextField } from '@/components/form/text-field';
import { EmptyState, ErrorState, LoadingList } from '@/components/states/list-states';
import { Button } from '@/components/ui/button';
import { unwrap, type Schemas } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';
import { ApiError, errorMessage } from '@/lib/errors';
import { formatCalendarDate } from '@/lib/format';
import { usePublicSettings } from '@/lib/settings';
import { todayInZone } from '@/lib/time';

type Holiday = Schemas['Holiday'];

// Full-day closures (FR-022, API-019/020). Over active bookings the API refuses (422) unless
// forced, which cancels them and notifies the customers.
export function HolidaysAdmin() {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const { data: settings } = usePublicSettings();
  const today = settings ? todayInZone(settings.timezone) : null;
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [forcing, setForcing] = useState(false);
  const [deleting, setDeleting] = useState<Holiday | null>(null);

  const holidays = useQuery({
    queryKey: ['holidays', today],
    queryFn: () => unwrap(api.GET('/api/v1/holidays', { params: { query: { from: today! } } })),
    enabled: today !== null,
  });
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['holidays'] });
    await queryClient.invalidateQueries({ queryKey: ['availability'] });
    await queryClient.invalidateQueries({ queryKey: ['bookings'] });
  };
  const add = useMutation({
    mutationFn: (force: boolean) =>
      unwrap(
        api.POST('/api/v1/holidays', {
          body: { date, name: name.trim(), ...(force ? { force: true } : {}) },
        }),
      ),
    onSuccess: async (_, force) => {
      await invalidate();
      toast.success(
        force ? 'Holiday added; bookings on that day were cancelled.' : 'Holiday added.',
      );
      setForcing(false);
      setDate('');
      setName('');
    },
    onError: (e, force) => {
      if (e instanceof ApiError && e.code === 'ACTIVE_BOOKINGS_EXIST' && !force)
        return setForcing(true);
      setForcing(false);
      setError(
        e instanceof ApiError && e.code === 'DUPLICATE'
          ? 'That date is already a holiday.'
          : errorMessage(e),
      );
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.DELETE('/api/v1/holidays/{id}', { params: { path: { id } } })),
    onSuccess: async () => {
      await invalidate();
      toast.success('Holiday removed.');
      setDeleting(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!date || !name.trim()) return setError('Enter a date and a name.');
    add.mutate(false);
  };

  const renderHolidays = () => {
    if (holidays.isPending) return <LoadingList rows={2} label="Loading holidays" />;
    if (holidays.error)
      return <ErrorState error={holidays.error} onRetry={() => void holidays.refetch()} />;
    if (holidays.data.length === 0) return <EmptyState title="No upcoming holidays" />;
    return (
      <ul className="grid gap-2">
        {holidays.data.map((h) => (
          <li
            key={h.id}
            className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3 text-sm"
          >
            <span>
              <span className="font-medium">{formatCalendarDate(h.date)}</span> · {h.name}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove ${h.name}`}
              onClick={() => setDeleting(h)}
            >
              <Trash2 aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <section aria-labelledby="holidays" className="grid gap-4 border-t pt-8">
      <h2 id="holidays" className="text-lg font-semibold">
        Holidays
      </h2>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <TextField
          label="Date"
          type="date"
          min={today ?? undefined}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <TextField
          label="Holiday name"
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" disabled={add.isPending}>
          Add holiday
        </Button>
      </form>
      <FormError>{error}</FormError>
      {renderHolidays()}
      <ConfirmDialog
        open={forcing}
        onOpenChange={setForcing}
        title="Bookings on that day"
        description="There are bookings on this date. Close the salon anyway? Those bookings will be cancelled and the customers notified."
        confirmLabel="Cancel bookings and close"
        pending={add.isPending}
        onConfirm={() => add.mutate(true)}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Remove ${deleting?.name ?? 'holiday'}?`}
        description="The salon will be bookable on that day again."
        confirmLabel="Remove"
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </section>
  );
}
