import Link from "next/link";
import { ArrowRight, CalendarDays, UserRound } from "lucide-react";
import { employeeName, formatDate, priorityLabels, statusLabels } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";

type Employee = { first_name: string; last_name: string };

type RequestRow = {
  id: string;
  request_no: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  created_at: string;
  updated_at?: string | null;
  needed_date?: string | null;
  machine_code?: string | null;
  machine_name?: string | null;
  assignee?: Employee | Employee[] | null;
  request_type: { name_th: string } | { name_th: string }[] | null;
};

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function requestTypeName(value: RequestRow["request_type"]) {
  return firstRelation(value)?.name_th ?? "คำร้อง";
}

function requestCode(requestNo: string) {
  return requestNo.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? "REQ";
}

const progressByStatus: Record<string, number> = {
  draft: 0,
  pending_approval: 1,
  more_info: 1,
  approved: 2,
  pending_assign: 2,
  assigned: 3,
  in_progress: 4,
  pending_verify: 5,
  completed: 6,
};

function RequestProgress({ status }: { status: string }) {
  const blocked = status === "rejected" || status === "cancelled" || status === "more_info";
  const progress = progressByStatus[status] ?? 0;
  return (
    <div className="request-progress" aria-label={`ความคืบหน้า: ${statusLabels[status] ?? status}`}>
      <span className="request-progress-track" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => {
          const step = index + 1;
          const className = blocked && step === Math.max(progress, 1)
            ? "blocked"
            : step <= progress ? "done" : "";
          return <i className={className} key={step} />;
        })}
      </span>
      <small>{statusLabels[status] ?? status}</small>
    </div>
  );
}

export function RequestTable({ requests }: { requests: RequestRow[] }) {
  if (!requests.length) return <div className="empty">ยังไม่มีคำร้องในรายการนี้</div>;

  return (
    <div className="request-timeline">
      {requests.map((request) => {
        const href = `/requests/${request.id}`;
        const assignee = firstRelation(request.assignee);
        const machine = [request.machine_code, request.machine_name].filter(Boolean).join(" · ");
        const description = request.description?.trim();
        return (
          <article className={`request-timeline-card status-${request.status}`} key={request.id}>
            <header className="request-card-head">
              <div className="request-card-identity">
                <Link className="request-card-no" href={href}>{request.request_no}</Link>
                <strong className="request-card-code">{requestCode(request.request_no)}</strong>
                <span className="request-card-type">{requestTypeName(request.request_type)}</span>
              </div>
              <div className="request-card-tags">
                {assignee ? <span className="request-owner-chip"><UserRound size={12} aria-hidden="true" />{employeeName(assignee)}</span> : null}
                <span className={`request-priority-chip priority-${request.priority}`}>{priorityLabels[request.priority] ?? request.priority}</span>
                <StatusBadge status={request.status} />
              </div>
            </header>

            <div className="request-card-body">
              <Link className="request-card-title" href={href}>{machine || request.title}</Link>
              {machine && request.title !== machine ? <p className="request-card-subtitle">{request.title}</p> : null}
              {description && description !== request.title ? <p className="request-card-description">{description}</p> : null}
              <div className="request-card-meta">
                {request.needed_date ? <span><CalendarDays size={12} aria-hidden="true" />ต้องการใช้งาน {formatDate(request.needed_date)}</span> : null}
                <span><CalendarDays size={12} aria-hidden="true" />แจ้งเมื่อ {formatDate(request.created_at, true)}</span>
                {request.updated_at && request.updated_at !== request.created_at
                  ? <span>อัปเดต {formatDate(request.updated_at, true)}</span>
                  : null}
              </div>
            </div>

            <footer className="request-card-footer">
              <RequestProgress status={request.status} />
              <Link className="request-detail-link" href={href}>ดูรายละเอียด <ArrowRight size={13} aria-hidden="true" /></Link>
            </footer>
          </article>
        );
      })}
    </div>
  );
}
