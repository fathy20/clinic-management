"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { NOTE_TEMPLATES, RED_FLAGS } from "@/lib/clinical";
import { t } from "@/lib/strings";
import { lastNoteFor, saveNote, type SoapDraft } from "./actions";
import type { ClinicalRow } from "./types";

const EMPTY: SoapDraft = { subjective: "", objective: "", assessment: "", plan: "" };

const SECTIONS: { key: keyof SoapDraft; label: string; hint: string }[] = [
  { key: "subjective", label: t("subjective"), hint: t("subjectiveHint") },
  { key: "objective", label: t("objective"), hint: t("objectiveHint") },
  { key: "assessment", label: t("assessment"), hint: t("assessmentHint") },
  { key: "plan", label: t("planLabel"), hint: t("planHint") },
];

export function NoteSheet({
  row,
  onClose,
}: {
  row: ClinicalRow;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<SoapDraft>(EMPTY);
  const [template, setTemplate] = useState("");
  const [flags, setFlags] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const empty = Object.values(draft).every((v) => !v.trim());

  function applyTemplate(key: string) {
    setTemplate(key);
    if (!key) return setDraft(EMPTY);
    const tpl = NOTE_TEMPLATES[key];
    if (tpl) {
      setDraft({
        subjective: tpl.subjective,
        objective: tpl.objective,
        assessment: tpl.assessment,
        plan: tpl.plan,
      });
    }
  }

  // The single biggest saving in the whole screen: most physiotherapy visits
  // are near-identical follow-ups, so the previous note is a better starting
  // point than any template.
  function copyLast() {
    setError(null);
    setCopyFailed(false);
    startTransition(async () => {
      const last = await lastNoteFor(row.patientId);
      if (!last) return setCopyFailed(true);
      setDraft(last);
      setTemplate("");
    });
  }

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await saveNote({
          patientId: row.patientId,
          appointmentId: row.appointmentId,
          template,
          note: draft,
        });
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  return (
    <Sheet
      title={row.patientName}
      subtitle={t("newNote")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("cancel")}</Button>
          <Button variant="primary" onClick={save} disabled={pending || empty}>
            {t("saveNote")}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button small onClick={copyLast} disabled={pending}>
          {t("copyLastVisit")}
        </Button>
        <Button small onClick={() => setFlags((f) => !f)}>
          {t("redFlagsHeading")}
        </Button>
      </div>
      {copyFailed && <p className="hint">{t("noPreviousVisit")}</p>}

      {/* Prompts, not a conclusion. Anything that outputs a diagnosis is a
          regulated medical device — and a clinician would not trust it. */}
      {flags && (
        <div className="previewbox">
          <p className="hint" style={{ margin: "0 0 8px" }}>
            {t("redFlagsHint")}
          </p>
          <ul style={{ margin: 0, paddingInlineStart: 18 }}>
            {RED_FLAGS.map((f) => (
              <li key={f} className="hint" style={{ lineHeight: 1.6 }}>
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}

      <SelectField
        label={t("template")}
        value={template}
        onChange={(e) => applyTemplate(e.target.value)}
      >
        <option value="">{t("noTemplate")}</option>
        {Object.entries(NOTE_TEMPLATES).map(([key, tpl]) => (
          <option key={key} value={key}>
            {tpl.label}
          </option>
        ))}
      </SelectField>

      {SECTIONS.map((s) => (
        <div key={s.key}>
          <label className="fieldlabel" htmlFor={`soap-${s.key}`}>
            {s.label}
          </label>
          <textarea
            id={`soap-${s.key}`}
            className="field textarea"
            rows={s.key === "assessment" ? 2 : 4}
            placeholder={s.hint}
            value={draft[s.key]}
            onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.value }))}
          />
        </div>
      ))}

      {error && <p className="formerror">{error}</p>}
    </Sheet>
  );
}
