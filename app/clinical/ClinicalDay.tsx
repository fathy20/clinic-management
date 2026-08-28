"use client";

import Link from "next/link";
import { useState } from "react";
import { Arc } from "@/components/ui/Arc";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { OUTCOME_MEASURES, recoveryFraction, type MeasureKind } from "@/lib/clinical";
import { LOCALE, t } from "@/lib/strings";
import { MeasureSheet } from "./MeasureSheet";
import { NoteSheet } from "./NoteSheet";
import type { ClinicalRow } from "./types";

const TIME = new Intl.DateTimeFormat(LOCALE === "ar" ? "ar-EG" : "en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Africa/Cairo",
});

export function ClinicalDay({
  rows,
  isOwner,
}: {
  rows: ClinicalRow[];
  isOwner: boolean;
}) {
  const [writing, setWriting] = useState<ClinicalRow | null>(null);
  const [measuring, setMeasuring] = useState<ClinicalRow | null>(null);

  const done = rows.filter((r) => r.writtenUp).length;
  const outstanding = rows.length - done;

  return (
    <>
      <div className="dayhead">
        <h1>{t("myDay")}</h1>
        <span className="date">{t("clinicalSubtitle")}</span>
      </div>

      <section className="strip">
        <div className="cell">
          <div className="label">{t("myDay")}</div>
          <div className="value num">{rows.length}</div>
        </div>
        <div className="cell">
          <div className="label">{t("documented")}</div>
          <div className="value num">{done}</div>
          <div className="foot">
            <span className="num">{outstanding}</span> {t("documentVisit").toLowerCase()}
          </div>
        </div>
      </section>

      <section className="band">
        <div className="bandhead">
          <h2>{t("myDay")}</h2>
          <span className="count">{rows.length}</span>
        </div>
        <div className="rows">
          {rows.length === 0 && <p className="empty">{t("noPatientsToday")}</p>}

          {rows.map((row) => (
            <article
              className={row.writtenUp ? "row state-done" : "row"}
              key={row.appointmentId}
            >
              <div className="rtime">{TIME.format(new Date(row.startsAt))}</div>

              <div style={{ minWidth: 0 }}>
                <Link href={`/patients/${row.patientId}`} className="pname pname-link">
                  {row.patientName}
                </Link>
                <div className="pmeta">
                  {isOwner && (
                    <>
                      <span>{row.therapistName}</span>
                      <span className="dot" />
                    </>
                  )}
                  <span>
                    {row.noteCount > 0
                      ? t("visitCount", { n: row.noteCount })
                      : t("noNotesYet")}
                  </span>

                  {/* The arc as recovery, which is what it was chosen for:
                      range of motion is the physiotherapist's own geometry. */}
                  {row.progress.slice(0, 2).map((p) => {
                    const known = p.kind in OUTCOME_MEASURES;
                    const fraction = known
                      ? recoveryFraction(
                          p.kind as MeasureKind,
                          p.firstScore,
                          p.latestScore
                        )
                      : 0;
                    return (
                      <Chip key={p.kind} tone={p.improvement >= 0 ? "pkg" : "risk"}>
                        <Arc
                          value={Math.round(fraction * 100)}
                          size="sm"
                          tone={p.improvement >= 0 ? "jade" : "brick"}
                        />
                        <span className="num">
                          {p.kind} {p.latestScore}
                        </span>
                        {p.readings > 1 && (
                          <span>
                            {p.improvement > 0
                              ? t("improvedBy", { n: p.improvement })
                              : p.improvement < 0
                                ? t("worsenedBy", { n: Math.abs(p.improvement) })
                                : t("noChange")}
                          </span>
                        )}
                      </Chip>
                    );
                  })}
                </div>
              </div>

              <div className="acts">
                <Link
                  href={`/clinical/exam?patient=${row.patientId}&appointment=${row.appointmentId}`}
                  className="btn btn-quiet btn-sm"
                  style={{ textDecoration: "none" }}
                >
                  {t("examine")}
                </Link>
                <Button small onClick={() => setMeasuring(row)}>
                  {t("recordMeasure")}
                </Button>
                <Button
                  variant={row.writtenUp ? "quiet" : "primary"}
                  onClick={() => setWriting(row)}
                >
                  {row.writtenUp ? t("notesFor") : t("documentVisit")}
                </Button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {writing && (
        <NoteSheet row={writing} onClose={() => setWriting(null)} />
      )}
      {measuring && (
        <MeasureSheet row={measuring} onClose={() => setMeasuring(null)} />
      )}
    </>
  );
}
