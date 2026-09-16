import { statusLabels } from "@/lib/format";

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${status}`}>{statusLabels[status] ?? status}</span>;
}

