'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { CheckboxField } from '@/components/form/checkbox-field';
import { FormError } from '@/components/form/form-error';
import { SelectField } from '@/components/form/select-field';
import { TextField } from '@/components/form/text-field';
import { Button } from '@/components/ui/button';
import { applyFieldErrors } from '@/features/auth/components/server-errors';
import { phoneSchema } from '@/features/auth/schemas';
import { useStylists } from '@/features/booking/api';
import type { User } from '@/lib/auth/AuthProvider';
import { ApiError, errorMessage } from '@/lib/errors';
import { useUpdateProfile } from '../api';

export const profileSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(80, 'Use at most 80 characters'),
  phone: phoneSchema(),
  preferredStaffId: z.string(),
  smsOptIn: z.boolean(),
  emailOptIn: z.boolean(),
});

type Values = z.input<typeof profileSchema>;

// FR-005 / API-010: name, phone and preferences (preferred stylist, reminder channels, FR-054).
export function ProfileForm({ user }: { user: User }) {
  const update = useUpdateProfile();
  const stylists = useStylists();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values, unknown, z.output<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: user.name,
      phone: user.phone,
      preferredStaffId: user.preferences.preferredStaffId ?? '',
      smsOptIn: user.preferences.smsOptIn,
      emailOptIn: user.preferences.emailOptIn,
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await update.mutateAsync({
        name: values.name,
        phone: values.phone,
        preferences: {
          smsOptIn: values.smsOptIn,
          emailOptIn: values.emailOptIn,
          ...(values.preferredStaffId ? { preferredStaffId: values.preferredStaffId } : {}),
        },
      });
      toast.success('Your profile has been saved.');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'DUPLICATE') {
        setError('phone', { type: 'server', message: 'This number belongs to another account.' });
      } else if (!applyFieldErrors(error, setError, ['name', 'phone'])) {
        setFormError(errorMessage(error));
      }
    }
  });

  return (
    <form noValidate onSubmit={(e) => void onSubmit(e)} className="grid gap-4">
      <FormError>{formError}</FormError>
      <TextField
        label="Full name"
        autoComplete="name"
        error={errors.name?.message}
        {...register('name')}
      />
      <TextField
        label="Mobile number"
        type="tel"
        autoComplete="tel"
        error={errors.phone?.message}
        {...register('phone')}
      />
      <TextField
        label="Email"
        type="email"
        value={user.email ?? ''}
        disabled
        readOnly
        hint="Contact the salon to change your email."
      />
      <SelectField label="Preferred stylist" {...register('preferredStaffId')}>
        <option value="">No preference</option>
        {(stylists.data ?? []).map((s) => (
          <option key={s.id} value={s.id}>
            {s.displayName}
          </option>
        ))}
      </SelectField>
      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-medium">Booking messages</legend>
        <CheckboxField label="Email me confirmations and reminders" {...register('emailOptIn')} />
        <CheckboxField label="Text me reminders (SMS)" {...register('smsOptIn')} />
      </fieldset>
      <Button type="submit" disabled={isSubmitting} className="justify-self-start">
        {isSubmitting ? 'Saving…' : 'Save profile'}
      </Button>
    </form>
  );
}
