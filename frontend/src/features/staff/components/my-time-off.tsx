'use client';

import { PageHeader } from '@/components/page-header';
import { useAuth } from '@/lib/auth/AuthProvider';
import { TimeOffManager } from './time-off-manager';

// The signed-in stylist's own time off (timeoff:manage:own).
export function MyTimeOff() {
  const { staffId } = useAuth();
  return (
    <section className="grid max-w-2xl gap-6">
      <PageHeader
        eyebrow="Stylist"
        title="Time off"
        description="Block out holidays and appointments so nobody can book you then."
      />
      {staffId ? (
        <TimeOffManager staffId={staffId} canForce={false} />
      ) : (
        <p className="rounded-2xl border border-dashed bg-card/60 p-6 text-muted-foreground">
          Your account isn&apos;t linked to a stylist profile yet. Ask the salon admin to set it up.
        </p>
      )}
    </section>
  );
}
