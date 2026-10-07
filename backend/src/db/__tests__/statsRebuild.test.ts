import { describe, expect, it, vi } from 'vitest';
import { parseRebuildArgs, RebuildArgsError, rebuildStats } from '../statsRebuild.js';

describe('stats:rebuild arguments (02 §2.17)', () => {
  it('no range means every booking date; a range needs both ends in order', () => {
    expect(parseRebuildArgs([])).toBeNull();
    expect(parseRebuildArgs(['--from=2026-10-01', '--to= 2026-10-31 '])).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(() => parseRebuildArgs(['--from=2026-10-01'])).toThrow(RebuildArgsError);
    expect(() => parseRebuildArgs(['--from=2026-10-01', '--to='])).toThrow(/both/);
    expect(() => parseRebuildArgs(['--from=yesterday', '--to=2026-10-31'])).toThrow(/not a date/);
    expect(() => parseRebuildArgs(['--from=2026-13-01', '--to=2026-10-31'])).toThrow(/not a date/);
    expect(() => parseRebuildArgs(['--from=2026-11-01', '--to=2026-10-31'])).toThrow(/after/);
  });

  it('delegates to the reports service', async () => {
    const reports = {
      rebuild: vi.fn(() => Promise.resolve(31)),
      rebuildAll: vi.fn(() => Promise.resolve(null)),
    };
    expect(await rebuildStats(reports, { from: '2026-10-01', to: '2026-10-31' })).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
      days: 31,
    });
    expect(reports.rebuild).toHaveBeenCalledWith('2026-10-01', '2026-10-31');
    expect(await rebuildStats(reports, null)).toBeNull();
    expect(reports.rebuildAll).toHaveBeenCalledOnce();
  });
});
