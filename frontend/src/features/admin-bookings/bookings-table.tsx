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

type Sort = 'startAt' | '-startAt';

// The API query for the current filters; empty filters are left out.
function searchQuery(f: {
  page: number;
  sort: Sort;
  date: string;
  status: BookingStatus | '';
  staffId: string;
  q: string;
}): BookingQuery {
  const q = f.q.trim();
  return {
    page: f.page,
    pageSize: 20,
    sort: f.sort,
    ...(f.date ? { date: f.date } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.staffId ? { staffId: f.staffId } : {}),
    ...(q ? { q } : {}),
  };
}

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
  const [sort, setSort] = useState<Sort>('startAt');
  const [page, setPage] = useState(1);
  const [paying, setPaying] = useState<Booking | null>(null);
  const [creating, setCreating] = useState(false);
  const stylists = useStylists();

  const bookings = useBookingSearch(searchQuery({ page, sort, date, status, staffId, q }));
  const filter =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setPage(1);
    };

  const renderBookings = () => {
    if (bookings.isPending) return <LoadingList label="Loading bookings" />;
    if (bookings.error)
      return <ErrorState error={bookings.error} onRetry={() => void bookings.refetch()} />;
    if (bookings.data.data.length === 0)
      return (
        <EmptyState
          illustration="search"
          title="No bookings match"
          description="Try another date or clear the filters."
          action={
            <Button variant="outline" onClick={() => setCreating(true)}>
              New walk-in
            </Button>
          }
        />
      );
    return (
      <>
        <div className="animate-fade-up rounded-lg shadow-soft">
          <Table>
            <TableHeader className="bg-muted/50 [&_th]:text-xs [&_th]:font-semibold [&_th]:tracking-wide [&_th]:uppercase">
              <TableRow>
                <WhenHeader sort={sort} onSortChange={setSort} />
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
                <BookingRow key={b.id} booking={b} timeZone={timeZone} onPay={setPaying} />
              ))}
            </TableBody>
          </Table>
        </div>
        <Pagination
          page={bookings.data.meta.page}
          totalPages={bookings.data.meta.totalPages}
          onPageChange={setPage}
        />
      </>
    );
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
      {renderBookings()}
      {paying ? (
        <PaymentDialog booking={paying} open onOpenChange={(open) => !open && setPaying(null)} />
      ) : null}
      {creating ? <NewBookingDialog open onOpenChange={setCreating} /> : null}
    </section>
  );
}

function WhenHeader({
  sort,
  onSortChange,
}: Readonly<{ sort: Sort; onSortChange: (sort: Sort) => void }>) {
  const ascending = sort === 'startAt';
  return (
    <TableHead aria-sort={ascending ? 'ascending' : 'descending'}>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-sm uppercase outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        onClick={() => onSortChange(ascending ? '-startAt' : 'startAt')}
      >
        When
        {ascending ? (
          <ArrowUp aria-hidden className="size-3" />
        ) : (
          <ArrowDown aria-hidden className="size-3" />
        )}
        <span className="sr-only">(change sort order)</span>
      </button>
    </TableHead>
  );
}

function BookingRow({
  booking,
  timeZone,
  onPay,
}: Readonly<{
  booking: Booking;
  timeZone: string;
  onPay: (booking: Booking) => void;
}>) {
  const paid = booking.payment.status === 'PAID';
  return (
    <TableRow>
      <TableCell className="whitespace-nowrap">
        <Link href={`/admin/bookings/${booking.id}`} className="font-medium hover:underline">
          {formatDateTime(booking.startAt, timeZone)}
        </Link>
        <span className="block text-xs text-muted-foreground">{booking.bookingRef}</span>
      </TableCell>
      <TableCell>
        {booking.customer.name}
        <span className="block text-xs text-muted-foreground">{booking.customer.phone}</span>
      </TableCell>
      <TableCell>{booking.staff.displayName}</TableCell>
      <TableCell>{booking.services.map((s) => s.name).join(', ')}</TableCell>
      <TableCell>
        <StatusBadge status={booking.status} />
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {formatMoney(booking.total.amountMinor, booking.total.currency)}{' '}
        <Badge variant={paid ? 'success' : 'outline'}>{paid ? 'Paid' : 'Unpaid'}</Badge>
      </TableCell>
      <TableCell>
        {booking.status === 'COMPLETED' && booking.payment.status === 'UNPAID' ? (
          <Button size="sm" variant="accent" onClick={() => onPay(booking)}>
            Record payment
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
