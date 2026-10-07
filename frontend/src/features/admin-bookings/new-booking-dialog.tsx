'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { CheckboxField } from '@/components/form/checkbox-field';
import { FormError } from '@/components/form/form-error';
import { SelectField } from '@/components/form/select-field';
import { TextField } from '@/components/form/text-field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { qualifiedFor, newIdempotencyKey, useServices, useStylists } from '@/features/booking/api';
import { DateTimePicker } from '@/features/booking/components/date-time-picker';
import { ANY, MAX_SERVICES } from '@/features/booking/params';
import { unwrap, type Schemas } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';
import { publicEnv } from '@/lib/env';
import { ApiError, errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { E164, normalisePhone } from '@/lib/phone';
import { usePublicSettings } from '@/lib/settings';

type Customer = Schemas['User'];
type Mode = 'walk-in' | 'later';

// US-03 walk-in and FR-037 bookings on a customer's behalf (05 §4.4): find the customer by phone
// or create a walk-in record (API-013), pick services and stylist, then API-050 with
// checkInNow (walk-in, starts now and is CHECKED_IN) or a chosen time (source PHONE).
export function NewBookingDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>New walk-in</DialogTitle>
          <DialogDescription>
            {customer
              ? `For ${customer.name} (${customer.phone}).`
              : 'Find the customer by phone, or add them as a walk-in.'}
          </DialogDescription>
        </DialogHeader>
        {customer ? (
          <BookingStep
            customer={customer}
            onBack={() => setCustomer(null)}
            onDone={() => onOpenChange(false)}
          />
        ) : (
          <CustomerStep onSelect={setCustomer} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CustomerStep({ onSelect }: { onSelect: (customer: Customer) => void }) {
  const { api } = useAuth();
  const [phone, setPhone] = useState('');
  const [searched, setSearched] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const results = useQuery({
    queryKey: ['users', 'search', searched],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/users', {
          params: { query: { q: searched!, role: 'CUSTOMER', pageSize: 5 } },
        }),
      ),
    enabled: searched !== null,
  });

  const createWalkIn = useMutation({
    mutationFn: (body: { name: string; phone: string }) =>
      unwrap(api.POST('/api/v1/users/walk-in', { body })),
    onSuccess: onSelect,
    onError: (e) =>
      setError(
        e instanceof ApiError && e.code === 'DUPLICATE'
          ? 'This number belongs to a salon staff account.'
          : errorMessage(e),
      ),
  });

  const search = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const normalised = normalisePhone(phone, publicEnv.defaultCountryCode);
    if (!E164.test(normalised)) return setError('Enter a valid mobile number.');
    setSearched(normalised);
  };

  return (
    <div className="grid gap-4">
      <FormError>{error}</FormError>
      <form onSubmit={search} className="flex items-end gap-2">
        <TextField
          label="Customer's mobile number"
          type="tel"
          inputMode="tel"
          className="flex-1"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <Button type="submit" variant="outline">
          Find
        </Button>
      </form>
      {searched && results.isPending ? (
        <p className="text-sm text-muted-foreground">Searching…</p>
      ) : null}
      {results.data ? (
        results.data.data.length > 0 ? (
          <ul className="grid gap-2" aria-label="Matching customers">
            {results.data.data.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"
              >
                <span>
                  <span className="font-medium">{c.name}</span> · {c.phone}
                  {c.isWalkIn ? <span className="text-muted-foreground"> · walk-in</span> : null}
                </span>
                <Button size="sm" onClick={() => onSelect(c)}>
                  Choose
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <form
            className="grid gap-3 rounded-lg border p-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              if (name.trim().length < 2) return setError("Enter the customer's name.");
              createWalkIn.mutate({ name: name.trim(), phone: searched! });
            }}
          >
            <p className="text-sm">No customer with {searched}. Add them as a walk-in:</p>
            <TextField
              label="Customer's name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
            <Button type="submit" disabled={createWalkIn.isPending} className="justify-self-start">
              Add customer
            </Button>
          </form>
        )
      ) : null}
    </div>
  );
}

