'use client';

import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/AuthProvider';

// API-004: ends this device's session and returns to the home page.
export function SignOutButton({ variant = 'ghost' }: { variant?: 'ghost' | 'outline' }) {
  const { logout } = useAuth();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const signOut = async () => {
    setPending(true);
    await logout();
    toast.success('You have been signed out.');
    router.replace('/');
  };
  return (
    <Button variant={variant} size="sm" disabled={pending} onClick={() => void signOut()}>
      <LogOut aria-hidden />
      Sign out
    </Button>
  );
}
