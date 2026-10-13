import { Check } from 'lucide-react';
import Image from 'next/image';
import type { ReactNode } from 'react';
import { Monogram } from '@/components/layout/brand';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { publicEnv } from '@/lib/env';

// The photo panel's words and picture for each kind of auth page (05 §2).
export type AuthScene = 'welcome' | 'join' | 'help';

const SCENES: Record<
  AuthScene,
  { photo: string; eyebrow: string; heading: ReactNode; perks: string[] }
> = {
  welcome: {
    photo: '/salon/b.webp',
    eyebrow: 'Welcome back',
    heading: (
      <>
        Your chair is <em className="text-[#d4b483]">waiting</em>.
      </>
    ),
    perks: ['Every booking in one place', 'Reschedule or cancel online', 'Pay at the salon'],
  },
  join: {
    photo: '/looks/haircut.webp',
    eyebrow: 'New here?',
    heading: (
      <>
        Look <em className="text-[#d4b483]">sharp</em>, every visit.
      </>
    ),
    perks: [
      'Book in under a minute',
      'Pick your stylist, or let us match you',
      'Reminders before every visit',
    ],
  },
  help: {
    photo: '/salon/c.webp',
    eyebrow: 'Account help',
    heading: (
      <>
        Back in the chair in <em className="text-[#d4b483]">no time</em>.
      </>
    ),
    perks: [
      'A secure link by email',
      'Expires after a short while',
      'Signed out everywhere else after',
    ],
  },
};

// Shared frame for the sign-in, register and password pages. On large screens a photo panel
// (the salon's mark, a serif line and three perks) sits beside the form; on phones it is just
// the lifted card on the brass-glow backdrop, so the form stays within thumb reach.
export function AuthCard({
  title,
  description,
  footer,
  scene = 'welcome',
  children,
}: {
  title: string;
  description?: ReactNode;
  footer?: ReactNode;
  scene?: AuthScene;
  children: ReactNode;
}) {
  const art = SCENES[scene];
  return (
    <div className="relative isolate overflow-hidden bg-hero">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-grain" />
      <div className="mx-auto grid min-h-[calc(100svh-4rem)] w-full max-w-6xl items-center gap-10 px-4 py-12 sm:py-16 lg:grid-cols-[1.1fr_1fr] lg:gap-14 lg:py-10">
        <aside
          data-scene={scene}
          className="relative hidden h-full min-h-[34rem] animate-fade-in overflow-hidden rounded-[1.75rem] bg-[#161412] text-[#faf7f2] shadow-lift lg:block"
        >
          <Image
            src={art.photo}
            alt=""
            fill
            priority
            sizes="(min-width: 1024px) 560px, 1px"
            className="animate-ken-burns object-cover"
          />
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-t from-[#111111]/95 via-[#111111]/45 to-[#111111]/20"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-4 rounded-[1.25rem] ring-1 ring-[#c4a272]/45"
          />
          <div className="relative flex h-full flex-col justify-between p-10">
            <p className="inline-flex items-center gap-2.5 font-serif text-xl tracking-tight">
              <Monogram className="size-9 text-[#faf7f2]" />
              <span>
                {publicEnv.appName}
                <span aria-hidden className="text-accent">
                  .
                </span>
              </span>
            </p>
            <div className="grid gap-5">
              <p className="text-xs font-semibold tracking-[0.22em] text-[#d4b483] uppercase">
                {art.eyebrow}
              </p>
              <p className="max-w-md font-serif text-5xl leading-[1.05] tracking-tight">
                {art.heading}
              </p>
              <div aria-hidden className="rule-brass w-16" />
              <ul className="grid gap-2.5 text-sm text-[#faf7f2]/85">
                {art.perks.map((perk) => (
                  <li key={perk} className="flex items-center gap-2.5">
                    <span
                      aria-hidden
                      className="grid size-5 shrink-0 place-content-center rounded-full bg-[#c4a272]/20 text-[#d4b483] ring-1 ring-[#c4a272]/40"
                    >
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                    {perk}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </aside>

        <Card className="w-full max-w-md animate-fade-up justify-self-center rounded-2xl border-accent/20 shadow-lift lg:max-w-[28rem]">
          <CardHeader className="gap-3">
            <CardTitle className="font-serif text-4xl font-normal tracking-tight">
              {title}
            </CardTitle>
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
