'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { FormError } from '@/components/form/form-error';
import { TextField } from '@/components/form/text-field';
import { Button } from '@/components/ui/button';
import { loginSchema, type LoginValues } from '@/features/auth/schemas';
import { useAuth } from '@/lib/auth/AuthProvider';
import { ApiError, errorMessage } from '@/lib/errors';

// Step 4 for visitors (05 §4.1): sign in without leaving the wizard, or create an account and
// come straight back to this step (`next` keeps the selections).
export function InlineSignIn({ returnTo }: { returnTo: string }) {
  const { login } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues, unknown, z.output<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setFormError(null);
    try {
      await login(email, password);
    } catch (error) {
      setFormError(
        error instanceof ApiError && error.status === 401
          ? 'Incorrect email or password.'
          : errorMessage(error),
      );
    }
  });

  return (
    <section aria-labelledby="sign-in-to-book" className="grid gap-4 rounded-lg border bg-card p-5">
      <div className="grid gap-1">
        <h2 id="sign-in-to-book" className="text-lg font-semibold">
          Sign in to confirm
        </h2>
        <p className="text-sm text-muted-foreground">
          New here?{' '}
          <Link
            href={`/register?next=${encodeURIComponent(returnTo)}`}
            className="font-medium text-foreground underline"
          >
            Create an account
          </Link>{' '}
          and you&apos;ll come straight back to this booking.
        </p>
      </div>
      <form noValidate onSubmit={(e) => void onSubmit(e)} className="grid gap-4">
        <FormError>{formError}</FormError>
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...register('email')}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...register('password')}
        />
        <Button type="submit" variant="outline" disabled={isSubmitting}>
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </section>
  );
}
