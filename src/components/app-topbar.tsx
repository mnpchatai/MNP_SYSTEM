"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, ChevronRight, Plus, Search } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

const pageLabels: Array<[string, string]> = [
  ["/requests/new", "สร้างคำร้อง"],
  ["/requests/", "รายละเอียดคำร้อง"],
  ["/requests", "คำร้องของฉัน"],
  ["/approvals", "การอนุมัติ"],
  ["/notifications", "การแจ้งเตือน"],
  ["/profile", "ข้อมูลส่วนตัว"],
  ["/", "หน้าหลัก"],
];

function currentPageLabel(pathname: string) {
  return pageLabels.find(([path]) => path === "/" ? pathname === path : pathname.startsWith(path))?.[1] ?? "พื้นที่ทำงาน";
}

export function AppTopbar({ notificationCount }: { notificationCount: number }) {
  const pathname = usePathname();

  return (
    <header className="topbar">
      <div className="breadcrumbs" aria-label="ตำแหน่งปัจจุบัน">
        <span>งานภายใน</span>
        <ChevronRight size={13} aria-hidden="true" />
        <strong>{currentPageLabel(pathname)}</strong>
      </div>

      <form className="global-search" action="/requests" role="search">
        <Search size={15} aria-hidden="true" />
        <input name="q" aria-label="ค้นหาคำร้อง" placeholder="ค้นหาเลขที่คำร้องหรือหัวข้อ" maxLength={80} />
        <span className="search-hint">Enter</span>
      </form>

      <div className="topbar-actions">
        <ThemeToggle />
        <Link className="icon-button notification-button" href="/notifications" aria-label={notificationCount ? `การแจ้งเตือนใหม่ ${notificationCount} รายการ` : "การแจ้งเตือน"}>
          <Bell size={16} aria-hidden="true" />
          {notificationCount > 0 ? <span>{notificationCount > 9 ? "9+" : notificationCount}</span> : null}
        </Link>
        <Link className="btn topbar-create" href="/requests/new"><Plus size={15} aria-hidden="true" /> สร้างคำร้อง</Link>
      </div>
    </header>
  );
}
