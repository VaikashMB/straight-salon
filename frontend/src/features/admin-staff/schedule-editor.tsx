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

type Day = Weekly[number];
type Break = Day['breaks'][number];
// Breaks carry a client-only key, so removing one keeps the other rows' inputs in place.
type EditableBreak = Break & { key: number };
type EditableDay = Omit<Day, 'breaks'> & { breaks: EditableBreak[] };
type DayChange = (day: EditableDay) => EditableDay;

let nextBreakKey = 0;
const withKey = (b: Break): EditableBreak => ({ ...b, key: nextBreakKey++ });
const toEditable = (weekly: Weekly): EditableDay[] =>
  weekly.map((d) => ({ ...d, breaks: d.breaks.map(withKey) }));
const toWeekly = (days: EditableDay[]): Weekly =>
  days.map((d) => ({ ...d, breaks: d.breaks.map(({ start, end }) => ({ start, end })) }));

// The first problem with one working day's breaks: each ends after it starts, sits inside
// working hours and does not overlap the next.
function breaksProblem(name: string | undefined, day: Day): string | null {
  const breaks = [...day.breaks].sort((a, b) => a.start.localeCompare(b.start));
  for (const [i, b] of breaks.entries()) {
    if (b.start >= b.end) return `${name}: each break must end after it starts.`;
    if (b.start < day.start || b.end > day.end)
      return `${name}: breaks must be within working hours.`;
    const next = breaks[i + 1];
    if (next && next.start < b.end) return `${name}: breaks must not overlap.`;
  }
  return null;
}

// Problems in a weekly schedule, or null: start before end, breaks inside working hours and not
// overlapping (02 §2.7). The API validates the same.
export function scheduleProblem(weekly: Weekly): string | null {
  for (const day of weekly) {
    if (!day.isWorking) continue;
    const name = WEEKDAYS[day.dayOfWeek];
    if (day.start >= day.end) return `${name}: the end must be after the start.`;
    const problem = breaksProblem(name, day);
    if (problem) return problem;
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
  const [weekly, setWeekly] = useState(() => toEditable(initial));
  const [error, setError] = useState<string | null>(null);

  const update = (dayOfWeek: number, change: DayChange) =>
    setWeekly((w) => w.map((d) => (d.dayOfWeek === dayOfWeek ? change(d) : d)));

  const submit = () => {
    setError(null);
    const body = toWeekly(weekly);
    const problem = scheduleProblem(body);
    if (problem) return setError(problem);
    save.mutate(body, {
      onSuccess: () => toast.success('Schedule saved.'),
      onError: (e) => setError(errorMessage(e)),
    });
  };

  return (
    <div className="grid gap-4">
      <FormError>{error}</FormError>
      <div className="grid gap-3">
        {ORDER.map((dow) => (
          <DayRow
            key={dow}
            day={weekly.find((d) => d.dayOfWeek === dow)!}
            name={WEEKDAYS[dow]!}
            onChange={(change) => update(dow, change)}
          />
        ))}
      </div>
      <Button onClick={submit} disabled={save.isPending} className="justify-self-start">
        {save.isPending ? 'Saving…' : 'Save schedule'}
      </Button>
    </div>
  );
}

function DayRow({
  day,
  name,
  onChange,
}: Readonly<{
  day: EditableDay;
  name: string;
  onChange: (change: DayChange) => void;
}>) {
  const setBreak = (key: number, patch: Partial<Break>) =>
    onChange((d) => ({
      ...d,
      breaks: d.breaks.map((x) => (x.key === key ? { ...x, ...patch } : x)),
    }));
  const removeBreak = (key: number) =>
    onChange((d) => ({ ...d, breaks: d.breaks.filter((x) => x.key !== key) }));
  const addBreak = () =>
    onChange((d) => ({ ...d, breaks: [...d.breaks, withKey({ start: '13:00', end: '13:30' })] }));

  return (
    <fieldset className="grid gap-2 rounded-lg border bg-card p-3 sm:grid-cols-[8rem_1fr]">
      <legend className="sr-only">{name}</legend>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={day.isWorking}
          onChange={(e) => onChange((d) => ({ ...d, isWorking: e.target.checked }))}
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
              onChange={(e) => onChange((d) => ({ ...d, start: e.target.value }))}
            />
            to
            <Input
              type="time"
              aria-label={`${name} end`}
              className="w-32"
              value={day.end}
              onChange={(e) => onChange((d) => ({ ...d, end: e.target.value }))}
            />
            <Button type="button" variant="ghost" size="sm" onClick={addBreak}>
              <Plus aria-hidden /> Break
            </Button>
          </div>
          {day.breaks.map((b, i) => (
            <BreakRow
              key={b.key}
              label={`${name} break ${i + 1}`}
              value={b}
              onChange={(patch) => setBreak(b.key, patch)}
              onRemove={() => removeBreak(b.key)}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Day off</p>
      )}
    </fieldset>
  );
}

function BreakRow({
  label,
  value,
  onChange,
  onRemove,
}: Readonly<{
  label: string; // e.g. "Monday break 1"
  value: Break;
  onChange: (patch: Partial<Break>) => void;
  onRemove: () => void;
}>) {
  return (
    <div className="flex flex-wrap items-center gap-2 pl-4 text-sm text-muted-foreground">
      Break
      <Input
        type="time"
        aria-label={`${label} start`}
        className="w-32"
        value={value.start}
        onChange={(e) => onChange({ start: e.target.value })}
      />
      to
      <Input
        type="time"
        aria-label={`${label} end`}
        className="w-32"
        value={value.end}
        onChange={(e) => onChange({ end: e.target.value })}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
      >
        <X aria-hidden />
      </Button>
    </div>
  );
}
