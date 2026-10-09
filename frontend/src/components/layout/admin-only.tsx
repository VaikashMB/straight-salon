'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import { IconTile } from '@/components/icon-tile';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/AuthProvider';

// ADMIN-only pages inside the shared admin area (05 §3): reception is told, not shown a broken
// page. The API enforces the permission either way.
export function AdminOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== 'ADMIN') {
    return (
      <div className="mx-auto grid max-w-md animate-fade-up justify-items-center gap-4 rounded-2xl border bg-card px-6 py-12 text-center shadow-soft">
        <IconTile icon={ShieldAlert} size="lg" />
        <h1 className="text-2xl font-semibold">This page is for admins</h1>
        <p className="text-muted-foreground">Ask the salon owner if you need access.</p>
        <Button asChild variant="outline">
          <Link href="/admin">Back to the dashboard</Link>
        </Button>
      </div>
    );
  }
  return children;
}
