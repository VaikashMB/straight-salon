// Rendering helpers shared by every template (09 §8): one message spec becomes an HTML email,
// its plain-text alternative and an SMS of at most 160 characters.

export const SMS_MAX_LENGTH = 160;

export interface MessageSpec {
  subject: string;
  greeting: string;
  paragraphs: string[];
  details?: [label: string, value: string][];
  action?: { label: string; url: string };
  footer: string;
  sms: string;
  // Values that must not be stored or shown after sending (e.g. the reset link), 09 §7.
  secrets?: string[];
}

export interface RenderedMessage {
  email: { subject: string; html: string; text: string };
  sms: { text: string };
  secrets: string[];
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

// Long names could push an SMS past one segment; cut it rather than send two.
export function clampSms(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length <= SMS_MAX_LENGTH ? oneLine : `${oneLine.slice(0, SMS_MAX_LENGTH - 1)}…`;
}

// Minor units -> "₹550.00" / "$12.50" / "¥1,200" using the currency's own decimals.
export function formatMoney(amountMinor: number, currency: string): string {
  const format = new Intl.NumberFormat('en', { style: 'currency', currency });
  const decimals = format.resolvedOptions().maximumFractionDigits ?? 2;
  return format.format(amountMinor / 10 ** decimals);
}

export function render(spec: MessageSpec): RenderedMessage {
  const details = spec.details ?? [];
  const text = [
    spec.greeting,
    '',
    ...spec.paragraphs.flatMap((p) => [p, '']),
    ...(details.length > 0 ? [...details.map(([label, value]) => `${label}: ${value}`), ''] : []),
    ...(spec.action ? [`${spec.action.label}: ${spec.action.url}`, ''] : []),
    spec.footer,
  ].join('\n');

  const rows = details
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#6b6b6b">${escapeHtml(label)}</td><td style="padding:4px 0">${escapeHtml(value)}</td></tr>`,
    )
    .join('');
  const html = [
    '<!doctype html><html><body style="margin:0;background:#FAF7F2;font-family:Inter,Arial,sans-serif;color:#111111">',
    '<div style="max-width:560px;margin:0 auto;padding:32px 24px">',
    `<p style="margin:0 0 16px">${escapeHtml(spec.greeting)}</p>`,
    ...spec.paragraphs.map(
      (p) => `<p style="margin:0 0 16px;line-height:1.5">${escapeHtml(p)}</p>`,
    ),
    rows ? `<table style="margin:0 0 16px;border-collapse:collapse">${rows}</table>` : '',
    spec.action
      ? `<p style="margin:24px 0"><a href="${escapeHtml(spec.action.url)}" style="background:#111111;color:#FAF7F2;padding:12px 20px;border-radius:6px;text-decoration:none">${escapeHtml(spec.action.label)}</a></p>`
      : '',
    `<p style="margin:24px 0 0;color:#B08D57">${escapeHtml(spec.footer)}</p>`,
    '</div></body></html>',
  ].join('');

  return {
    email: { subject: spec.subject, html, text },
    sms: { text: clampSms(spec.sms) },
    secrets: spec.secrets ?? [],
  };
}
