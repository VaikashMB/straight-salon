import { describe, expect, it, vi } from 'vitest';
import { captureLogger } from '../../../../test/helpers/logger.js';

const sendMail = vi.fn();
const close = vi.fn();
const createTransport = vi.fn(() => ({ sendMail, close }));
vi.mock('nodemailer', () => ({ createTransport }));

const { createMockEmailProvider, createMockSmsProvider, createProviders, createSmtpEmailProvider } =
  await import('../providers/index.js');

const message = {
  to: 'ananya@example.com',
  subject: 'Booking confirmed',
  html: '<p>Hi</p>',
  text: 'Hi',
};

describe('notification providers (09 §8, FR-053)', () => {
  it('mock providers accept messages and log without recipient or content', async () => {
    const { logger, lines } = captureLogger();
    const email = createMockEmailProvider(logger);
    const sms = createMockSmsProvider(logger);

    const sent = await email.send(message);
    expect(sent.messageId).toMatch(/^mock-/);
    expect((await sms.send({ to: '+919876543212', text: 'Hi' })).messageId).toMatch(/^mock-/);
    await email.close();
    await sms.close();

    const output = JSON.stringify(lines());
    expect(output).toContain('Mock email accepted');
    expect(output).toContain('Mock SMS accepted');
    expect(output).not.toContain('ananya@example.com');
    expect(output).not.toContain('+919876543212');
    expect(output).not.toContain('Booking confirmed');
  });

  it('the SMTP provider sends through nodemailer with the configured sender', async () => {
    sendMail.mockResolvedValueOnce({ messageId: '<abc@mailpit>' });
    const provider = createSmtpEmailProvider({
      host: 'mailpit',
      port: 1025,
      from: 'Straight Salon <no-reply@straightsalon.local>',
    });
    expect(createTransport).toHaveBeenLastCalledWith({
      host: 'mailpit',
      port: 1025,
      secure: false,
    });

    await expect(provider.send(message)).resolves.toEqual({ messageId: '<abc@mailpit>' });
    expect(sendMail).toHaveBeenCalledWith({
      from: 'Straight Salon <no-reply@straightsalon.local>',
      ...message,
    });
    await provider.close();
    expect(close).toHaveBeenCalled();
  });

  it('uses TLS on port 465 and authenticates when a user is set', () => {
    createSmtpEmailProvider({
      host: 'smtp.example',
      port: 465,
      user: 'u',
      pass: 'p',
      from: 'x <x@y.z>',
    });
    expect(createTransport).toHaveBeenLastCalledWith({
      host: 'smtp.example',
      port: 465,
      secure: true,
      auth: { user: 'u', pass: 'p' },
    });
  });

  it('selects providers from config', () => {
    const { logger } = captureLogger();
    expect(createProviders({ email: 'mock', sms: 'mock' }, logger).email.name).toBe('mock');
    const smtp = createProviders(
      { email: 'smtp', sms: 'mock', smtp: { host: 'mailpit', port: 1025, from: 'x <x@y.z>' } },
      logger,
    );
    expect(smtp.email.name).toBe('smtp');
    expect(smtp.sms.name).toBe('mock');
    expect(() => createProviders({ email: 'smtp', sms: 'mock' }, logger)).toThrow(/SMTP/);
  });
});
