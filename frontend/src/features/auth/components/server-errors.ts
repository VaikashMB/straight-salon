import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { fieldErrors } from '@/lib/errors';

// Puts the API's field errors (400 VALIDATION_FAILED, `errors[].path`) on the matching inputs.
// Returns false when none matched, so the caller shows a form-level message instead.
export function applyFieldErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): boolean {
  let applied = false;
  for (const [path, message] of Object.entries(fieldErrors(error))) {
    const field = fields.find((f) => f === path);
    if (field) {
      setError(field, { type: 'server', message });
      applied = true;
    }
  }
  return applied;
}
