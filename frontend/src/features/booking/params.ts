// Booking wizard state in the URL (05 §4.1), so refresh, back and shared links all work:
// /book?services=a,b&staff=any&date=2026-10-12&start=…&step=review

export const STEPS = ['services', 'stylist', 'time', 'review', 'done'] as const;
export type Step = (typeof STEPS)[number];

export const MAX_SERVICES = 5; // BR-008
export const ANY = 'any';

export interface WizardState {
  serviceIds: string[];
  staff: string; // a stylist id or "any"
  date: string | null; // salon-local "YYYY-MM-DD"
  start: string | null; // chosen slot, UTC ISO
  step: Step;
  bookingId: string | null; // set once booked (step "done")
}

const OBJECT_ID = /^[a-f\d]{24}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function validStart(value: string | null): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

export function parseWizard(search: URLSearchParams): WizardState {
  const serviceIds = [
    ...new Set((search.get('services') ?? '').split(',').filter((id) => OBJECT_ID.test(id))),
  ].slice(0, MAX_SERVICES);
  const staff = search.get('staff') ?? ANY;
  const date = search.get('date');
  const booking = search.get('booking');
  const step = search.get('step');
  return {
    serviceIds,
    staff: OBJECT_ID.test(staff) ? staff : ANY,
    date: date && DATE.test(date) ? date : null,
    start: validStart(search.get('start')),
    step: STEPS.includes(step as Step) ? (step as Step) : 'services',
    bookingId: booking && OBJECT_ID.test(booking) ? booking : null,
  };
}

// The step to show: the requested one, unless an earlier choice is missing.
export function effectiveStep(state: WizardState): Step {
  if (state.step === 'done') return state.bookingId ? 'done' : 'services';
  if (state.serviceIds.length === 0) return 'services';
  if (state.step === 'review' && !state.start) return 'time';
  return state.step;
}

export function wizardQuery(state: Partial<WizardState>): string {
  const query = new URLSearchParams();
  if (state.serviceIds?.length) query.set('services', state.serviceIds.join(','));
  if (state.staff && state.staff !== ANY) query.set('staff', state.staff);
  if (state.date) query.set('date', state.date);
  if (state.start) query.set('start', state.start);
  if (state.step && state.step !== 'services') query.set('step', state.step);
  if (state.bookingId) query.set('booking', state.bookingId);
  const text = query.toString();
  return text ? `/book?${text}` : '/book';
}
