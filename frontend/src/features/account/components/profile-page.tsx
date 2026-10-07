'use client';

import { useAuth } from '@/lib/auth/AuthProvider';
import { ProfileForm } from './profile-form';
import { SecuritySettings } from './security-settings';

export function ProfilePage() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div className="grid max-w-xl gap-10">
      <section className="grid gap-4">
        <h1 className="text-3xl font-semibold">Profile</h1>
        <ProfileForm user={user} />
      </section>
      <section className="grid gap-4 border-t pt-8">
        <SecuritySettings />
      </section>
    </div>
  );
}
