'use client';

import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';
import { ArrowRight, CalendarPlus, Clock, MapPin, Navigation, ReceiptText } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useServices, useStylists, type Booking } from '@/features/booking/api';
import { ChangeActions } from '@/features/booking/components/change-actions';
import { StatusBadge } from '@/features/booking/components/status-badge';
import { bookingCalendarFile, downloadFile } from '@/features/booking/ics';
import { directionsUrl } from '@/features/catalog/location';
import { StylistAvatar } from '@/features/catalog/components/stylist-avatar';
import { formatMoney, formatTime } from '@/lib/format';
import type { PublicSettings } from '@/lib/settings';
import { countdown, formatMinutes } from '@/lib/time';

const FALLBACK_PHOTO = '/salon/b.webp';

// The customer's next appointment, larger than the rest of the list (05 §4.2): the first
// service's photo with a countdown and the date in the serif, then what, when, with whom and
// where, and the things people do before a visit (add to calendar, directions, change it).
// Photos come from the public catalogue (already cached by the site), falling back to a studio
// photo for a service without one.
export function NextVisitCard({
  booking,
  settings,
  now,
}: {
  booking: Booking;
  settings: PublicSettings;
  now?: Date;
}) {
  const services = useServices();
  const stylists = useStylists();
  const tz = settings.timezone;
  const zoned = new TZDate(new Date(booking.startAt).getTime(), tz);
  const photo =
    booking.services
      .map((s) => services.data?.find((c) => c.id === s.serviceId)?.imageUrl)
      .find(Boolean) ?? FALLBACK_PHOTO;
  const stylistPhoto = stylists.data?.find((s) => s.id === booking.staff.id)?.photoUrl;
  const duration = booking.services.reduce((sum, s) => sum + s.durationMin, 0);

  const addToCalendar = () => {
    const file = bookingCalendarFile(booking, settings);
    downloadFile(file.filename, file.content);
  };

  return (
    <article
      aria-labelledby="next-visit"
      className="grid animate-fade-up overflow-hidden rounded-3xl border bg-card shadow-lift md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]"
    >
      <div className="relative isolate flex min-h-60 flex-col justify-end overflow-hidden bg-[#161412] p-6 text-[#faf7f2] sm:p-8 md:min-h-[22rem]">
        <Image
          src={photo}
          alt=""
          fill
          sizes="(min-width: 768px) 420px, 100vw"
          unoptimized={/^https?:/.test(photo)}
          className="-z-10 animate-ken-burns object-cover"
        />
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-gradient-to-t from-[#111111]/90 via-[#111111]/35 to-transparent"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-3 rounded-[1.25rem] ring-1 ring-[#c4a272]/40"
        />
        <p className="mb-4 inline-flex items-center gap-1.5 self-start rounded-full bg-[#c4a272] px-3 py-1 text-xs font-semibold tracking-wide text-[#111111] shadow-soft">
          <Clock aria-hidden className="size-3.5" />
          {countdown(booking.startAt, tz, now)}
        </p>
        <p className="font-serif text-4xl leading-none tracking-tight sm:text-5xl">
          {format(zoned, 'EEEE')}
        </p>
        <p className="mt-2 text-lg text-[#faf7f2]/85">
          {format(zoned, 'd MMMM')} ·{' '}
          <span className="font-heading font-semibold text-[#faf7f2] tabular-nums">
            {formatTime(booking.startAt, tz)}
          </span>
        </p>
      </div>

      <div className="grid content-between gap-6 p-6 sm:p-8">
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold tracking-[0.18em] text-accent-ink uppercase">
              Your next visit
            </p>
            <StatusBadge status={booking.status} />
          </div>
          <h2 id="next-visit" className="font-serif text-2xl leading-tight sm:text-3xl">
            <Link
              href={`/account/bookings/${booking.id}`}
              className="rounded-sm outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {booking.services.map((s) => s.name).join(' + ')}
            </Link>
          </h2>
          <div className="flex items-center gap-3">
            <StylistAvatar
              name={booking.staff.displayName}
              photoUrl={stylistPhoto}
              size={44}
              className="ring-2 ring-accent/40 ring-offset-2 ring-offset-card"
            />
            <p className="grid text-sm leading-tight">
              <span className="text-muted-foreground">Your stylist</span>
              <span className="font-medium">{booking.staff.displayName}</span>
            </p>
          </div>
          <dl className="grid gap-2 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <dt>
                <Clock aria-hidden className="size-4 text-accent" />
                <span className="sr-only">Time</span>
              </dt>
              <dd className="tabular-nums">
                {formatTime(booking.startAt, tz)} – {formatTime(booking.endAt, tz)} (
                {formatMinutes(duration)})
              </dd>
            </div>
            {settings.address ? (
              <div className="flex items-center gap-2">
                <dt>
                  <MapPin aria-hidden className="size-4 text-accent" />
                  <span className="sr-only">Where</span>
                </dt>
                <dd>{settings.address}</dd>
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              <dt>
                <ReceiptText aria-hidden className="size-4 text-accent" />
                <span className="sr-only">Reference and total</span>
              </dt>
              <dd className="tabular-nums">
                {booking.bookingRef} ·{' '}
                {formatMoney(booking.total.amountMinor, booking.total.currency)},{' '}
                {booking.payment.status === 'PAID' ? 'paid' : 'pay at the salon'}
              </dd>
            </div>
          </dl>
        </div>

        <div className="grid gap-3 border-t pt-5">
          <div className="flex flex-wrap gap-2">
            <Button variant="accent" size="sm" onClick={addToCalendar}>
              <CalendarPlus aria-hidden /> Add to calendar
            </Button>
            {settings.address ? (
              <Button asChild variant="outline" size="sm">
                <a href={directionsUrl(settings.address)} target="_blank" rel="noreferrer">
                  <Navigation aria-hidden /> Directions
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ChangeActions booking={booking} timeZone={tz} />
            <Link
              href={`/account/bookings/${booking.id}`}
              className="group inline-flex min-h-9 items-center gap-1 text-sm font-medium text-accent-ink hover:underline"
            >
              View details
              <ArrowRight
                aria-hidden
                className="size-4 transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}
