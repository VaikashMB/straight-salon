'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { FormError } from '@/components/form/form-error';
import { TextField } from '@/components/form/text-field';
import { Button } from '@/components/ui/button';
import { applyFieldErrors } from '@/features/auth/components/server-errors';
import { newPasswordSchema } from '@/features/auth/schemas';
import { useAuth } from '@/lib/auth/AuthProvider';
import { errorMessage } from '@/lib/errors';
import { useChangePassword, useLogoutAll } from '../api';

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: newPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    error: "The passwords don't match",
    path: ['confirmPassword'],
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    error: 'Choose a password different from your current one',
    path: ['newPassword'],
  });

type Values = z.input<typeof changePasswordSchema>;

// API-008 (change password: other devices are signed out) and API-005 (sign out everywhere).
export function SecuritySettings() {
  const changePassword = useChangePassword();
  const logoutAll = useLogoutAll();
  const { logout } = useAuth();
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Values, unknown, z.output<typeof changePasswordSchema>>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(async ({ currentPassword, newPassword }) => {
    setFormError(null);
    try {
      await changePassword.mutateAsync({ currentPassword, newPassword });
      reset();
      toast.success('Password changed. Other devices have been signed out.');
    } catch (error) {
      if (!applyFieldErrors(error, setError, ['currentPassword', 'newPassword'])) {
        setFormError(errorMessage(error));
      }
    }
  });

  const signOutEverywhere = async () => {
    try {
      await logoutAll.mutateAsync();
    } catch (error) {
      toast.error(errorMessage(error));
      return;
    }
    await logout();
    toast.success('Signed out on all devices.');
    router.replace('/login');
  };

  return (
    <div className="grid gap-8">
      <form noValidate onSubmit={(e) => void onSubmit(e)} className="grid gap-4">
        <h2 className="text-lg font-semibold">Change password</h2>
        <FormError>{formError}</FormError>
        <TextField
          label="Current password"
          type="password"
          autoComplete="current-password"
          error={errors.currentPassword?.message}
          {...register('currentPassword')}
        />
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters, with a letter and a number."
          error={errors.newPassword?.message}
          {...register('newPassword')}
        />
        <TextField
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />
        <Button type="submit" disabled={isSubmitting} className="justify-self-start">
          {isSubmitting ? 'Saving…' : 'Change password'}
        </Button>
      </form>
      <div className="grid gap-2">
        <h2 className="text-lg font-semibold">Devices</h2>
        <p className="text-sm text-muted-foreground">
          Signed in on a shared or lost device? Sign out everywhere, including here.
        </p>
        <Button
          variant="outline"
          className="justify-self-start"
          disabled={logoutAll.isPending}
          onClick={() => void signOutEverywhere()}
        >
          Sign out of all devices
        </Button>
      </div>
    </div>
  );
}
