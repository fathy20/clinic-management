"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { LOCALE, t } from "@/lib/strings";
import { cancelAppointment, moveAppointment } from "./actions";
import type { ScheduledSession } from "./types";

const WHEN = new Intl.DateTimeFormat(LOCALE === "ar" ? "ar-EG" : "en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Africa/Cairo",
});

// The clinic-local date and time of an instant, as the values a date input
// and a time input expect. Doing this with getHours() would use the
// browser's zone and quietly offer to move the session by the difference.
function localFields(iso: string) {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Africa/Cairo",
  }).format(d);
  return { date, time };
}

export function SessionSheet({
  session,
  onClose,
}: {
  session: ScheduledSession;
  onClose: () => void;
}) {
  const initial = localFields(session.startsAt);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const moved = date !== initial.date || time !== initial.time;
  const closed = session.status === "cancelled";

  function act(work: () => Promise<unknown>) {
    setError(null);
    startTransition(async () => {
      try {
        await work();
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  return (
    <Sheet
      title={session.patientName}
      subtitle={`${WHEN.format(new Date(session.startsAt))} · ${session.therapistName}`}
      onClose={onClose}
      footer={
        confirmCancel ? (
          <>
            <Button onClick={() => setConfirmCancel(false)}>{t("cancel")}</Button>
            <Button
              variant="danger"
              disabled={pending}
              onClick={() => act(() => cancelAppointment(session.id))}
            >
              {t("cancelIt")}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>{t("cancel")}</Button>
            <Button
              variant="primary"
              disabled={pending || !moved}
              onClick={() =>
                act(() =>
                  moveAppointment({
                    appointmentId: session.id,
                    dateISO: date,
                    time,
                    // The session's own length, read off its stored range —
                    // a default here would quietly stretch a 30-minute slot
                    // and overlap whatever follows it.
                    durationMinutes: session.durationMinutes,
                  })
                )
              }
            >
              {t("moveIt")}
            </Button>
          </>
        )
      }
    >
      {closed ? (
        <p className="empty">{t("cancelled")}</p>
      ) : confirmCancel ? (
        <p className="formerror">{t("cancelWarning")}</p>
      ) : (
        <>
          <div className="tender">
            <Field
              label={t("date")}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <Field
              label={t("time")}
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>

          <div className="sheetlinks">
            <Link className="linkbtn" href={`/patients/${session.patientId}`}>
              {t("viewRecord")}
            </Link>
            <button
              type="button"
              className="linkbtn"
              style={{ color: "var(--brick)" }}
              onClick={() => setConfirmCancel(true)}
            >
              {t("cancelSession")}
            </button>
          </div>
        </>
      )}

      {error && <p className="formerror">{error}</p>}
    </Sheet>
  );
}
