import { publicEnv } from '@/lib/env';

export function SiteFooter() {
  return (
    <footer className="border-t text-muted-foreground">
      <div className="mx-auto max-w-6xl px-4 py-6 text-sm">
        © {new Date().getFullYear()} {publicEnv.appName}
      </div>
    </footer>
  );
}
