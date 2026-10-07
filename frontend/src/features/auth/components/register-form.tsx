'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { FormError } from '@/components/form/form-error';
import { TextField } from '@/components/form/text-field';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/AuthProvider';
import { publicEnv } from '@/lib/env';
import { ApiError, ERROR_MESSAGES, errorMessage } from '@/lib/errors';
import { registerSchema, type RegisterValues } from '../schemas';
import { AuthCard } from './auth-card';
import { applyFieldErrors } from './server-errors';
import { useSignedInRedirect } from './use-signed-in-redirect';

const FIELDS = ['name', 'email', 'phone', 'password'] as const;

// API-001 (FR-001). Signs the new customer straight in.
export function RegisterForm() {
  const { register: createAccount } = useAuth();
  const next = useSearchParams().get('next');
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues, unknown, z.output<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', phone: '', password: '' },
  });
  useSignedInRedirect();

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const user = await createAccount(values);
      toast.success(`Welcome, ${user.name.split(/\s+/)[0] ?? user.name}! Your account is ready.`);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'PHONE_ALREADY_REGISTERED') {
        setError('phone', { type: 'server', message: ERROR_MESSAGES.PHONE_ALREADY_REGISTERED });
      } else if (error instanceof ApiError && error.code === 'DUPLICATE') {
        setFormError('An account with this email or phone number already exists. Sign in instead.');
      } else if (!applyFieldErrors(error, setError, FIELDS)) {
        setFormError(errorMessage(error));
      }
    }
  });

  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : '/login';
  return (
    <AuthCard
      title="Create your account"
      description="Book in under a minute and manage your appointments online."
      footer={
        <span>
          Already have an account?{' '}
          <Link href={loginHref} className="font-medium text-foreground underline">
            Sign in
          </Link>
        </span>
      }
    >
      <form noValidate onSubmit={(e) => void onSubmit(e)} className="grid gap-4">
        <FormError>{formError}</FormError>
        <TextField
          label="Full name"
          autoComplete="name"
          error={errors.name?.message}
          {...register('name')}
        />
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...register('email')}
        />
        <TextField
          label="Mobile number"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          hint={`Without a country code we'll assume +${publicEnv.defaultCountryCode}.`}
          error={errors.phone?.message}
          {...register('phone')}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters, with a letter and a number."
          error={errors.password?.message}
          {...register('password')}
        />
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthCard>
  );
}
