import Link from "next/link";
import { formatDate, priorityLabels } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";

type RequestRow = {
  id: string;
  request_no: string;
  title: string;
  status: string;
  priority: string;
  created_at: string;
  request_type: { name_th: string } | { name_th: string }[] | null;
};

function requestTypeName(value: RequestRow["request_type"]) {
  if (Array.isArray(value)) return value[0]?.name_th ?? "";
  return value?.name_th ?? "";
}

export function RequestTable({ requests }: { requests: RequestRow[] }) {
  if (!requests.length) return <div className="empty">ยังไม่มีคำร้องในรายการนี้</div>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>เลขที่</th><th>ประเภท / เรื่อง</th><th>ความสำคัญ</th><th>วันที่</th><th>สถานะ</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => (
            <tr key={request.id}>
              <td><Link className="request-no" href={`/requests/${request.id}`}>{request.request_no}</Link></td>
              <td>
                <strong>{request.title}</strong>
                <div className="muted small">{requestTypeName(request.request_type)}</div>
              </td>
              <td className={`priority-${request.priority}`}>{priorityLabels[request.priority] ?? request.priority}</td>
              <td className="muted">{formatDate(request.created_at)}</td>
              <td><StatusBadge status={request.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
