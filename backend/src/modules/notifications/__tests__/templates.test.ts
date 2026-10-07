import { describe, expect, it } from 'vitest';
import { clampSms, escapeHtml, formatMoney, SMS_MAX_LENGTH } from '../templates/layout.js';
import {
  renderMessage,
  TEMPLATE_NAMES,
  type BookingInfo,
  type TemplateMessage,
} from '../templates/index.js';

const booking: BookingInfo = {
  ref: 'SS-261012-7KQ2',
  when: 'Mon 12 Oct 2026, 11:00',
  services: 'Haircut, Beard Trim',
  stylist: 'Ravi',
  total: '₹550.00',
  link: 'https://salon.example/account/bookings/1',
};
const salon = { name: 'Straight Salon', phone: '+919000000001' };
const base = { name: 'Ananya Rao', salon, booking };
const staffBase = { ...base, name: 'Ravi Kumar', customer: 'Ananya' };

// One sample per template (09 §8).
const SAMPLES: TemplateMessage[] = [
  { template: 'welcome', data: { name: 'Ananya Rao', salon, link: 'https://salon.example/book' } },
  {
    template: 'password_reset',
    data: {
      name: 'Ananya Rao',
      salon,
      resetUrl: 'https://salon.example/reset-password?token=abc',
      validMinutes: 30,
    },
  },
  { template: 'booking_confirmed', data: base },
  { template: 'booking_rescheduled', data: { ...base, previousWhen: 'Sun 11 Oct 2026, 10:00' } },
  { template: 'booking_cancelled', data: { ...base, reason: 'Stylist unwell' } },
  { template: 'booking_reminder_24h', data: base },
  { template: 'booking_reminder_2h', data: base },
  { template: 'booking_no_show', data: base },
  { template: 'booking_thank_you', data: base },
  { template: 'staff_booking_assigned', data: staffBase },
  {
    template: 'staff_booking_changed',
    data: { ...staffBase, previousWhen: 'Sun 11 Oct 2026, 10:00' },
  },
  { template: 'staff_booking_cancelled', data: { ...staffBase, reason: 'Customer called' } },
];

describe('notification templates (09 §8)', () => {
  it('covers every template named in the spec', () => {
    expect(TEMPLATE_NAMES.sort()).toEqual(
      [
        'welcome',
        'password_reset',
        'booking_confirmed',
        'booking_rescheduled',
        'booking_cancelled',
        'booking_reminder_24h',
        'booking_reminder_2h',
        'booking_no_show',
        'booking_thank_you',
        'staff_booking_assigned',
        'staff_booking_changed',
        'staff_booking_cancelled',
      ].sort(),
    );
    expect(SAMPLES.map((s) => s.template).sort()).toEqual([...TEMPLATE_NAMES].sort());
  });

  it.each(SAMPLES)('$template has an email (subject, html, text) and an SMS', (message) => {
    const rendered = renderMessage(message);
    expect(rendered.email.subject.length).toBeGreaterThan(0);
    expect(rendered.email.html).toMatch(/^<!doctype html>/);
    expect(rendered.email.text).toContain('Straight Salon');
    expect(rendered.sms.text.length).toBeGreaterThan(0);
    expect(rendered.sms.text.length).toBeLessThanOrEqual(SMS_MAX_LENGTH);
  });

  it('booking emails carry the booking details and a link to it', () => {
    const { email } = renderMessage({ template: 'booking_confirmed', data: base });
    expect(email.subject).toBe('Booking confirmed: Mon 12 Oct 2026, 11:00');
    expect(email.text).toContain('Hi Ananya,');
    expect(email.text).toContain('Booking: SS-261012-7KQ2');
    expect(email.text).toContain('Services: Haircut, Beard Trim');
    expect(email.text).toContain('Total: ₹550.00');
    expect(email.text).toContain(`View booking: ${booking.link}`);
    expect(email.html).toContain(`href="${booking.link}"`);
    expect(email.text).toContain('Straight Salon · +919000000001');
  });

  it('staff messages show the customer first name only, never prices', () => {
    const { email, sms } = renderMessage({ template: 'staff_booking_assigned', data: staffBase });
    expect(email.text).toContain('Customer: Ananya');
    expect(email.text).not.toContain('₹');
    expect(sms.text).toBe(
      'Straight Salon: new booking SS-261012-7KQ2, Mon 12 Oct 2026, 11:00, Ananya.',
    );
  });

  it('includes optional reasons and the previous time', () => {
    expect(
      renderMessage({ template: 'booking_cancelled', data: { ...base, reason: 'Closed' } }).email
        .text,
    ).toContain('Reason: Closed');
    expect(renderMessage({ template: 'booking_cancelled', data: base }).email.text).not.toContain(
      'Reason:',
    );
    expect(
      renderMessage({
        template: 'booking_rescheduled',
        data: { ...base, previousWhen: 'Sun 11 Oct 2026, 10:00' },
      }).email.text,
    ).toContain('moved from Sun 11 Oct 2026, 10:00 to Mon 12 Oct 2026, 11:00');
    // No salon phone: no "call us" sentence.
    const noPhone = renderMessage({
      template: 'booking_no_show',
      data: { ...base, salon: { name: 'Straight Salon' } },
    });
    expect(noPhone.email.text).not.toContain('Call');
    expect(noPhone.email.text).toContain('\nStraight Salon');
  });

  it('marks the password-reset link as a secret (09 §7)', () => {
    const rendered = renderMessage(SAMPLES[1]!);
    expect(rendered.secrets).toEqual(['https://salon.example/reset-password?token=abc']);
    expect(rendered.email.text).toContain('https://salon.example/reset-password?token=abc');
    expect(rendered.sms.text).not.toContain('token');
    expect(renderMessage(SAMPLES[2]!).secrets).toEqual([]);
  });

  it('escapes user-controlled text in HTML', () => {
    const { email } = renderMessage({
      template: 'booking_confirmed',
      data: { ...base, name: '<script>alert(1)</script> Rao' },
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('Hi &lt;script&gt;alert(1)&lt;/script&gt;,');
  });

  it('keeps SMS within one segment even with long names', () => {
    const long = 'X'.repeat(80);
    const { sms } = renderMessage({
      template: 'booking_cancelled',
      data: {
        ...base,
        salon: { name: long, phone: '+919000000001' },
        booking: { ...booking, stylist: long },
      },
    });
    expect(sms.text).toHaveLength(SMS_MAX_LENGTH);
    expect(sms.text.endsWith('…')).toBe(true);
  });
});

describe('template helpers', () => {
  it('formats minor units with the currency’s own decimals', () => {
    expect(formatMoney(55_000, 'INR')).toBe('₹550.00');
    expect(formatMoney(1_250, 'USD')).toBe('$12.50');
    expect(formatMoney(1_200, 'JPY')).toBe('¥1,200');
  });

  it('escapes HTML special characters', () => {
    expect(escapeHtml(`a&b<c>"d"'e'`)).toBe('a&amp;b&lt;c&gt;&quot;d&quot;&#39;e&#39;');
  });

  it('collapses whitespace and cuts SMS at 160 characters', () => {
    expect(clampSms('  a \n b  ')).toBe('a b');
    expect(clampSms('y'.repeat(160))).toHaveLength(160);
    expect(clampSms('y'.repeat(161))).toBe(`${'y'.repeat(159)}…`);
  });
});
