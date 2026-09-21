"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Bell,
  CheckSquare,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Menu,
  PlusCircle,
  UserCircle,
  X,
} from "lucide-react";
import { signOutAction } from "@/app/actions/auth";

const workspaceItems = [
  { href: "/", label: "หน้าหลัก", icon: LayoutDashboard },
  { href: "/requests", label: "คำร้องของฉัน", icon: ClipboardList },
  { href: "/requests/new", label: "สร้างคำร้อง", icon: PlusCircle, featured: true },
  { href: "/approvals", label: "รอฉันอนุมัติ", icon: CheckSquare },
  { href: "/notifications", label: "การแจ้งเตือน", icon: Bell },
];

function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/requests") {
    return pathname === "/requests" || (pathname.startsWith("/requests/") && !pathname.startsWith("/requests/new"));
  }
  return pathname.startsWith(href);
}

export function Sidebar({
  employee,
}: {
  employee: { first_name: string; last_name: string; job_title: string | null };
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const initials = `${employee.first_name.at(0) ?? ""}${employee.last_name.at(0) ?? ""}`;

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  return (
    <>
      <button
        className={`mobile-nav-toggle${mobileOpen ? " open" : ""}`}
        type="button"
        aria-label={mobileOpen ? "ปิดเมนูหลัก" : "เปิดเมนูหลัก"}
        aria-controls="mobile-nav"
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen((open) => !open)}
      >
        <Menu className="menu-icon" size={20} aria-hidden="true" />
        <X className="close-icon" size={20} aria-hidden="true" />
      </button>
      <aside className={`sidebar${mobileOpen ? " mobile-open" : ""}`} id="mobile-nav">
        <Link href="/" className="brand">
          <div className="brand-mark">M</div>
          <div>
            <strong>MNP Workspace</strong>
            <span>INTERNAL OPERATIONS</span>
          </div>
        </Link>

        <nav className="nav" aria-label="เมนูหลัก">
          <div className="nav-section-label">Workspace</div>
          {workspaceItems.map(({ href, label, icon: Icon, featured }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActivePath(pathname, href) ? "page" : undefined}
              aria-label={label}
              className={`nav-link${isActivePath(pathname, href) ? " active" : ""}${featured ? " nav-create" : ""}`}
              onClick={() => setMobileOpen(false)}
            >
              <span className="nav-icon-wrap"><Icon size={17} aria-hidden="true" /></span>
              <span className="nav-label-full">{label}</span>
            </Link>
          ))}

          <div className="nav-divider" />
          <div className="nav-section-label">Account</div>
          <Link
            href="/profile"
            aria-current={pathname.startsWith("/profile") ? "page" : undefined}
            aria-label="ข้อมูลส่วนตัว"
            className={`nav-link${pathname.startsWith("/profile") ? " active" : ""}`}
            onClick={() => setMobileOpen(false)}
          >
            <span className="nav-icon-wrap"><UserCircle size={17} aria-hidden="true" /></span>
            <span className="nav-label-full">ข้อมูลส่วนตัว</span>
          </Link>
        </nav>

        <div className="nav-spacer" />
        <div className="sidebar-user">
          <div className="sidebar-avatar">{initials}</div>
          <div className="sidebar-user-copy">
            <strong>{employee.first_name} {employee.last_name}</strong>
            <span>{employee.job_title ?? "พนักงาน"}</span>
          </div>
          <form action={signOutAction}>
            <button className="signout" type="submit" aria-label="ออกจากระบบ" title="ออกจากระบบ">
              <LogOut size={15} aria-hidden="true" />
            </button>
          </form>
        </div>
      </aside>
      <button
        className={`nav-backdrop${mobileOpen ? " open" : ""}`}
        type="button"
        tabIndex={-1}
        aria-label="ปิดเมนูหลัก"
        onClick={() => setMobileOpen(false)}
      />
    </>
  );
}
