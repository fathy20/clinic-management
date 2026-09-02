"use client";

import { useState, useTransition } from "react";
import { Arc } from "@/components/ui/Arc";
import { Button } from "@/components/ui/Button";
import { Field, SelectField } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import {
  MEASURE_KINDS,
  OUTCOME_MEASURES,
  recoveryFraction,
  type MeasureKind,
} from "@/lib/clinical";
import { t } from "@/lib/strings";
import { recordMeasure } from "./actions";
import type { ClinicalRow } from "./types";

export function MeasureSheet({
  row,
  onClose,
}: {
  row: ClinicalRow;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<MeasureKind>("NPRS");
  const [score, setScore] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const spec = OUTCOME_MEASURES[kind];
  const existing = row.progress.find((p) => p.kind === kind);
  const value = Number(score);
  const valid = score !== "" && Number.isFinite(value) && value >= 0 && value <= spec.max;

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        await recordMeasure({ patientId: row.patientId, kind, score: value, note });
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  return (
    <Sheet
      title={row.patientName}
      subtitle={t("measuresHeading")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("cancel")}</Button>
          <Button variant="primary" onClick={submit} disabled={pending || !valid}>
            {t("saveMeasure")}
          </Button>
        </>
      }
    >
      <SelectField
        label={t("instrument")}
        value={kind}
        onChange={(e) => {
          setKind(e.target.value as MeasureKind);
          setScore("");
        }}
      >
        {MEASURE_KINDS.map((k) => (
          <option key={k} value={k}>
            {OUTCOME_MEASURES[k].label}
          </option>
        ))}
      </SelectField>

      <Field
        amount
        label={t("score")}
        hint={`${t("outOf", { max: spec.max })} · ${
          spec.lowerIsBetter ? t("lowerIsBetter") : t("higherIsBetter")
        }`}
        inputMode="decimal"
        value={score}
        onChange={(e) => setScore(e.target.value)}
      />

      {/* What this patient has done so far on this instrument, so the
          clinician is not recording into a vacuum. */}
      {existing && (
        <div className="previewbox" style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Arc
            value={Math.round(
              recoveryFraction(kind, existing.firstScore, existing.latestScore) * 100
            )}
            size="lg"
            tone={existing.improvement >= 0 ? "jade" : "brick"}
            label={String(existing.latestScore)}
          />
          <div>
            <p className={existing.improvement >= 0 ? "preview-ok" : "preview-warn"}>
              {existing.improvement > 0
                ? t("improvedBy", { n: existing.improvement })
                : existing.improvement < 0
                  ? t("worsenedBy", { n: Math.abs(existing.improvement) })
                  : t("noChange")}
            </p>
            <p className="hint" style={{ margin: "4px 0 0" }}>
              {existing.firstScore} → {existing.latestScore} ·{" "}
              {t("readingsCount", { n: existing.readings })}
            </p>
          </div>
        </div>
      )}
      {!existing && <p className="hint">{t("firstReading")}</p>}

      <Field
        label={t("notesFor")}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      {error && <p className="formerror">{error}</p>}
    </Sheet>
  );
}
