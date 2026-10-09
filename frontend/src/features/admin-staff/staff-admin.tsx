'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { CheckboxField } from '@/components/form/checkbox-field';
import { FormError } from '@/components/form/form-error';
import { SelectField } from '@/components/form/select-field';
import { TextField } from '@/components/form/text-field';
import { TextareaField } from '@/components/form/textarea-field';
import { PageHeader } from '@/components/page-header';
import { Rating } from '@/components/rating';
import { EmptyState, ErrorState, LoadingList } from '@/components/states/list-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useServices } from '@/features/booking/api';
import { StylistAvatar } from '@/features/catalog/components/stylist-avatar';
import { errorMessage } from '@/lib/errors';
import { useAdminStaff, useCreateStaff, useStaffAccounts } from './api';

// Stylists (FR-020): everyone, active or not; add a profile for a STAFF account.
export function StaffAdmin() {
  const staff = useAdminStaff();
  const [creating, setCreating] = useState(false);
  const renderStaff = () => {
    if (staff.isPending) return <LoadingList label="Loading stylists" />;
    if (staff.error) return <ErrorState error={staff.error} onRetry={() => void staff.refetch()} />;
    if (staff.data.length === 0)
      return (
        <EmptyState
          title="No stylists yet"
          action={
            <Button variant="outline" onClick={() => setCreating(true)}>
              Add a stylist
            </Button>
          }
        />
      );
    return (
      <div className="animate-fade-up rounded-lg shadow-soft">
        <Table>
          <TableHeader className="bg-muted/50 [&_th]:text-xs [&_th]:font-semibold [&_th]:tracking-wide [&_th]:uppercase">
            <TableRow>
              <TableHead>Stylist</TableHead>
              <TableHead>Services</TableHead>
              <TableHead>Rating</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {staff.data.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <Link
                    href={`/admin/staff/${s.id}`}
                    className="flex items-center gap-3 font-medium hover:underline"
                  >
                    <StylistAvatar name={s.displayName} photoUrl={s.photoUrl} size={36} />
                    {s.displayName}
                  </Link>
                </TableCell>
                <TableCell>{s.serviceIds.length}</TableCell>
                <TableCell>
                  <Rating value={s.ratingAvg} count={s.ratingCount} />
                </TableCell>
                <TableCell>
                  <Badge variant={s.isActive === false ? 'secondary' : 'success'}>
                    {s.isActive === false ? 'Inactive' : 'Active'}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  };

  return (
    <section className="grid gap-6">
      <PageHeader
        title="Stylists"
        description="Create a staff account under Customers & team first, then add their stylist profile here."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden /> New stylist
          </Button>
        }
      />
      {renderStaff()}
      <Dialog open={creating} onOpenChange={setCreating}>
        {creating ? (
          <DialogContent side="right">
            <DialogHeader>
              <DialogTitle>New stylist</DialogTitle>
              <DialogDescription>
                Link a staff account and choose what they offer.
              </DialogDescription>
            </DialogHeader>
            <NewStylistForm
              linkedUserIds={(staff.data ?? []).map((s) => s.userId)}
              onDone={() => setCreating(false)}
            />
          </DialogContent>
        ) : null}
      </Dialog>
    </section>
  );
}

function NewStylistForm({
  linkedUserIds,
  onDone,
}: {
  linkedUserIds: (string | undefined)[];
  onDone: () => void;
}) {
  const accounts = useStaffAccounts(true);
  const services = useServices();
  const create = useCreateStaff();
  const [userId, setUserId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const available = (accounts.data ?? []).filter((u) => !linkedUserIds.includes(u.id));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!userId) return setError('Choose the staff account.');
    if (displayName.trim().length < 2) return setError('Enter a display name.');
    create.mutate(
      {
        userId,
        displayName: displayName.trim(),
        serviceIds,
        ...(bio.trim() ? { bio: bio.trim() } : {}),
      },
      {
        onSuccess: () => {
          toast.success(`${displayName.trim()} added. Set their weekly schedule next.`);
          onDone();
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <FormError>{error}</FormError>
      <SelectField
        label="Staff account"
        value={userId}
        hint={
          accounts.data && available.length === 0
            ? 'Every staff account already has a profile.'
            : undefined
        }
        onChange={(e) => {
          setUserId(e.target.value);
          const account = available.find((u) => u.id === e.target.value);
          if (account && !displayName) setDisplayName(account.name.split(/\s+/)[0] ?? account.name);
        }}
      >
        <option value="">Choose…</option>
        {available.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} ({u.email ?? u.phone})
          </option>
        ))}
      </SelectField>
      <TextField
        label="Display name"
        value={displayName}
        maxLength={60}
        onChange={(e) => setDisplayName(e.target.value)}
      />
      <TextareaField
        label="Bio"
        value={bio}
        maxLength={500}
        onChange={(e) => setBio(e.target.value)}
      />
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">Services they perform</legend>
        {(services.data ?? []).map((s) => (
          <CheckboxField
            key={s.id}
            label={s.name}
            checked={serviceIds.includes(s.id)}
            onChange={(e) =>
              setServiceIds((ids) =>
                e.target.checked ? [...ids, s.id] : ids.filter((id) => id !== s.id),
              )
            }
          />
        ))}
      </fieldset>
      <Button type="submit" disabled={create.isPending} className="justify-self-start">
        Add stylist
      </Button>
    </form>
  );
}
