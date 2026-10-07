import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

// A native checkbox with its label to the right (preferences, flags, multi-selects).
export interface CheckboxFieldProps extends Omit<ComponentProps<'input'>, 'type'> {
  label: ReactNode;
  hint?: ReactNode;
}

export function CheckboxField({ label, hint, id, className, ...input }: CheckboxFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <div className={cn('flex items-start gap-2', className)}>
      <input
        id={fieldId}
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 accent-primary"
        aria-describedby={hint ? `${fieldId}-hint` : undefined}
        {...input}
      />
      <div className="grid gap-0.5">
        <label htmlFor={fieldId} className="text-sm leading-tight font-medium">
          {label}
        </label>
        {hint ? (
          <p id={`${fieldId}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}
