import { render, type MessageSpec, type RenderedMessage } from './layout.js';

// Notification templates (09 §8), as code. Each has an email (subject, HTML, text) and an SMS.
// Inputs are already formatted for display (salon-local times, money with currency).

export interface SalonInfo {
  name: string;
  phone?: string | undefined;
}

export interface BookingInfo {
  ref: string;
  when: string; // e.g. "Mon 12 Oct 2026, 11:00"
  services: string; // "Haircut, Beard Trim"
  stylist: string;
  total: string; // "₹550.00"
  link: string; // where the recipient manages it
}

interface CustomerBooking {
  name: string;
  salon: SalonInfo;
  booking: BookingInfo;
}

interface StaffBooking extends CustomerBooking {
  customer: string; // first name only, as in the staff views (00 US-04)
}

export interface TemplateData {
  welcome: { name: string; salon: SalonInfo; link: string };
  password_reset: { name: string; salon: SalonInfo; resetUrl: string; validMinutes: number };
  booking_confirmed: CustomerBooking;
  booking_rescheduled: CustomerBooking & { previousWhen: string };
  booking_cancelled: CustomerBooking & { reason?: string | undefined };
  booking_reminder_24h: CustomerBooking;
  booking_reminder_2h: CustomerBooking;
  booking_no_show: CustomerBooking;
  booking_thank_you: CustomerBooking;
  staff_booking_assigned: StaffBooking;
  staff_booking_changed: StaffBooking & { previousWhen: string };
  staff_booking_cancelled: StaffBooking & { reason?: string | undefined };
}

export type TemplateName = keyof TemplateData;

// A template together with its data, e.g. { template: 'welcome', data: { ... } }.
export type TemplateMessage = {
  [K in TemplateName]: { template: K; data: TemplateData[K] };
}[TemplateName];

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
const signOff = (salon: SalonInfo) => (salon.phone ? `${salon.name} · ${salon.phone}` : salon.name);
const callUs = (salon: SalonInfo) => (salon.phone ? ` Call ${salon.phone} for help.` : '');

const bookingDetails = (b: BookingInfo): [string, string][] => [
  ['Booking', b.ref],
  ['When', b.when],
  ['Services', b.services],
  ['Stylist', b.stylist],
  ['Total', b.total],
];

const staffDetails = (b: BookingInfo, customer: string): [string, string][] => [
  ['Booking', b.ref],
  ['When', b.when],
  ['Customer', customer],
  ['Services', b.services],
];

function customerMessage(
  d: CustomerBooking,
  parts: { subject: string; intro: string[]; sms: string; action?: string },
): MessageSpec {
  return {
    subject: parts.subject,
    greeting: `Hi ${firstName(d.name)},`,
    paragraphs: parts.intro,
    details: bookingDetails(d.booking),
    action: { label: parts.action ?? 'View booking', url: d.booking.link },
    footer: signOff(d.salon),
    sms: `${d.salon.name}: ${parts.sms}`,
  };
}

function staffMessage(
  d: StaffBooking,
  parts: { subject: string; intro: string[]; sms: string },
): MessageSpec {
  return {
    subject: parts.subject,
    greeting: `Hi ${firstName(d.name)},`,
    paragraphs: parts.intro,
    details: staffDetails(d.booking, d.customer),
    action: { label: 'Open my schedule', url: d.booking.link },
    footer: signOff(d.salon),
    sms: `${d.salon.name}: ${parts.sms}`,
  };
}

