import type { ClientSession } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bumpStaffDayGuards, StaffDayGuardModel } from '../staffDayGuard.js';

const session = {} as ClientSession;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('bumpStaffDayGuards error handling (02 §2.18)', () => {
  it('labels a duplicate key on guard creation as transient, so withTransaction retries it', async () => {
    const addErrorLabel = vi.fn();
    const duplicate = Object.assign(new Error('E11000 duplicate key'), {
      code: 11000,
      addErrorLabel,
    });
    vi.spyOn(StaffDayGuardModel, 'updateOne').mockRejectedValueOnce(duplicate);

    await expect(
      bumpStaffDayGuards(session, [{ staffId: '6712c0f9a1b2c3d4e5f60789', date: '2026-10-12' }]),
    ).rejects.toBe(duplicate);
    expect(addErrorLabel).toHaveBeenCalledWith('TransientTransactionError');
  });

  it('rethrows other errors unlabelled', async () => {
    const other = Object.assign(new Error('network'), { code: 6, addErrorLabel: vi.fn() });
    vi.spyOn(StaffDayGuardModel, 'updateOne').mockRejectedValueOnce(other);

    await expect(
      bumpStaffDayGuards(session, [{ staffId: '6712c0f9a1b2c3d4e5f60789', date: '2026-10-12' }]),
    ).rejects.toBe(other);
    expect(other.addErrorLabel).not.toHaveBeenCalled();
  });

  it('bumps in a stable order so concurrent transactions touch guards in the same sequence', async () => {
    const updateOne = vi.spyOn(StaffDayGuardModel, 'updateOne').mockResolvedValue({} as never);
    await bumpStaffDayGuards(session, [
      { staffId: 'bbbbbbbbbbbbbbbbbbbbbbbb', date: '2026-10-12' },
      { staffId: 'aaaaaaaaaaaaaaaaaaaaaaaa', date: '2026-10-13' },
      { staffId: 'aaaaaaaaaaaaaaaaaaaaaaaa', date: '2026-10-12' },
    ]);
    expect(updateOne.mock.calls.map(([filter]) => filter)).toEqual([
      { staffId: 'aaaaaaaaaaaaaaaaaaaaaaaa', date: '2026-10-12' },
      { staffId: 'aaaaaaaaaaaaaaaaaaaaaaaa', date: '2026-10-13' },
      { staffId: 'bbbbbbbbbbbbbbbbbbbbbbbb', date: '2026-10-12' },
    ]);
  });
});
