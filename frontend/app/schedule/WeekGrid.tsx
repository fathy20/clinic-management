"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { LOCALE, t } from "@/lib/strings";
import { Money } from "@/components/ui/Money";
import { BookSheet } from "./BookSheet";
import { SessionSheet } from "./SessionSheet";
import type { ScheduledSession, Therapist } from "./types";

const LOC = LOCALE === "ar" ? "ar-EG" : "en-GB";
const DAY_NAME = new Intl.DateTimeFormat(LOC, { weekday: "short", timeZone: "UTC" });
const DAY_NUM = new Intl.DateTimeFormat(LOC, { day: "numeric", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat(LOC, {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
const TIME = new Intl.DateTimeFormat(LOC, {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Africa/Cairo",
});

const STATUS_LABEL: Record<string, string> = {
  booked: t("bookedStatus"),
  attended: t("attended"),
  no_show: t("noShow"),
  cancelled: t("cancelled"),
};

export function WeekGrid({
  clinicId,
  currency,
  canSeeMoney,
  therapists,
  therapistFilter,
  days,
  weekStartISO,
  prevWeekISO,
  nextWeekISO,
  sessions,
}: {
  clinicId: string;
  currency: string;
  canSeeMoney: boolean;
  therapists: Therapist[];
  therapistFilter: string | null;
  days: string[];
  weekStartISO: string;
  prevWeekISO: string;
  nextWeekISO: string;
  sessions: ScheduledSession[];
}) {
  const [booking, setBooking] = useState<string | null>(null);
  const [open, setOpen] = useState<ScheduledSession | null>(null);

  const byDay = useMemo(() => {
    const map = new Map<string, ScheduledSession[]>();
    for (const d of days) map.set(d, []);
    for (const s of sessions) map.get(s.dayISO)?.push(s);
    return map;
  }, [days, sessions]);

  const todayISO = useMemo(() => {
    // The grid's day keys are clinic-local dates, so "today" has to be the
    // clinic's today rather than the browser's.
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Cairo",
    }).format(new Date());
    return parts;
  }, []);

  const active = sessions.filter((s) => s.status !== "cancelled").length;

  function href(week: string) {
    const q = new URLSearchParams({ week });
    if (therapistFilter) q.set("therapist", therapistFilter);
    return `/schedule?${q.toString()}`;
  }

  return (
    <>
      <div className="dayhead">
        <h1>{t("schedule")}</h1>
        <span className="date">
          {t("weekOf", { date: MONTH.format(new Date(weekStartISO + "T12:00:00Z")) })}
        </span>
      </div>

      <div className="weekbar">
        <Link className="btn btn-quiet btn-sm" href={href(prevWeekISO)}>
          ‹ {t("prevWeek")}
        </Link>
        <Link className="btn btn-quiet btn-sm" href="/schedule">
          {t("today")}
        </Link>
        <Link className="btn btn-quiet btn-sm" href={href(nextWeekISO)}>
          {t("nextWeek")} ›
        </Link>

        <div className="weekbar-right">
          <span className="hint">
            <span className="num">{active}</span> {t("sessions").toLowerCase()}
          </span>
          <select
            className="field"
            style={{ height: 34, width: "auto" }}
            aria-label={t("therapist")}
            value={therapistFilter ?? ""}
            onChange={(e) => {
              const q = new URLSearchParams({ week: weekStartISO });
              if (e.target.value) q.set("therapist", e.target.value);
              window.location.href = `/schedule?${q.toString()}`;
            }}
          >
            <option value="">{t("allTherapists")}</option>
            {therapists.map((th) => (
              <option key={th.id} value={th.id}>
                {th.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="week">
        {days.map((day) => {
          const list = byDay.get(day) ?? [];
          const date = new Date(day + "T12:00:00Z");
          return (
            <section
              key={day}
              className={day === todayISO ? "weekday is-today" : "weekday"}
            >
              <header className="weekday-head">
                <div>
                  <div className="weekday-name">{DAY_NAME.format(date)}</div>
                  <div className="weekday-num num">{DAY_NUM.format(date)}</div>
                </div>
                <button
                  className="weekday-add"
                  onClick={() => setBooking(day)}
                  aria-label={`${t("book")} ${day}`}
                  type="button"
                >
                  +
                </button>
              </header>

              <div className="weekday-body">
                {list.length === 0 && <p className="weekday-empty">—</p>}
                {list.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`slot status-${s.status}`}
                    onClick={() => setOpen(s)}
                  >
                    <span className="slot-time num">
                      {TIME.format(new Date(s.startsAt))}
                    </span>
                    <span className="slot-name">{s.patientName}</span>
                    <span className="slot-meta">
                      {therapistFilter ? STATUS_LABEL[s.status] : s.therapistName}
                      {canSeeMoney && s.price > 0 && (
                        <>
                          {" · "}
                          <Money amount={s.price} currency={currency} />
                        </>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {sessions.length === 0 && (
        <p className="empty" style={{ marginTop: 18 }}>
          {t("nothingThisWeek")}
        </p>
      )}

      {booking && (
        <BookSheet
          clinicId={clinicId}
          currency={currency}
          canSeeMoney={canSeeMoney}
          therapists={therapists}
          dateISO={booking}
          onClose={() => setBooking(null)}
        />
      )}

      {open && (
        <SessionSheet
          session={open}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
