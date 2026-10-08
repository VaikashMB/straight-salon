// "Add to calendar" (05 §4.1): an iCalendar file built in the browser, so it needs no endpoint.

export interface CalendarEvent {
  uid: string;
  title: string;
  description: string;
  location?: string;
  startAt: string; // UTC ISO
  endAt: string;
}

const stamp = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// RFC 5545 text: escape backslashes, separators and newlines.
const text = (value: string) =>
  value
    .replaceAll('\\', String.raw`\\`)
    .replaceAll(';', String.raw`\;`)
    .replaceAll(',', String.raw`\,`)
    .replaceAll(/\r?\n/g, String.raw`\n`);

export function buildIcs(event: CalendarEvent, now: Date = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Straight Salon//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${stamp(now.toISOString())}`,
    `DTSTART:${stamp(event.startAt)}`,
    `DTEND:${stamp(event.endAt)}`,
    `SUMMARY:${text(event.title)}`,
    `DESCRIPTION:${text(event.description)}`,
    ...(event.location ? [`LOCATION:${text(event.location)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.join('\r\n')}\r\n`;
}

// Saves `content` as a file through a temporary link.
export function downloadFile(filename: string, content: Blob): void {
  const url = URL.createObjectURL(content);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
