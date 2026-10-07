import { useId, type ComponentProps, type ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export interface TextareaFieldProps extends ComponentProps<'textarea'> {
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
}

export function TextareaField({ label, error, hint, id, className, ...input }: TextareaFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  const describedBy = [hint ? `${fieldId}-hint` : null, error ? `${fieldId}-error` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cn('grid gap-2', className)}>
      <Label htmlFor={fieldId}>{label}</Label>
      <Textarea
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...input}
      />
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
