'use client';

import { PageHeader } from '@/components/page-header';
import { useAuth } from '@/lib/auth/AuthProvider';
import { ProfileForm } from './profile-form';
import { SecuritySettings } from './security-settings';

export function ProfilePage() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div className="grid max-w-2xl gap-6">
      <PageHeader
        eyebrow="My account"
        title="Profile"
        description="Your details, notification choices and sign-in security."
      />
      <section className="animate-fade-up rounded-2xl border bg-card p-5 shadow-soft [animation-delay:60ms] sm:p-6">
        <ProfileForm user={user} />
      </section>
      <section className="animate-fade-up rounded-2xl border bg-card p-5 shadow-soft [animation-delay:120ms] sm:p-6">
        <SecuritySettings />
      </section>
    </div>
  );
}
