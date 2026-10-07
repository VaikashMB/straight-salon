'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { FormError } from '@/components/form/form-error';
import { TextField } from '@/components/form/text-field';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/AuthProvider';
import { ApiError, ERROR_MESSAGES, errorMessage } from '@/lib/errors';
import { resetPassword } from '../api';
import { resetPasswordSchema, type ResetPasswordValues } from '../schemas';
import { AuthCard } from './auth-card';
import { applyFieldErrors } from './server-errors';

const requestNewLink = (
  <Link href="/forgot-password" className="underline">
    Request a new link
  </Link>
);

// API-007 (FR-004): the emailed link carries ?token=…; every session ends on success.
export function ResetPasswordForm() {
  const { api } = useAuth();
  const router = useRouter();
  const token = useSearchParams().get('token');
  const [formError, setFormError] = useState<ReactNode>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordValues, unknown, z.output<typeof resetPasswordSchema>>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(async ({ newPassword }) => {
    if (!token) return;
    setFormError(null);
    try {
      await resetPassword(api, token, newPassword);
      toast.success('Your password has been changed. Please sign in.');
      router.replace('/login');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INVALID_RESET_TOKEN') {
        setFormError(
          <>
            {ERROR_MESSAGES.INVALID_RESET_TOKEN} {requestNewLink}
          </>,
        );
      } else if (!applyFieldErrors(error, setError, ['newPassword'])) {
        setFormError(errorMessage(error));
      }
    }
  });

  if (!token) {
    return (
      <AuthCard title="Reset your password">
        <FormError>This page needs the link from your reset email. {requestNewLink}</FormError>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password" description="You'll be signed out everywhere else.">
      <form noValidate onSubmit={(e) => void onSubmit(e)} className="grid gap-4">
        <FormError>{formError}</FormError>
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
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Change password'}
        </Button>
      </form>
    </AuthCard>
  );
}
