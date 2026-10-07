'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/form/form-error';
import { SelectField } from '@/components/form/select-field';
import { TextareaField } from '@/components/form/textarea-field';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { EmptyState, ErrorState, LoadingList } from '@/components/states/list-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useStylists } from '@/features/booking/api';
import { unwrap, type Schemas } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { usePublicSettings } from '@/lib/settings';

type Review = Schemas['Review'];

// Review moderation (FR-062, API-061 with includeHidden, API-062): hide with a reason, unhide.
export function ReviewsAdmin() {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const { data: settings } = usePublicSettings();
  const stylists = useStylists();
  const [staffId, setStaffId] = useState('');
  const [page, setPage] = useState(1);
  const [hiding, setHiding] = useState<Review | null>(null);

  const reviews = useQuery({
    queryKey: ['reviews', 'admin', { staffId, page }],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/reviews', {
          params: {
            query: { includeHidden: 'true', page, pageSize: 20, ...(staffId ? { staffId } : {}) },
          },
        }),
      ),
    placeholderData: keepPreviousData,
  });

  const moderate = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: { isHidden: boolean; hiddenReason?: string };
    }) => unwrap(api.PATCH('/api/v1/reviews/{id}', { params: { path: { id } }, body })),
    onSuccess: async (review) => {
      await queryClient.invalidateQueries({ queryKey: ['reviews'] });
      toast.success(review.isHidden ? 'Review hidden.' : 'Review visible again.');
      setHiding(null);
    },
  });

  return (
    <section className="grid gap-6">
      <PageHeader title="Reviews" description="Hidden reviews no longer count towards ratings." />
      <SelectField
        label="Stylist"
        className="max-w-xs"
        value={staffId}
        onChange={(e) => {
          setStaffId(e.target.value);
          setPage(1);
        }}
      >
        <option value="">All stylists</option>
        {(stylists.data ?? []).map((s) => (
          <option key={s.id} value={s.id}>
            {s.displayName}
          </option>
        ))}
      </SelectField>
      {reviews.isPending || !settings ? (
        <LoadingList label="Loading reviews" />
      ) : reviews.error ? (
        <ErrorState error={reviews.error} onRetry={() => void reviews.refetch()} />
      ) : reviews.data.data.length === 0 ? (
        <EmptyState title="No reviews yet" />
      ) : (
        <>
          <ul className="grid gap-3">
            {reviews.data.data.map((r) => (
              <li key={r.id} className="grid gap-2 rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    className="inline-flex items-center gap-1 text-sm font-medium"
                    aria-label={`${r.rating} out of 5`}
                  >
                    <Star aria-hidden className="size-4 fill-accent text-accent" /> {r.rating}/5
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {r.customer.name} · {r.staff.displayName} ·{' '}
                    {formatDate(r.createdAt, settings.timezone)}
                  </span>
                </div>
                {r.comment ? <p className="text-sm">{r.comment}</p> : null}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    {r.services.map((s) => s.name).join(', ')}
                  </span>
                  {r.isHidden ? (
                    <span className="flex items-center gap-2">
                      <Badge variant="secondary">Hidden: {r.hiddenReason}</Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={moderate.isPending}
                        onClick={() =>
                          moderate.mutate(
                            { id: r.id, body: { isHidden: false } },
                            { onError: (e) => toast.error(errorMessage(e)) },
                          )
                        }
                      >
                        Unhide
                      </Button>
                    </span>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setHiding(r)}>
                      Hide
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <Pagination
            page={reviews.data.meta.page}
            totalPages={reviews.data.meta.totalPages}
            onPageChange={setPage}
          />
        </>
      )}
      {hiding ? (
        <HideDialog
          review={hiding}
          pending={moderate.isPending}
          onClose={() => setHiding(null)}
          onHide={(reason, onError) =>
            moderate.mutate(
              { id: hiding.id, body: { isHidden: true, hiddenReason: reason } },
              { onError },
            )
          }
        />
      ) : null}
    </section>
  );
}

function HideDialog({
  review,
  pending,
  onClose,
  onHide,
}: {
  review: Review;
  pending: boolean;
  onClose: () => void;
  onHide: (reason: string, onError: (e: unknown) => void) => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Hide this review?</DialogTitle>
          <DialogDescription>
            {review.rating}/5 from {review.customer.name}. The reason is kept in the audit log.
          </DialogDescription>
        </DialogHeader>
        <FormError>{error}</FormError>
        <TextareaField
          label="Reason"
          maxLength={200}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep visible
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() => {
              setError(null);
              if (!reason.trim()) return setError('Give a reason for hiding it.');
              onHide(reason.trim(), (e) => setError(errorMessage(e)));
            }}
          >
            Hide review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
