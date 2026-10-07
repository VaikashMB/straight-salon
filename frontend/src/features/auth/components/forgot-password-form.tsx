'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { FormError } from '@/components/form/form-error';
import { TextField } from '@/components/form/text-field';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/AuthProvider';
import { errorMessage } from '@/lib/errors';
import { requestPasswordReset } from '../api';
import { forgotPasswordSchema, type ForgotPasswordValues } from '../schemas';
import { AuthCard } from './auth-card';

// API-006 (FR-004). The same confirmation whether or not the account exists.
export function ForgotPasswordForm() {
  const { api } = useAuth();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordValues, unknown, z.output<typeof forgotPasswordSchema>>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit(async ({ email }) => {
    setFormError(null);
    try {
      await requestPasswordReset(api, email);
      setSentTo(email);
    } catch (error) {
      setFormError(errorMessage(error));
    }
  });

  const backToSignIn = (
    <Link href="/login" className="font-medium text-foreground underline">
      Back to sign in
    </Link>
  );

  if (sentTo) {
    return (
      <AuthCard title="Check your email" footer={backToSignIn}>
        <Alert variant="success">
          <MailCheck aria-hidden />
          <AlertTitle>Reset link sent</AlertTitle>
          <AlertDescription>
            If an account exists for {sentTo}, we have emailed a link to choose a new password. The
            link works once and expires in 30 minutes.
          </AlertDescription>
        </Alert>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Forgot your password?"
      description="Enter your email and we'll send you a link to choose a new one."
      footer={backToSignIn}
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
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Sending…' : 'Send reset link'}
        </Button>
      </form>
    </AuthCard>
  );
}
