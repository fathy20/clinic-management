"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { t } from "@/lib/strings";

const ROLE_LABEL: Record<string, string> = {
  owner: t("roleOwner"),
  reception: t("roleReception"),
  therapist: t("roleTherapist"),
  accountant: t("roleAccountant"),
};

// The clinic-facing chrome: brand, the surfaces this user can reach, theme,
// identity. TopBar in app/reception predates this and is kept for the
// reception day view's own search affordance; new surfaces use this.
export function NavBar({
  clinicName,
  userName,
  role,
  active,
  showMoney = false,
}: {
  clinicName: string;
  userName: string;
  role: string;
  active: "reception" | "schedule" | "finance" | "settings" | "clinical";
  showMoney?: boolean;
}) {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("clinicos-theme");
    } catch {
      // private window or blocked site data — fall back to the OS preference
    }
    setDark(
      saved ? saved === "dark" : matchMedia("(prefers-color-scheme: dark)").matches
    );
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
    try {
      localStorage.setItem("clinicos-theme", next ? "dark" : "light");
    } catch {
      // the toggle still works for this page load, it just is not remembered
    }
  }

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
            <path
              d="M4 24 A 14 14 0 0 1 28 24"
              fill="none"
              stroke="var(--jade)"
              strokeWidth="3.4"
              strokeLinecap="round"
            />
            <circle cx="16" cy="24" r="2.4" fill="var(--money)" />
          </svg>
          <div>
            <div className="brand-name">{clinicName}</div>
            <div className="brand-sub">
              {active === "clinical"
                ? t("clinicalSubtitle")
                : active === "finance"
                ? t("financeSubtitle")
                : active === "schedule"
                  ? t("scheduleSubtitle")
                  : t("receptionDay")}
            </div>
          </div>
        </div>

        <nav className="navtabs">
          <Link
            href="/reception"
            className={active === "reception" ? "navtab is-on" : "navtab"}
          >
            {t("receptionDay")}
          </Link>
          <Link
            href="/schedule"
            className={active === "schedule" ? "navtab is-on" : "navtab"}
          >
            {t("schedule")}
          </Link>
          {(role === "owner" || role === "therapist") && (
            <Link
              href="/clinical"
              className={active === "clinical" ? "navtab is-on" : "navtab"}
            >
              {t("clinic")}
            </Link>
          )}
          {showMoney && (
            <Link
              href="/finance"
              className={active === "finance" ? "navtab is-on" : "navtab"}
            >
              {t("finance")}
            </Link>
          )}
          {role === "owner" && (
            <Link
              href="/settings"
              className={active === "settings" ? "navtab is-on" : "navtab"}
            >
              {t("settings")}
            </Link>
          )}
        </nav>

        <button
          className="iconbtn"
          onClick={toggle}
          type="button"
          aria-label={dark ? t("lightMode") : t("darkMode")}
        >
          {dark ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
              <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M13.5 9.6A6 6 0 1 1 6.4 2.5a4.8 4.8 0 0 0 7.1 7.1Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          )}
        </button>

        <div className="who">
          <div className="avatar">{userName.trim().charAt(0) || "?"}</div>
          <div>
            <div className="who-name">{userName}</div>
            <div className="who-role">{ROLE_LABEL[role] ?? role}</div>
          </div>
        </div>
      </div>
    </header>
  );
}
