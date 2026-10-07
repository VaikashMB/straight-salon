import type { ClientSession } from 'mongoose';
import { ConflictError } from '../../shared/errors/index.js';
import {
  SETTINGS_ID,
  SettingsModel,
  type SettingsDoc,
  type SettingsFields,
} from './settings.model.js';

export interface SettingsRepository {
  find(session?: ClientSession): Promise<SettingsDoc | null>;
  // Writes the whole document. `expectedVersion` null = it must not exist yet. A concurrent
  // change (version moved on) is a 409 STALE_VERSION (02 §1 optimistic concurrency).
  save(
    fields: SettingsFields,
    expectedVersion: number | null,
    session?: ClientSession,
  ): Promise<SettingsDoc>;
}

const OPTIONAL_FIELDS = ['address', 'phone', 'email'] as const;

const stale = () =>
  new ConflictError(
    'Settings were changed by someone else. Reload and try again.',
    'STALE_VERSION',
  );

export const settingsRepository: SettingsRepository = {
  find: (session) => SettingsModel.findById(SETTINGS_ID, null, { session }).lean<SettingsDoc>(),

  async save(fields, expectedVersion, session) {
    if (expectedVersion === null) {
      try {
        const [created] = await SettingsModel.create([{ ...fields, _id: SETTINGS_ID }], {
          session,
        });
        return created!.toObject();
      } catch (err) {
        if ((err as { code?: unknown }).code === 11000) throw stale();
        throw err;
      }
    }
    const set = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    const unset = Object.fromEntries(
      OPTIONAL_FIELDS.filter((key) => fields[key] === undefined).map((key) => [key, 1]),
    );
    const updated = await SettingsModel.findOneAndUpdate(
      { _id: SETTINGS_ID, __v: expectedVersion },
      { $set: set, $unset: unset, $inc: { __v: 1 } },
      { returnDocument: 'after', runValidators: true, session },
    ).lean<SettingsDoc>();
    if (!updated) throw stale();
    return updated;
  },
};
