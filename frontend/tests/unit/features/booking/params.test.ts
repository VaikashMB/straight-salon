import { describe, expect, it } from 'vitest';
import { effectiveStep, parseWizard, wizardQuery } from '@/features/booking/params';
import { ids } from '../../helpers/fixtures';

const parse = (query: string) => parseWizard(new URLSearchParams(query));

describe('booking wizard URL state (05 §4.1)', () => {
  it('round-trips a shareable link', () => {
    const query = `services=${ids.haircut},${ids.beardTrim}&staff=${ids.ravi}&date=2026-10-12&start=2026-10-12T05:30:00.000Z&step=review`;
    const state = parse(query);
    expect(state).toEqual({
      serviceIds: [ids.haircut, ids.beardTrim],
      staff: ids.ravi,
      date: '2026-10-12',
      start: '2026-10-12T05:30:00.000Z',
      step: 'review',
      bookingId: null,
    });
    expect(wizardQuery(state)).toBe(`/book?${query.replace(/,/g, '%2C').replace(/:/g, '%3A')}`);
  });

  it('drops invalid, duplicate and excess values (BR-008: at most 5 services)', () => {
    const many = Array.from({ length: 7 }, (_, i) => `6712c0f9a1b2c3d4e5f6a00${i}`);
    const state = parse(
      `services=${many.join(',')},${many[0]},nope&staff=bad&date=12-10-2026&start=soon&step=hack`,
    );
    expect(state.serviceIds).toEqual(many.slice(0, 5));
    expect(state).toMatchObject({ staff: 'any', date: null, start: null, step: 'services' });
    expect(wizardQuery({ staff: 'any', step: 'services' })).toBe('/book');
  });

  it('falls back to the earliest step that is missing a choice', () => {
    expect(effectiveStep(parse('step=time'))).toBe('services');
    expect(effectiveStep(parse(`services=${ids.haircut}&step=review`))).toBe('time');
    expect(effectiveStep(parse(`services=${ids.haircut}&step=stylist`))).toBe('stylist');
    expect(effectiveStep(parse('step=done'))).toBe('services');
    expect(effectiveStep(parse(`step=done&booking=${ids.booking}`))).toBe('done');
  });
});
