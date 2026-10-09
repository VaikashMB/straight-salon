import type { ReactNode } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

// Shared frame for the sign-in, register and password pages: a lifted card centred on the
// brass-glow backdrop with film grain (decorative layer).
export function AuthCard({
  title,
  description,
  footer,
  children,
}: {
  title: string;
  description?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="relative isolate overflow-hidden bg-hero">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-grain" />
      <div className="mx-auto flex min-h-[calc(100svh-4rem)] w-full max-w-md flex-col justify-center px-4 py-12 sm:py-20">
        <Card className="animate-fade-up rounded-2xl border-accent/20 shadow-lift">
          <CardHeader className="gap-3">
            <CardTitle className="text-3xl tracking-tight">{title}</CardTitle>
            <div aria-hidden className="rule-brass" />
            {description ? <CardDescription>{description}</CardDescription> : null}
          </CardHeader>
          <CardContent>{children}</CardContent>
          {footer ? (
            <CardFooter className="justify-center border-t pt-6 text-sm text-muted-foreground">
              {footer}
            </CardFooter>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
