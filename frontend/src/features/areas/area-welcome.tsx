'use client';

import { useAuth } from '@/lib/auth/AuthProvider';

// Phase 8 landing pages for the signed-in areas (decision 2026-10-07): prove sign-in, role
// landing and route protection end to end until the real pages arrive (Phase 9 and 10).
export function AreaWelcome({ heading, comingSoon }: { heading: string; comingSoon: string }) {
  const { user } = useAuth();
  const firstName = user?.name.split(/\s+/)[0] ?? '';
  return (
    <section className="grid gap-2">
      <h1 className="text-3xl font-semibold">
        {heading}, {firstName}
      </h1>
      <p className="text-muted-foreground">{comingSoon}</p>
    </section>
  );
}
