'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { FormError } from '@/components/form/form-error';
import { SelectField } from '@/components/form/select-field';
import { TextField } from '@/components/form/text-field';
import { PageHeader } from '@/components/page-header';
import { ErrorState, LoadingList } from '@/components/states/list-states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { applyFieldErrors } from '@/features/auth/components/server-errors';
import { WEEKDAYS } from '@/features/catalog/hours';
import { unwrap, type Schemas } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';
import { ApiError, errorMessage } from '@/lib/errors';
import { publicSettingsKey } from '@/lib/settings';
import { HolidaysAdmin } from './holidays-admin';

type Settings = Schemas['Settings'];

const minutes = (label: string, min: number, max: number) =>
  z.coerce
    .number<string>()
    .int(`${label}: whole minutes`)
    .min(min, `${label}: at least ${min}`)
    .max(max, `${label}: at most ${max}`);

export const settingsSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter the salon name').max(80),
    address: z.string().max(200),
    phone: z.string().max(20),
    email: z.union([z.literal(''), z.email('Enter a valid email address')]),
    timezone: z.string().min(1),
    currency: z.string().regex(/^[A-Z]{3}$/, 'Use a 3-letter ISO code like INR'),
    slotGranularityMin: minutes('Slot size', 5, 60),
    bufferMin: minutes('Buffer', 0, 120),
    minLeadTimeMin: minutes('Lead time', 0, 7 * 24 * 60),
    maxAdvanceDays: z.coerce
      .number<string>()
      .int()
      .min(1, 'At least 1 day')
      .max(365, 'At most 365 days'),
    cancellationCutoffMin: minutes('Cut-off', 0, 7 * 24 * 60),
    noShowGraceMin: minutes('Grace period', 0, 240),
    reviewWindowDays: z.coerce
      .number<string>()
      .int()
      .min(1, 'At least 1 day')
      .max(90, 'At most 90 days'),
    businessHours: z.array(
      z.object({ dayOfWeek: z.number(), isOpen: z.boolean(), open: z.string(), close: z.string() }),
    ),
  })
  .superRefine((v, ctx) => {
    v.businessHours.forEach((h, i) => {
      if (h.isOpen && h.open >= h.close) {
        ctx.addIssue({
          code: 'custom',
          path: ['businessHours', i, 'close'],
          message: `${WEEKDAYS[h.dayOfWeek]}: closing must be after opening`,
        });
      }
    });
  });

type Values = z.input<typeof settingsSchema>;

function toValues(s: Settings): Values {
  return {
    name: s.name,
    address: s.address ?? '',
    phone: s.phone ?? '',
    email: s.email ?? '',
    timezone: s.timezone,
    currency: s.currency,
    slotGranularityMin: String(s.slotGranularityMin),
    bufferMin: String(s.bufferMin),
    minLeadTimeMin: String(s.minLeadTimeMin),
    maxAdvanceDays: String(s.maxAdvanceDays),
    cancellationCutoffMin: String(s.cancellationCutoffMin),
    noShowGraceMin: String(s.noShowGraceMin),
    reviewWindowDays: String(s.reviewWindowDays),
    businessHours: [...s.businessHours].sort(
      (a, b) => ((a.dayOfWeek + 6) % 7) - ((b.dayOfWeek + 6) % 7),
    ),
  };
}

// Salon settings (FR-080, API-017/018) and holidays (FR-022, API-019/020).
export function SettingsAdmin() {
  const { api } = useAuth();
  const settings = useQuery({
    queryKey: ['settings', 'full'],
    queryFn: () => unwrap(api.GET('/api/v1/settings')),
  });

  const renderSettings = () => {
    if (settings.isPending) return <LoadingList rows={4} label="Loading settings" />;
    if (settings.error)
      return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;
    return <SettingsForm key={settings.data.updatedAt ?? 'settings'} settings={settings.data} />;
  };

  return (
    <section className="grid gap-10">
      <PageHeader title="Settings" />
      {renderSettings()}
      <HolidaysAdmin />
    </section>
  );
}