function BookingStep({
  customer,
  onBack,
  onDone,
}: {
  customer: Customer;
  onBack: () => void;
  onDone: () => void;
}) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const services = useServices();
  const stylists = useStylists();
  const { data: settings } = usePublicSettings();
  const keys = useRef(new Map<string, string>());
  const [mode, setMode] = useState<Mode>('walk-in');
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [staffId, setStaffId] = useState<string>(ANY);
  const [date, setDate] = useState<string | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const qualified = qualifiedFor(stylists.data ?? [], serviceIds);
  const staff = staffId === ANY || qualified.some((s) => s.id === staffId) ? staffId : ANY;

  const create = useMutation({
    mutationFn: () => {
      const body = {
        customerId: customer.id,
        serviceIds,
        staffId: staff,
        ...(mode === 'walk-in' ? { checkInNow: true } : { startAt: start! }),
      };
      const signature = JSON.stringify(body);
      const key = keys.current.get(signature) ?? newIdempotencyKey();
      keys.current.set(signature, key);
      return unwrap(
        api.POST('/api/v1/bookings', { params: { header: { 'Idempotency-Key': key } }, body }),
      );
    },
    onSuccess: async (booking) => {
      await queryClient.invalidateQueries({ queryKey: ['bookings'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      await queryClient.invalidateQueries({ queryKey: ['availability'] });
      toast.success(
        `${booking.bookingRef}: ${customer.name} with ${booking.staff.displayName} at ${formatDateTime(booking.startAt, settings?.timezone ?? 'UTC')}`,
      );
      onDone();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const toggle = (id: string) => {
    setStart(null);
    setServiceIds((ids) =>
      ids.includes(id) ? ids.filter((s) => s !== id) : [...ids, id].slice(0, MAX_SERVICES),
    );
  };

  const submit = () => {
    setError(null);
    if (serviceIds.length === 0) return setError('Choose at least one service.');
    if (mode === 'later' && !start) return setError('Pick a time.');
    create.mutate();
  };

  return (
    <div className="grid gap-5">
      <FormError>{error}</FormError>
      <fieldset className="flex flex-wrap gap-4">
        <legend className="mb-2 text-sm font-medium">When</legend>
        {(
          [
            ['walk-in', 'Now (check in)'],
            ['later', 'Book a time'],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="mode"
              value={value}
              checked={mode === value}
              onChange={() => setMode(value)}
              className="accent-primary"
            />
            {label}
          </label>
        ))}
      </fieldset>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">Services (up to {MAX_SERVICES})</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(services.data ?? []).map((s) => (
            <CheckboxField
              key={s.id}
              label={`${s.name} · ${s.durationMin} min`}
              checked={serviceIds.includes(s.id)}
              disabled={!serviceIds.includes(s.id) && serviceIds.length >= MAX_SERVICES}
              onChange={() => toggle(s.id)}
            />
          ))}
        </div>
      </fieldset>
      <SelectField
        label="Stylist"
        value={staff}
        onChange={(e) => {
          setStaffId(e.target.value);
          setStart(null);
        }}
      >
        <option value={ANY}>Any available</option>
        {qualified.map((s) => (
          <option key={s.id} value={s.id}>
            {s.displayName}
          </option>
        ))}
      </SelectField>
      {mode === 'later' && serviceIds.length > 0 ? (
        <DateTimePicker
          serviceIds={serviceIds}
          staffId={staff}
          date={date}
          onDateChange={(d) => {
            setDate(d);
            setStart(null);
          }}
          value={start}
          onSelect={(slot) => setStart(slot.startAt)}
        />
      ) : null}
      <DialogFooter>
        <Button variant="outline" onClick={onBack}>
          Change customer
        </Button>
        <Button disabled={create.isPending} onClick={submit}>
          {mode === 'walk-in' ? 'Check in now' : 'Create booking'}
        </Button>
      </DialogFooter>
    </div>
  );
}
