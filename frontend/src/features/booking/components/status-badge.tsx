import { Badge } from '@/components/ui/badge';
import { STATUS_LABEL, STATUS_VARIANT, type BookingStatus } from '../status';

// Colour plus text (05 §7: colour is never the only status indicator).
export function StatusBadge({ status }: { status: BookingStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
}