function SettingsForm({ settings }: { settings: Settings }) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const zones =
    typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : [settings.timezone];
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values, unknown, z.output<typeof settingsSchema>>({
    resolver: zodResolver(settingsSchema),
    defaultValues: toValues(settings),
  });
  const { fields } = useFieldArray({ control, name: 'businessHours' });
  const hours = useWatch({ control, name: 'businessHours' });

  const save = useMutation({
    mutationFn: (v: z.output<typeof settingsSchema>) =>
      unwrap(
        api.PUT('/api/v1/settings', {
          body: {
            ...v,
            ...(v.address.trim() ? { address: v.address.trim() } : { address: undefined }),
            ...(v.phone.trim() ? { phone: v.phone.trim() } : { phone: undefined }),
            ...(v.email ? { email: v.email } : { email: undefined }),
          },
        }),
      ),
    onSuccess: async (saved) => {
      queryClient.setQueryData(['settings', 'full'], saved);
      await queryClient.invalidateQueries({ queryKey: publicSettingsKey });
      await queryClient.invalidateQueries({ queryKey: ['availability'] });
      toast.success('Settings saved.');
    },
  });

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      await save.mutateAsync(v);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'ACTIVE_BOOKINGS_EXIST') {
        setError('timezone', {
          type: 'server',
          message: "The timezone can't change while future bookings exist.",
        });
      } else if (error instanceof ApiError && error.code === 'INVALID_DURATION') {
        setError('slotGranularityMin', {
          type: 'server',
          message: 'Every service duration must be a multiple of the slot size.',
        });
      } else if (!applyFieldErrors(error, setError, ['name', 'email', 'currency', 'timezone'])) {
        setFormError(errorMessage(error));
      }
    }
  });

  return (
    <form noValidate onSubmit={(e) => void onSubmit(e)} className="grid gap-8">
      <FormError>{formError}</FormError>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-lg font-semibold">Salon</legend>
        <TextField label="Name" error={errors.name?.message} {...register('name')} />
        <TextField label="Phone" type="tel" error={errors.phone?.message} {...register('phone')} />
        <TextField
          label="Address"
          className="sm:col-span-2"
          error={errors.address?.message}
          {...register('address')}
        />
        <TextField
          label="Email"
          type="email"
          error={errors.email?.message}
          {...register('email')}
        />
        <SelectField label="Timezone" error={errors.timezone?.message} {...register('timezone')}>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Currency"
          maxLength={3}
          error={errors.currency?.message}
          {...register('currency')}
        />
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="mb-3 text-lg font-semibold">Booking rules</legend>
        <TextField
          label="Slot size (minutes)"
          type="number"
          error={errors.slotGranularityMin?.message}
          {...register('slotGranularityMin')}
        />
        <TextField
          label="Buffer between bookings (minutes)"
          type="number"
          error={errors.bufferMin?.message}
          {...register('bufferMin')}
        />
        <TextField
          label="Minimum lead time (minutes)"
          type="number"
          error={errors.minLeadTimeMin?.message}
          {...register('minLeadTimeMin')}
        />
        <TextField
          label="Book up to (days ahead)"
          type="number"
          error={errors.maxAdvanceDays?.message}
          {...register('maxAdvanceDays')}
        />
        <TextField
          label="Cancellation cut-off (minutes)"
          type="number"
          error={errors.cancellationCutoffMin?.message}
          {...register('cancellationCutoffMin')}
        />
        <TextField
          label="No-show grace period (minutes)"
          type="number"
          error={errors.noShowGraceMin?.message}
          {...register('noShowGraceMin')}
        />
        <TextField
          label="Review window (days)"
          type="number"
          error={errors.reviewWindowDays?.message}
          {...register('reviewWindowDays')}
        />
      </fieldset>
      <fieldset className="grid gap-2">
        <legend className="mb-3 text-lg font-semibold">Business hours</legend>
        {fields.map((field, i) => {
          const name = WEEKDAYS[field.dayOfWeek]!;
          const open = hours[i]?.isOpen;
          const error = errors.businessHours?.[i]?.close?.message;
          return (
            <div key={field.id} className="grid gap-1">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex w-32 items-center gap-2 font-medium">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    {...register(`businessHours.${i}.isOpen`)}
                  />
                  {name}
                </label>
                {open ? (
                  <>
                    <Input
                      type="time"
                      aria-label={`${name} opens`}
                      className="w-32"
                      {...register(`businessHours.${i}.open`)}
                    />
                    to
                    <Input
                      type="time"
                      aria-label={`${name} closes`}
                      className="w-32"
                      {...register(`businessHours.${i}.close`)}
                    />
                  </>
                ) : (
                  <span className="text-muted-foreground">Closed</span>
                )}
              </div>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </div>
          );
        })}
      </fieldset>
      <Button type="submit" disabled={isSubmitting} className="justify-self-start">
        {isSubmitting ? 'Saving…' : 'Save settings'}
      </Button>
    </form>
  );
}
