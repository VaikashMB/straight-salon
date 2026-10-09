import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { STATUS_ICON, STATUS_LABEL, STATUS_VARIANT, type BookingStatus } from '../status';

// Colour, icon and text (05 §7: colour is never the only status indicator).
export function StatusBadge({ status, className }: { status: BookingStatus; className?: string }) {
  const Icon = STATUS_ICON[status];
  return (
    <Badge
      variant={STATUS_VARIANT[status]}
      data-status={status}
      className={cn('rounded-full px-2.5', className)}
    >
      <Icon aria-hidden />
      {STATUS_LABEL[status]}
    </Badge>
  );
}
