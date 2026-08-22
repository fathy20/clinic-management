"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Arc } from "@/components/ui/Arc";
import { Button } from "@/components/ui/Button";
import { Money } from "@/components/ui/Money";
import { markAttended, markNoShow } from "./actions";
import { PatientRow } from "./PatientRow";
import { PaymentSheet } from "./PaymentSheet";
import { RefundSheet } from "./RefundSheet";
import { WalkInSheet } from "./WalkInSheet";
import type { DayRow, Therapist } from "./types";
import { LOCALE, t } from "@/lib/strings";

type Sheet =
  | { kind: "payment"; row: DayRow }
  | { kind: "refund"; row: DayRow }
  | { kind: "walkin" }
  | null;

const DATE_FMT = new Intl.DateTimeFormat(LOCALE === "ar" ? "ar-EG" : "en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Africa/Cairo",
});

export function DayBoard({
  rows,
  therapists,
  clinicId,
  canSeeMoney,
  counts,
}: {
  rows: DayRow[];
  therapists: Therapist[];
  clinicId: string;
  canSeeMoney: boolean;
  counts: { waiting: number; attended: number; missed: number; total: number };
}) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [, startTransition] = useTransition();

  // Rows mid-animation. The server has already been told; this only keeps the
  // row visually in its old band until the settle finishes, so the receptionist
  // sees her own action land instead of a silent re-render.
  const [leaving, setLeaving] = useState<Record<string, "attended" | "no_show">>({});
  const [arriving, setArriving] = useState<Set<string>>(new Set());

  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return rows;
    const digits = /^[0-9]+$/.test(q);
    return rows.filter((r) =>
      digits ? r.patientPhone.includes(q) : r.patientName.includes(q)
    );
  }, [rows, query]);

  const waiting = filtered.filter(
    (r) => r.status === "booked" && !leaving[r.id]
  );
  const done = filtered.filter(
    (r) => r.status === "attended" || r.status === "no_show" || leaving[r.id]
  );

  // Keyboard: `/` focuses search, arrows move the queue cursor, Enter marks
  // the selected patient arrived, Esc clears the search.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const typing =
        document.activeElement instanceof HTMLElement &&
        ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName);

      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (sheet) return;
      if (typing) {
        if (e.key === "Escape") {
          setQuery("");
          searchRef.current?.blur();
        }
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => {
          const next = e.key === "ArrowDown" ? c + 1 : c - 1;
          return Math.max(0, Math.min(waiting.length - 1, next));
        });
      }
      if (e.key === "Enter" && waiting[cursor]) {
        e.preventDefault();
        attend(waiting[cursor]);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  function transition(row: DayRow, to: "attended" | "no_show") {
    setError(null);
    setLeaving((l) => ({ ...l, [row.id]: to }));

    window.setTimeout(() => {
      setLeaving((l) => {
        const next = { ...l };
        delete next[row.id];
        return next;
      });
      setArriving((a) => new Set(a).add(row.id));
      window.setTimeout(
        () =>
          setArriving((a) => {
            const next = new Set(a);
            next.delete(row.id);
            return next;
          }),
        750
      );
    }, 260);

    startTransition(async () => {
      try {
        if (to === "attended") await markAttended(row.id);
        else await markNoShow(row.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
        setLeaving((l) => {
          const next = { ...l };
          delete next[row.id];
          return next;
        });
      }
    });
  }

  const attend = (row: DayRow) => transition(row, "attended");
  const miss = (row: DayRow) => transition(row, "no_show");

  const owedTotal = useMemo(() => {
    const seen = new Set<string>();
    let sum = 0;
    for (const r of rows) {
      if (r.amountOwed > 0 && !seen.has(r.patientId)) {
        seen.add(r.patientId);
        sum += r.amountOwed;
      }
    }
    return sum;
  }, [rows]);

  const utilisation = useMemo(() => {
    // Share of today's booked slots each therapist actually delivered. With no
    // per-clinic working-hours table yet, "delivered / scheduled" is the honest
    // number; swap for scheduled-hours utilisation once shifts exist.
    return therapists.map((th) => {
      const mine = rows.filter((r) => r.therapistName === th.name);
      const finished = mine.filter((r) => r.status === "attended").length;
      return {
        name: th.name,
        pct: mine.length ? Math.round((finished / mine.length) * 100) : 0,
        total: mine.length,
      };
    });
  }, [rows, therapists]);

  return (
    <>
      <div className="dayhead">
        <h1>{t("receptionDay")}</h1>
        <span className="date">{DATE_FMT.format(new Date())}</span>
        <span className="live">
          <span className="pulse" /> {t("liveUpdating")}
        </span>
      </div>

      <section className="strip">
        <div className="cell">
          <div className="label">{t("waiting")}</div>
          <div className="value num">{counts.waiting}</div>
          <div className="foot">{t("ofAppointmentsToday", { n: counts.total })}</div>
        </div>
        <div className="cell">
          <div className="label">{t("finished")}</div>
          <div className="value num">{counts.attended}</div>
          <div className="foot">
            <span className="num">{counts.missed}</span> {t("noShows")}
          </div>
        </div>
        {canSeeMoney && (
          <div className="cell">
            <div className="label">{t("owedByPatients")}</div>
            <div className="value">
              <Money amount={owedTotal} size="lg" />
            </div>
            <div className="foot">
              {t("acrossNPatients", {
                n: new Set(
                  rows.filter((r) => r.amountOwed > 0).map((r) => r.patientId)
                ).size,
              })}
            </div>
          </div>
        )}
        {utilisation.length > 0 && (
          <div className="cell arcs">
            {utilisation.map((u) => (
              <Arc
                key={u.name}
                value={u.pct}
                size="lg"
                tone={u.pct < 60 ? "brick" : "jade"}
                label={`${u.pct}%`}
                caption={u.name}
              />
            ))}
          </div>
        )}
      </section>

      {error && (
        <p className="formerror" style={{ marginBottom: 16 }}>
          {error}
        </p>
      )}

      <section className="band">
        <div className="bandhead">
          <h2>{t("bandWaiting")}</h2>
          <span className="count">{waiting.length}</span>
          <input
            id="queue-search"
            ref={searchRef}
            className="field"
            style={{ maxWidth: 220, height: 34, marginInlineStart: "auto" }}
            placeholder={t("filterPlaceholder")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
          />
          <Button small onClick={() => setSheet({ kind: "walkin" })}>
            {t("addWalkIn")}
          </Button>
        </div>

        <div className="rows">
          {waiting.length === 0 && (
            <p className="empty">
              {query ? t("noSearchResults") : t("queueEmpty")}
            </p>
          )}
          {waiting.map((row, i) => (
            <PatientRow
              key={row.id}
              row={row}
              band="waiting"
              selected={i === cursor}
              canSeeMoney={canSeeMoney}
              onAttend={() => attend(row)}
              onMiss={() => miss(row)}
              onPay={() => setSheet({ kind: "payment", row })}
              onRefund={() => setSheet({ kind: "refund", row })}
            />
          ))}
        </div>
      </section>

      <section className="band">
        <div className="bandhead">
          <h2>{t("bandDone")}</h2>
          <span className="count">{done.length}</span>
        </div>
        <div className="rows">
          {done.length === 0 && <p className="empty">{t("nobodyFinishedYet")}</p>}
          {done.map((row) => (
            <PatientRow
              key={row.id}
              row={row}
              band="done"
              pendingStatus={leaving[row.id]}
              arriving={arriving.has(row.id)}
              canSeeMoney={canSeeMoney}
              onPay={() => setSheet({ kind: "payment", row })}
              onRefund={() => setSheet({ kind: "refund", row })}
            />
          ))}
        </div>
      </section>

      {sheet?.kind === "payment" && (
        <PaymentSheet
          clinicId={clinicId}
          row={sheet.row}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === "refund" && (
        <RefundSheet row={sheet.row} onClose={() => setSheet(null)} />
      )}
      {sheet?.kind === "walkin" && (
        <WalkInSheet
          clinicId={clinicId}
          therapists={therapists}
          onClose={() => setSheet(null)}
        />
      )}
    </>
  );
}
