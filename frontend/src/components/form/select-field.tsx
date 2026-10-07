import { useId, type ComponentProps, type ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import { cn } from '@/lib/utils';

// Labelled native select with its inline message, like TextField.
export interface SelectFieldProps extends ComponentProps<'select'> {
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
}

export function SelectField({
  label,
  error,
  hint,
  id,
  className,
  children,
  ...select
}: SelectFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  const describedBy = [hint ? `${fieldId}-hint` : null, error ? `${fieldId}-error` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cn('grid gap-2', className)}>
      <Label htmlFor={fieldId}>{label}</Label>
      <NativeSelect
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...select}
      >
        {children}
      </NativeSelect>
      {hint ? (
        <p id={`${fieldId}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${fieldId}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
