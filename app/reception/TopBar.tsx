"use client";

import { useEffect, useState } from "react";
import { t } from "@/lib/strings";

const ROLE_LABEL: Record<string, string> = {
  owner: t("roleOwner"),
  reception: t("roleReception"),
  therapist: t("roleTherapist"),
  accountant: t("roleAccountant"),
};

export function TopBar({
  clinicName,
  userName,
  role,
}: {
  clinicName: string;
  userName: string;
  role: string;
}) {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    const saved = (() => {
      try {
        return localStorage.getItem("clinicos-theme");
      } catch {
        return null;
      }
    })();
    if (saved) setDark(saved === "dark");
    else setDark(matchMedia("(prefers-color-scheme: dark)").matches);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
    try {
      localStorage.setItem("clinicos-theme", next ? "dark" : "light");
    } catch {
      // private window or blocked site data — the toggle still works for
      // this page load, it just won't be remembered.
    }
  }

  return (
    <header className="topbar">
      <div className="shell" style={{ display: "flex", alignItems: "center", gap: 16, padding: 0, width: "100%" }}>
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
            <div className="brand-sub">{t("receptionDay")}</div>
          </div>
        </div>

        <button
          className="searchcue"
          onClick={() => document.getElementById("queue-search")?.focus()}
          type="button"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="1.6" />
            <path d="M10.6 10.6L14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <span>{t("searchTheDay")}</span>
          <span className="kbd">/</span>
        </button>

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
          <div className="avatar">{userName.trim().charAt(0) || "؟"}</div>
          <div>
            <div className="who-name">{userName}</div>
            <div className="who-role">{ROLE_LABEL[role] ?? role}</div>
          </div>
        </div>
      </div>
    </header>
  );
}
