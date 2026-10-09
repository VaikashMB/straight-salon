'use client';

import { CalendarDays, ChevronDown, LayoutDashboard, LogOut, Sun } from 'lucide-react';
import Link from 'next/link';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { UserAvatar } from '@/components/user-avatar';
import { firstName } from '@/features/booking/status';
import type { Schemas } from '@/lib/api/client';
import { landingFor, ROLE_LABEL, type Role } from '@/lib/auth/roles';
import { useSignOut } from './sign-out-button';

export const AREA_LABEL: Record<Role, string> = {
  CUSTOMER: 'My bookings',
  STAFF: 'My day',
  RECEPTIONIST: 'Dashboard',
  ADMIN: 'Dashboard',
};
const AREA_ICON = {
  CUSTOMER: CalendarDays,
  STAFF: Sun,
  RECEPTIONIST: LayoutDashboard,
  ADMIN: LayoutDashboard,
} as const;

// The public header's signed-in control: the avatar (and first name from lg up) opens a menu
// with who is signed in, a link to their area and sign out (Radix menu: keyboard, Escape and
// focus return built in).
export function ProfileMenu({ user }: { user: Schemas['User'] }) {
  const { signOut, pending } = useSignOut();
  const AreaIcon = AREA_ICON[user.role];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account menu for ${user.name}`}
        className="flex h-10 items-center gap-2 rounded-full py-1 pr-2 pl-1 text-sm transition-colors outline-none hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-secondary"
      >
        <UserAvatar name={user.name} className="size-8 text-xs" />
        <span aria-hidden className="hidden max-w-32 truncate font-medium lg:inline">
          {firstName(user.name)}
        </span>
        <ChevronDown aria-hidden className="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex items-center gap-3">
          <UserAvatar name={user.name} />
          <span className="grid min-w-0">
            <span className="truncate font-medium">{user.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {user.email ?? ROLE_LABEL[user.role]}
            </span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={landingFor(user.role)}>
            <AreaIcon aria-hidden />
            {AREA_LABEL[user.role]}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={pending} onSelect={() => void signOut()}>
          <LogOut aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
