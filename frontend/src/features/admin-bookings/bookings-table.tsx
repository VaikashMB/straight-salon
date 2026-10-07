'use client';

import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { SelectField } from '@/components/form/select-field';
import { TextField } from '@/components/form/text-field';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { EmptyState, ErrorState, LoadingList } from '@/components/states/list-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  useBookingSearch,
  useStylists,
  type Booking,
  type BookingQuery,
} from '@/features/booking/api';
import { PaymentDialog } from '@/features/booking/components/payment-dialog';
import { StatusBadge } from '@/features/booking/components/status-badge';
import { STATUS_LABEL, type BookingStatus } from '@/features/booking/status';
import { formatDateTime, formatMoney } from '@/lib/format';
import { usePublicSettings } from '@/lib/settings';
import { todayInZone } from '@/lib/time';
import { NewBookingDialog } from './new-booking-dialog';

const STATUSES = Object.keys(STATUS_LABEL) as BookingStatus[];

// Bookings table (05 §4.4, API-052): server-side filters, sort and pagination; "New walk-in"
// (US-03) and "Record payment" on completed, unpaid bookings (FR-043).
export function BookingsTable() {
  const { data: settings } = usePublicSettings();
  if (!settings) return <LoadingList label="Loading bookings" />;
  return <Bookings timeZone={settings.timezone} />;
}

function Bookings({ timeZone }: { timeZone: string }) {
  const [date, setDate] = useState(() => todayInZone(timeZone));
  const [status, setStatus] = useState<BookingStatus | ''>('');
  const [staffId, setStaffId] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'startAt' | '-startAt'>('startAt');
  const [page, setPage] = useState(1);
  const [paying, setPaying] = useState<Booking | null>(null);
  const [creating, setCreating] = useState(false);
  const stylists = useStylists();

  const query: BookingQuery = {
    page,
    pageSize: 20,
    sort,
    ...(date ? { date } : {}),
    ...(status ? { status } : {}),
    ...(staffId ? { staffId } : {}),
    ...(q.trim() ? { q: q.trim() } : {}),
  };
  const bookings = useBookingSearch(query);
  const filter =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setPage(1);
    };

  return (
    <section className="grid gap-6">
      <PageHeader
        title="Bookings"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden /> New walk-in
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TextField
          label="Date"
          type="date"
          value={date}
          hint="Clear to see every date."
          onChange={(e) => filter(setDate)(e.target.value)}
        />
        <SelectField
          label="Status"
          value={status}
          onChange={(e) => filter(setStatus)(e.target.value as BookingStatus | '')}
        >
          <option value="">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Stylist"
          value={staffId}
          onChange={(e) => filter(setStaffId)(e.target.value)}
        >
          <option value="">Any stylist</option>
          {(stylists.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.displayName}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Search"
          type="search"
          placeholder="SS-… or phone"
          value={q}
          onChange={(e) => filter(setQ)(e.target.value)}
        />
      </div>
      {bookings.isPending ? (
        <LoadingList label="Loading bookings" />
      ) : bookings.error ? (
        <ErrorState error={bookings.error} onRetry={() => void bookings.refetch()} />
      ) : bookings.data.data.length === 0 ? (
        <EmptyState
          title="No bookings match"
          description="Try another date or clear the filters."
          action={
            <Button variant="outline" onClick={() => setCreating(true)}>
              New walk-in
            </Button>
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead aria-sort={sort === 'startAt' ? 'ascending' : 'descending'}>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1"
                    onClick={() => setSort(sort === 'startAt' ? '-startAt' : 'startAt')}
                  >
                    When
                    {sort === 'startAt' ? (
                      <ArrowUp aria-hidden className="size-3" />
                    ) : (
                      <ArrowDown aria-hidden className="size-3" />
                    )}
                    <span className="sr-only">(change sort order)</span>
                  </button>
                </TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Stylist</TableHead>
                <TableHead>Services</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bookings.data.data.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="whitespace-nowrap">
                    <Link href={`/admin/bookings/${b.id}`} className="font-medium hover:underline">
                      {formatDateTime(b.startAt, timeZone)}
                    </Link>
                    <span className="block text-xs text-muted-foreground">{b.bookingRef}</span>
                  </TableCell>
                  <TableCell>
                    {b.customer.name}
                    <span className="block text-xs text-muted-foreground">{b.customer.phone}</span>
                  </TableCell>
                  <TableCell>{b.staff.displayName}</TableCell>
                  <TableCell>{b.services.map((s) => s.name).join(', ')}</TableCell>
                  <TableCell>
                    <StatusBadge status={b.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatMoney(b.total.amountMinor, b.total.currency)}{' '}
                    <Badge variant={b.payment.status === 'PAID' ? 'success' : 'outline'}>
                      {b.payment.status === 'PAID' ? 'Paid' : 'Unpaid'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {b.status === 'COMPLETED' && b.payment.status === 'UNPAID' ? (
                      <Button size="sm" variant="accent" onClick={() => setPaying(b)}>
                        Record payment
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            page={bookings.data.meta.page}
            totalPages={bookings.data.meta.totalPages}
            onPageChange={setPage}
          />
        </>
      )}
      {paying ? (
        <PaymentDialog booking={paying} open onOpenChange={(open) => !open && setPaying(null)} />
      ) : null}
      {creating ? <NewBookingDialog open onOpenChange={setCreating} /> : null}
    </section>
  );
}
