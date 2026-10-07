import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from '@/features/auth/components/login-form';

export const metadata: Metadata = { title: 'Sign in' };

// useSearchParams (?next=) needs a Suspense boundary for static rendering.
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