const TEMPLATES: { [K in TemplateName]: (data: TemplateData[K]) => MessageSpec } = {
  welcome: (d) => ({
    subject: `Welcome to ${d.salon.name}`,
    greeting: `Hi ${firstName(d.name)},`,
    paragraphs: [
      'Your account is ready. You can now book appointments online, reschedule or cancel them, and see your history.',
    ],
    action: { label: 'Book an appointment', url: d.link },
    footer: signOff(d.salon),
    sms: `${d.salon.name}: welcome! Your account is ready. Book online any time.`,
  }),

  password_reset: (d) => ({
    subject: `Reset your ${d.salon.name} password`,
    greeting: `Hi ${firstName(d.name)},`,
    paragraphs: [
      `We received a request to reset your password. The link below works once and expires in ${d.validMinutes} minutes.`,
      'If you did not ask for this, you can ignore this email; your password stays the same.',
    ],
    action: { label: 'Choose a new password', url: d.resetUrl },
    footer: signOff(d.salon),
    sms: `${d.salon.name}: use the link we emailed you to reset your password. It expires in ${d.validMinutes} minutes.`,
    secrets: [d.resetUrl],
  }),

  booking_confirmed: (d) =>
    customerMessage(d, {
      subject: `Booking confirmed: ${d.booking.when}`,
      intro: [`Your appointment with ${d.booking.stylist} is confirmed.`],
      sms: `booking ${d.booking.ref} confirmed for ${d.booking.when} with ${d.booking.stylist}.`,
    }),

  booking_rescheduled: (d) =>
    customerMessage(d, {
      subject: `Booking moved to ${d.booking.when}`,
      intro: [`Your appointment has moved from ${d.previousWhen} to ${d.booking.when}.`],
      sms: `booking ${d.booking.ref} moved to ${d.booking.when} with ${d.booking.stylist}.`,
    }),

  booking_cancelled: (d) =>
    customerMessage(d, {
      subject: `Booking cancelled: ${d.booking.when}`,
      intro: [
        `Your appointment on ${d.booking.when} has been cancelled.${d.reason ? ` Reason: ${d.reason}` : ''}`,
        `We hope to see you again soon.${callUs(d.salon)}`,
      ],
      sms: `booking ${d.booking.ref} on ${d.booking.when} is cancelled.${callUs(d.salon)}`,
      action: 'Book again',
    }),

  booking_reminder_24h: (d) =>
    customerMessage(d, {
      subject: `Reminder: your appointment tomorrow, ${d.booking.when}`,
      intro: [
        `This is a reminder of your appointment with ${d.booking.stylist} tomorrow.`,
        'Need to change it? You can reschedule or cancel up to the cut-off from your account.',
      ],
      sms: `reminder: ${d.booking.when} with ${d.booking.stylist} (${d.booking.ref}).`,
    }),

  booking_reminder_2h: (d) =>
    customerMessage(d, {
      subject: `See you soon: ${d.booking.when}`,
      intro: [`Your appointment with ${d.booking.stylist} starts in about two hours.`],
      sms: `see you soon! ${d.booking.when} with ${d.booking.stylist} (${d.booking.ref}).`,
    }),

  booking_no_show: (d) =>
    customerMessage(d, {
      subject: 'We missed you today',
      intro: [
        `We missed you at your appointment on ${d.booking.when}, so it has been marked as a no-show.`,
        `You are welcome to book another time.${callUs(d.salon)}`,
      ],
      sms: `we missed you at ${d.booking.when} (${d.booking.ref}). Book again any time.`,
      action: 'Book again',
    }),

  booking_thank_you: (d) =>
    customerMessage(d, {
      subject: `Thank you for visiting ${d.salon.name}`,
      intro: [
        `Thank you for your visit with ${d.booking.stylist}. We hope you love the result.`,
        'Tell us how it went: you can leave a review from your booking.',
      ],
      sms: `thank you for visiting! Leave a review from your account.`,
      action: 'Leave a review',
    }),

  staff_booking_assigned: (d) =>
    staffMessage(d, {
      subject: `New booking: ${d.booking.when}`,
      intro: ['A booking has been added to your schedule.'],
      sms: `new booking ${d.booking.ref}, ${d.booking.when}, ${d.customer}.`,
    }),

  staff_booking_changed: (d) =>
    staffMessage(d, {
      subject: `Booking moved: ${d.booking.when}`,
      intro: [`A booking on your schedule moved from ${d.previousWhen} to ${d.booking.when}.`],
      sms: `booking ${d.booking.ref} moved to ${d.booking.when}, ${d.customer}.`,
    }),

  staff_booking_cancelled: (d) =>
    staffMessage(d, {
      subject: `Booking removed: ${d.booking.when}`,
      intro: [
        `A booking on ${d.booking.when} is no longer on your schedule.${d.reason ? ` Reason: ${d.reason}` : ''}`,
      ],
      sms: `booking ${d.booking.ref} on ${d.booking.when} is off your schedule.`,
    }),
};

export const TEMPLATE_NAMES = Object.keys(TEMPLATES) as TemplateName[];

export function renderMessage(message: TemplateMessage): RenderedMessage {
  // TypeScript cannot correlate `template` with `data` across the union; TemplateMessage
  // guarantees they match.
  const build = TEMPLATES[message.template] as (data: TemplateMessage['data']) => MessageSpec;
  return render(build(message.data));
}

export type { RenderedMessage } from './layout.js';
