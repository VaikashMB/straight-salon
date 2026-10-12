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
  // The salon's name for the email header wordmark. Omitted, the header is left out.
  brand?: string;
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
        `<tr><td style="padding:6px 16px 6px 0;color:#7D5F2C;font-size:13px;letter-spacing:0.04em;text-transform:uppercase;white-space:nowrap;vertical-align:top">${escapeHtml(label)}</td><td style="padding:6px 0;font-size:15px">${escapeHtml(value)}</td></tr>`,
    )
    .join('');
  // Branded, table-based layout (05 §2 palette) so it holds up in email clients: a dark header
  // with the wordmark and its brass full stop, a brass rule, a white card, details on a brass
  // tint, a brass button and a quiet footer. The first paragraph doubles as the inbox preview.
  const serif = "Georgia,'Times New Roman',serif";
  const html = [
    '<!doctype html><html><body style="margin:0;padding:0;background:#FAF7F2;font-family:Inter,Arial,sans-serif;color:#111111">',
    spec.paragraphs[0]
      ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(spec.paragraphs[0])}</div>`
      : '',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAF7F2"><tr><td align="center" style="padding:32px 12px">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #E2DBCF;border-radius:16px;overflow:hidden">',
    spec.brand
      ? `<tr><td style="background:#161412;padding:22px 32px;font-family:${serif};font-size:24px;color:#FAF7F2;letter-spacing:-0.01em">${escapeHtml(spec.brand)}<span style="color:#B08D57">.</span></td></tr>`
      : '',
    '<tr><td style="height:3px;line-height:3px;font-size:0;background:#B08D57">&nbsp;</td></tr>',
    '<tr><td style="padding:32px">',
    `<p style="margin:0 0 16px;font-family:${serif};font-size:22px">${escapeHtml(spec.greeting)}</p>`,
    ...spec.paragraphs.map(
      (p) => `<p style="margin:0 0 16px;line-height:1.6;font-size:15px">${escapeHtml(p)}</p>`,
    ),
    rows
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:8px 0 16px;border-collapse:collapse;background:#F3EADB;border-radius:12px"><tr><td style="padding:14px 18px"><table role="presentation" cellpadding="0" cellspacing="0">${rows}</table></td></tr></table>`
      : '',
    spec.action
      ? `<p style="margin:28px 0 8px"><a href="${escapeHtml(spec.action.url)}" style="display:inline-block;background:#B08D57;color:#111111;font-weight:600;padding:13px 24px;border-radius:999px;text-decoration:none">${escapeHtml(spec.action.label)}</a></p>`
      : '',
    '</td></tr>',
    `<tr><td style="padding:18px 32px;border-top:1px solid #E2DBCF;color:#7D5F2C;font-size:13px">${escapeHtml(spec.footer)}</td></tr>`,
    '</table>',
    '<p style="margin:16px 0 0;color:#8A8378;font-size:12px;letter-spacing:0.18em;text-transform:uppercase">Hair · Beard · Skin · Nails</p>',
    '</td></tr></table></body></html>',
  ].join('');

  return {
    email: { subject: spec.subject, html, text },
    sms: { text: clampSms(spec.sms) },
    secrets: spec.secrets ?? [],
  };
}
