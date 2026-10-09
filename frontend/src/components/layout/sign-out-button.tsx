'use client';

import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/AuthProvider';

// API-004: ends this device's session and returns to the home page. Shared by the button and
// the public header's profile menu.
export function useSignOut() {
  const { logout } = useAuth();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const signOut = async () => {
    setPending(true);
    await logout();
    toast.success('You have been signed out.');
    router.replace('/');
  };
  return { signOut, pending };
}

// `className` lets a surface restyle it (e.g. the dark sidebar).
export function SignOutButton({
  variant = 'ghost',
  className,
}: {
  variant?: 'ghost' | 'outline';
  className?: string;
}) {
  const { signOut, pending } = useSignOut();
  return (
    <Button
      variant={variant}
      size="sm"
      className={className}
      disabled={pending}
      onClick={() => void signOut()}
    >
      <LogOut aria-hidden />
      Sign out
    </Button>
  );
}
