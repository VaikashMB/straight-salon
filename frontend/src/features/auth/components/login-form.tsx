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
import { ApiError, errorMessage } from '@/lib/errors';
import { loginSchema, type LoginValues } from '../schemas';
import { AuthCard } from './auth-card';
import { useSignedInRedirect } from './use-signed-in-redirect';

// API-002. Wrong password, unknown email and inactive accounts all get the same 401 (06 §2).
export function LoginForm() {
  const { login } = useAuth();
  const next = useSearchParams().get('next');
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues, unknown, z.output<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  useSignedInRedirect();

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setFormError(null);
    try {
      const user = await login(email, password);
      toast.success(`Welcome back, ${user.name.split(/\s+/)[0] ?? user.name}`);
    } catch (error) {
      setFormError(
        error instanceof ApiError && error.status === 401
          ? 'Incorrect email or password.'
          : errorMessage(error),
      );
    }
  });

  const registerHref = next ? `/register?next=${encodeURIComponent(next)}` : '/register';
  return (
    <AuthCard
      title="Sign in"
      description="Welcome back. Sign in to book and manage your appointments."
      footer={
        <span>
          New here?{' '}
          <Link href={registerHref} className="font-medium text-foreground underline">
            Create an account
          </Link>
        </span>
      }
    >
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
        <div className="-mt-2 text-right text-sm">
          <Link href="/forgot-password" className="underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthCard>
  );
}
