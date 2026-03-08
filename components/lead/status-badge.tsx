import { Badge } from "@/components/ui/badge";
import { STATUS_COLORS, STATUS_LABELS } from "@/lib/constants";

export function StatusBadge({ status }: { status: keyof typeof STATUS_LABELS }) {
  const variant = STATUS_COLORS[status] ?? "neutral";
  return <Badge variant={variant as any}>{STATUS_LABELS[status]}</Badge>;
}
