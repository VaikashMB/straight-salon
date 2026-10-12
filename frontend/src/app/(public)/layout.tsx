import { ViewTransition, type ReactNode } from 'react';
import { AnnouncementBar } from '@/components/layout/announcement-bar';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';

// Page content sits in a <ViewTransition>, so route changes crossfade and named elements (a
// service's photo, a stylist's portrait) morph between pages where the browser supports it.
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <AnnouncementBar />
      <SiteHeader />
      <main className="flex-1">
        <ViewTransition>{children}</ViewTransition>
      </main>
      <SiteFooter />
    </div>
  );
}
