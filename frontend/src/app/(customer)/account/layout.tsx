import type { ReactNode } from 'react';
import { AreaShell } from '@/components/layout/area-shell';

export default function Layout({ children }: { children: ReactNode }) {
  return <AreaShell area="account">{children}</AreaShell>;
}
