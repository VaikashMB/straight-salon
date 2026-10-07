'use client';

import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/form/form-error';
import { ErrorState, LoadingList } from '@/components/states/list-states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { WEEKDAYS } from '@/features/catalog/hours';
import { useSchedule } from '@/features/staff/api';
import { errorMessage } from '@/lib/errors';
import { useSaveSchedule, type Weekly } from './api';

const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first

// Problems in a weekly schedule, or null: start before end, breaks inside working hours and not
// overlapping (02 §2.7). The API validates the same.
export function scheduleProblem(weekly: Weekly): string | null {
  for (const day of weekly) {
    if (!day.isWorking) continue;
    const name = WEEKDAYS[day.dayOfWeek];
    if (day.start >= day.end) return `${name}: the end must be after the start.`;
    const breaks = [...day.breaks].sort((a, b) => a.start.localeCompare(b.start));
    for (const [i, b] of breaks.entries()) {
      if (b.start >= b.end) return `${name}: each break must end after it starts.`;
      if (b.start < day.start || b.end > day.end)
        return `${name}: breaks must be within working hours.`;
      const next = breaks[i + 1];
      if (next && next.start < b.end) return `${name}: breaks must not overlap.`;
    }
  }
  return null;
}

// The 7-row weekly grid with start/end and breaks (05 §4.4, API-033/034).
export function ScheduleEditor({ staffId }: { staffId: string }) {
  const schedule = useSchedule(staffId);
  if (schedule.isPending) return <LoadingList rows={3} label="Loading schedule" />;
  if (schedule.error)
    return <ErrorState error={schedule.error} onRetry={() => void schedule.refetch()} />;
  return <Editor staffId={staffId} initial={schedule.data.weekly} />;
}

function Editor({ staffId, initial }: { staffId: string; initial: Weekly }) {
  const save = useSaveSchedule(staffId);
  const [weekly, setWeekly] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  const update = (dayOfWeek: number, change: (day: Weekly[number]) => Weekly[number]) =>
    setWeekly((w) => w.map((d) => (d.dayOfWeek === dayOfWeek ? change(d) : d)));

  const submit = () => {
    setError(null);
    const problem = scheduleProblem(weekly);
    if (problem) return setError(problem);
    save.mutate(weekly, {
      onSuccess: () => toast.success('Schedule saved.'),
      onError: (e) => setError(errorMessage(e)),
    });
  };

  return (
    <div className="grid gap-4">
      <FormError>{error}</FormError>
      <div className="grid gap-3">
        {ORDER.map((dow) => {
          const day = weekly.find((d) => d.dayOfWeek === dow)!;
          const name = WEEKDAYS[dow]!;
          return (
            <fieldset
              key={dow}
              className="grid gap-2 rounded-lg border bg-card p-3 sm:grid-cols-[8rem_1fr]"
            >
              <legend className="sr-only">{name}</legend>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={day.isWorking}
                  onChange={(e) => update(dow, (d) => ({ ...d, isWorking: e.target.checked }))}
                />
                {name}
              </label>
              {day.isWorking ? (
                <div className="grid gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Input
                      type="time"
                      aria-label={`${name} start`}
                      className="w-32"
                      value={day.start}
                      onChange={(e) => update(dow, (d) => ({ ...d, start: e.target.value }))}
                    />
                    to
                    <Input
                      type="time"
                      aria-label={`${name} end`}
                      className="w-32"
                      value={day.end}
                      onChange={(e) => update(dow, (d) => ({ ...d, end: e.target.value }))}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        update(dow, (d) => ({
                          ...d,
                          breaks: [...d.breaks, { start: '13:00', end: '13:30' }],
                        }))
                      }
                    >
                      <Plus aria-hidden /> Break
                    </Button>
                  </div>
                  {day.breaks.map((b, i) => (
                    <div
                      key={i}
                      className="flex flex-wrap items-center gap-2 pl-4 text-sm text-muted-foreground"
                    >
                      Break
                      <Input
                        type="time"
                        aria-label={`${name} break ${i + 1} start`}
                        className="w-32"
                        value={b.start}
                        onChange={(e) =>
                          update(dow, (d) => ({
                            ...d,
                            breaks: d.breaks.map((x, j) =>
                              j === i ? { ...x, start: e.target.value } : x,
                            ),
                          }))
                        }
                      />
                      to
                      <Input
                        type="time"
                        aria-label={`${name} break ${i + 1} end`}
                        className="w-32"
                        value={b.end}
                        onChange={(e) =>
                          update(dow, (d) => ({
                            ...d,
                            breaks: d.breaks.map((x, j) =>
                              j === i ? { ...x, end: e.target.value } : x,
                            ),
                          }))
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${name} break ${i + 1}`}
                        onClick={() =>
                          update(dow, (d) => ({ ...d, breaks: d.breaks.filter((_, j) => j !== i) }))
                        }
                      >
                        <X aria-hidden />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Day off</p>
              )}
            </fieldset>
          );
        })}
      </div>
      <Button onClick={submit} disabled={save.isPending} className="justify-self-start">
        {save.isPending ? 'Saving…' : 'Save schedule'}
      </Button>
    </div>
  );
}
