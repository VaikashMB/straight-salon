import { randomUUID } from 'node:crypto';
import { createTransport } from 'nodemailer';
import type { Logger } from '../../../shared/logger/index.js';

// Delivery providers (09 §8, FR-053). The interfaces leave room for SES/SendGrid/Twilio/MSG91.
// Mock providers deliver nothing: the `notifications` row is the stored copy, and they log
// that a message "went out" (without recipient or content: PII and secrets stay out of logs).

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SmsMessage {
  to: string;
  text: string;
}

export interface SentMessage {
  messageId: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<SentMessage>;
  close(): Promise<void>;
}

export interface SmsProvider {
  readonly name: string;
  send(message: SmsMessage): Promise<SentMessage>;
  close(): Promise<void>;
}

export function createMockEmailProvider(logger: Logger): EmailProvider {
  const log = logger.child({ component: 'email-provider', provider: 'mock' });
  return {
    name: 'mock',
    send() {
      const messageId = `mock-${randomUUID()}`;
      log.info({ channel: 'EMAIL', messageId }, 'Mock email accepted (not delivered)');
      return Promise.resolve({ messageId });
    },
    close: () => Promise.resolve(),
  };
}

export function createMockSmsProvider(logger: Logger): SmsProvider {
  const log = logger.child({ component: 'sms-provider', provider: 'mock' });
  return {
    name: 'mock',
    send() {
      const messageId = `mock-${randomUUID()}`;
      log.info({ channel: 'SMS', messageId }, 'Mock SMS accepted (not delivered)');
      return Promise.resolve({ messageId });
    },
    close: () => Promise.resolve(),
  };
}

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string | undefined;
  pass?: string | undefined;
  from: string;
}

// nodemailer over SMTP; Mailpit locally (11 §1). Port 465 means implicit TLS.
export function createSmtpEmailProvider(config: SmtpConfig): EmailProvider {
  const transport = createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    ...(config.user ? { auth: { user: config.user, pass: config.pass ?? '' } } : {}),
  });
  return {
    name: 'smtp',
    async send(message) {
      const info = await transport.sendMail({ from: config.from, ...message });
      return { messageId: info.messageId };
    },
    close() {
      transport.close();
      return Promise.resolve();
    },
  };
}

export interface ProvidersConfig {
  email: 'mock' | 'smtp';
  sms: 'mock';
  smtp?: SmtpConfig;
}

export function createProviders(
  config: ProvidersConfig,
  logger: Logger,
): { email: EmailProvider; sms: SmsProvider } {
  if (config.email === 'smtp' && !config.smtp) throw new Error('SMTP settings are required');
  return {
    email:
      config.email === 'smtp'
        ? createSmtpEmailProvider(config.smtp!)
        : createMockEmailProvider(logger),
    sms: createMockSmsProvider(logger),
  };
}
