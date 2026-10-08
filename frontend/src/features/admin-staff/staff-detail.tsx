'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CheckboxField } from '@/components/form/checkbox-field';
import { FormError } from '@/components/form/form-error';
import { TextField } from '@/components/form/text-field';
import { TextareaField } from '@/components/form/textarea-field';
import { ErrorState, LoadingList } from '@/components/states/list-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ImageUpload } from '@/features/admin-catalog/image-upload';
import { useServices } from '@/features/booking/api';
import { TimeOffManager } from '@/features/staff/components/time-off-manager';
import { ApiError, errorMessage } from '@/lib/errors';
import { useStaffProfile, useUpdateStaff, type StaffProfile } from './api';
import { ScheduleEditor } from './schedule-editor';

// A stylist's page for ADMIN (05 §3 admin/staff/[id]): profile, services, schedule, time-off.
export function StaffDetail({ id }: { id: string }) {
  const profile = useStaffProfile(id);
  if (profile.isPending) return <LoadingList rows={3} label="Loading stylist" />;
  if (profile.error) {
    if (profile.error instanceof ApiError && profile.error.status === 404) {
      return (
        <div className="grid justify-items-start gap-3">
          <h1 className="text-2xl font-semibold">Stylist not found</h1>
          <Button asChild variant="outline">
            <Link href="/admin/staff">Back to stylists</Link>
          </Button>
        </div>
      );
    }
    return <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />;
  }
  const s = profile.data;
  return (
    <section className="grid gap-6">
      <div className="grid gap-2">
        <Link href="/admin/staff" className="text-sm text-muted-foreground underline">
          Stylists
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold">{s.displayName}</h1>
          <Badge variant={s.isActive === false ? 'secondary' : 'success'}>
            {s.isActive === false ? 'Inactive' : 'Active'}
          </Badge>
        </div>
      </div>
      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          <TabsTrigger value="time-off">Time off</TabsTrigger>
        </TabsList>
        <TabsContent value="profile">
          <ProfileForm key={s.id} profile={s} />
        </TabsContent>
        <TabsContent value="schedule">
          <ScheduleEditor staffId={s.id} />
        </TabsContent>
        <TabsContent value="time-off">
          <TimeOffManager staffId={s.id} canForce />
        </TabsContent>
      </Tabs>
    </section>
  );
}

function activationMessage(isActive: boolean, force: boolean): string {
  if (isActive) return 'Stylist activated.';
  return force
    ? 'Stylist deactivated; their future bookings were cancelled.'
    : 'Stylist deactivated.';
}

function ProfileForm({ profile }: { profile: StaffProfile }) {
  const services = useServices();
  const update = useUpdateStaff(profile.id);
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [bio, setBio] = useState(profile.bio ?? '');
  const [photoUrl, setPhotoUrl] = useState<string | null>(profile.photoUrl ?? null);
  const [serviceIds, setServiceIds] = useState(profile.serviceIds);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'deactivate' | 'force' | null>(null);
  const active = profile.isActive !== false;

  const save = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (displayName.trim().length < 2) return setError('Enter a display name.');
    update.mutate(
      { displayName: displayName.trim(), bio: bio.trim() || null, photoUrl, serviceIds },
      {
        onSuccess: () => toast.success('Profile saved.'),
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };

  const setActive = (isActive: boolean, force = false) =>
    update.mutate(
      { isActive, ...(force ? { force: true } : {}) },
      {
        onSuccess: () => {
          setConfirm(null);
          toast.success(activationMessage(isActive, force));
        },
        onError: (err) => {
          if (err instanceof ApiError && err.code === 'ACTIVE_BOOKINGS_EXIST' && !force)
            return setConfirm('force');
          setConfirm(null);
          setError(errorMessage(err));
        },
      },
    );

  return (
    <div className="grid max-w-2xl gap-8">
      <form onSubmit={save} className="grid gap-4">
        <FormError>{error}</FormError>
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
        <ImageUpload label="Photo" value={photoUrl} onChange={setPhotoUrl} />
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-medium">Services they perform</legend>
          {(services.data ?? []).map((s) => (
            <CheckboxField
              key={s.id}
              label={s.name}
              checked={serviceIds.includes(s.id)}
              onChange={(e) =>
                setServiceIds((ids) =>
                  e.target.checked ? [...ids, s.id] : ids.filter((x) => x !== s.id),
                )
              }
            />
          ))}
        </fieldset>
        <Button type="submit" disabled={update.isPending} className="justify-self-start">
          Save profile
        </Button>
      </form>
      <div className="grid gap-2 border-t pt-6">
        <h2 className="text-lg font-semibold">{active ? 'Deactivate' : 'Activate'}</h2>
        <p className="text-sm text-muted-foreground">
          {active
            ? 'Deactivated stylists disappear from the website and can no longer be booked.'
            : 'Make this stylist bookable again.'}
        </p>
        <Button
          variant={active ? 'outline' : 'default'}
          className="justify-self-start"
          disabled={update.isPending}
          onClick={() => (active ? setConfirm('deactivate') : setActive(true))}
        >
          {active ? 'Deactivate stylist' : 'Activate stylist'}
        </Button>
      </div>
      <ConfirmDialog
        open={confirm === 'deactivate'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Deactivate ${profile.displayName}?`}
        description="They will no longer be bookable online or at the desk."
        confirmLabel="Deactivate"
        pending={update.isPending}
        onConfirm={() => setActive(false)}
      />
      <ConfirmDialog
        open={confirm === 'force'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="This stylist has upcoming bookings"
        description="Deactivating now cancels those bookings and notifies the customers (BR-014). To keep them, reschedule them to another stylist first."
        confirmLabel="Cancel bookings and deactivate"
        pending={update.isPending}
        onConfirm={() => setActive(false, true)}
      />
    </div>
  );
}
