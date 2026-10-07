import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';

// A form-level error (the problem is not one field's), announced via role="alert".
export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
