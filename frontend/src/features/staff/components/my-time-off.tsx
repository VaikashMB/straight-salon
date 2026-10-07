'use client';

import { useAuth } from '@/lib/auth/AuthProvider';
import { TimeOffManager } from './time-off-manager';

// The signed-in stylist's own time off (timeoff:manage:own).
export function MyTimeOff() {
  const { staffId } = useAuth();
  return (
    <section className="grid max-w-2xl gap-6">
      <h1 className="text-3xl font-semibold">Time off</h1>
      {staffId ? (
        <TimeOffManager staffId={staffId} canForce={false} />
      ) : (
        <p className="text-muted-foreground">
          Your account isn&apos;t linked to a stylist profile yet. Ask the salon admin to set it up.
        </p>
      )}
    </section>
  );
}
