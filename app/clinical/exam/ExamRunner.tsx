"use client";

import { useMemo, useState, useTransition } from "react";
import { BodyChart } from "@/components/ui/BodyChart";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { RegionAnatomy } from "@/components/ui/RegionAnatomy";
import {
  DISCIPLINES,
  RED_FLAG_PROMPTS,
  REGIONS,
  findingsToObjective,
  regionById,
  type BodyMark,
  type Finding,
} from "@/lib/exam-protocols";
import { NOTE_TEMPLATES } from "@/lib/clinical";
import { t } from "@/lib/strings";
import { saveNote } from "../actions";

type Stage = "region" | "screen" | "exam" | "review";

export function ExamRunner({
  patientId,
  patientName,
  appointmentId,
}: {
  patientId: string;
  patientName: string;
  appointmentId: string | null;
}) {
  const [stage, setStage] = useState<Stage>("region");
  const [regionId, setRegionId] = useState<string>("");
  const [flags, setFlags] = useState<string[]>([]);
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [activeStep, setActiveStep] = useState<string>("");
  const [findings, setFindings] = useState<Record<string, Finding>>({});
  const [marks, setMarks] = useState<BodyMark[]>([]);
  const [markKind, setMarkKind] = useState<BodyMark["kind"]>("pain");
  const [subjective, setSubjective] = useState("");
  const [objective, setObjective] = useState("");
  const [assessment, setAssessment] = useState("");
  const [plan, setPlan] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const region = regionById(regionId);
  const phase = region?.phases[phaseIndex];

  const recorded = useMemo(
    () => Object.values(findings).filter((f) => f.value || f.left || f.right),
    [findings]
  );

  function setFinding(stepId: string, patch: Partial<Finding>) {
    setFindings((f) => {
      const existing: Finding = f[stepId] ?? { stepId, value: "" };
      return { ...f, [stepId]: { ...existing, ...patch, stepId } };
    });
  }

  // The examination becomes the Objective half; the template supplies the
  // scaffolding for the halves it cannot know.
  function toReview() {
    if (!region) return;
    const tpl = NOTE_TEMPLATES[region.template];
    setObjective(findingsToObjective(regionId, Object.values(findings), marks, flags));
    if (tpl && !subjective) setSubjective(tpl.subjective);
    if (tpl && !plan) setPlan(tpl.plan);
    setStage("review");
  }

  function save() {
    setError(null);
    if (recorded.length === 0 && marks.length === 0) {
      setError(t("nothingRecorded"));
      return;
    }
    startTransition(async () => {
      try {
        await saveNote({
          patientId,
          appointmentId,
          template: region?.template ?? "",
          note: { subjective, objective, assessment, plan },
        });
        window.location.href = "/clinical";
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  // ---------- pick a region ----------
  //
  // Grouped by discipline rather than one flat list: a clinic practising
  // physiotherapy, osteopathy and nutrition would otherwise scroll past
  // pathways that are not theirs. A region appears under every discipline
  // that uses it, because a knee is a knee.
  if (stage === "region") {
    return (
      <>
        {DISCIPLINES.map((d) => {
          const mine = REGIONS.filter((r) => r.disciplines.includes(d.id));
          if (mine.length === 0) return null;
          return (
            <section className="band" key={d.id}>
              <div className="bandhead">
                <h2>{d.label}</h2>
                <span className="count">{mine.length}</span>
              </div>
              <div className="rows">
                {mine.map((r) => (
                  <button
                    key={`${d.id}-${r.id}`}
                    type="button"
                    className="row"
                    style={{ textAlign: "start", cursor: "pointer" }}
                    onClick={() => {
                      setRegionId(r.id);
                      setStage("screen");
                    }}
                  >
                    <div className="pname">{r.label}</div>
                    <div className="pmeta">
                      <span>
                        {r.phases.reduce((n, p) => n + p.steps.length, 0)}{" "}
                        {t("stepsWord")}
                      </span>
                      {r.measures.length > 0 && (
                        <>
                          <span className="dot" />
                          <span>{r.measures.join(" · ")}</span>
                        </>
                      )}
                    </div>
                    <div />
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </>
    );
  }

  // ---------- screening, before anything else ----------
  if (stage === "screen") {
    return (
      <section className="band">
        <div className="bandhead">
          <h2>{t("screenFirst")}</h2>
          <span className="count">{flags.length}</span>
        </div>
        <p className="note-inline" style={{ marginTop: 0 }}>
          {t("screenFirstHint")}
        </p>
        <div className="panel">
          <div className="flaglist" style={{ padding: "4px 14px" }}>
            {RED_FLAG_PROMPTS.map((f) => {
              const on = flags.includes(f.id);
              return (
                <label key={f.id} className={on ? "flagrow is-on" : "flagrow"}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) =>
                      setFlags((list) =>
                        e.target.checked
                          ? [...list, f.id]
                          : list.filter((x) => x !== f.id)
                      )
                    }
                  />
                  <span>{f.prompt}</span>
                </label>
              );
            })}
          </div>
        </div>
        <div style={{ display: "flex", gap: 9, marginTop: 14 }}>
          <Button onClick={() => setStage("region")}>{t("prevStep")}</Button>
          <Button variant="primary" onClick={() => setStage("exam")}>
            {flags.length > 0
              ? t("continueAnyway")
              : `${t("flagsClear")} — ${t("nextStep")}`}
          </Button>
        </div>
        {flags.length > 0 && (
          <p className="formerror" style={{ marginTop: 12 }}>
            {t("flagsPresent", { n: flags.length })}
          </p>
        )}
      </section>
    );
  }

  // ---------- the guided examination ----------
  if (stage === "exam" && region && phase) {
    const highlight =
      phase.steps.find((s) => s.id === activeStep)?.highlight ?? undefined;

    return (
      <div className="examgrid">
        <div>
          <div className="phasetabs">
            {region.phases.map((p, i) => {
              const done = p.steps.some((s) => findings[s.id]);
              return (
                <button
                  key={p.id}
                  type="button"
                  className={
                    i === phaseIndex
                      ? "phasetab is-on"
                      : done
                        ? "phasetab is-done"
                        : "phasetab"
                  }
                  onClick={() => setPhaseIndex(i)}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {phase.steps.map((step) => {
            const f = findings[step.id];
            const active = activeStep === step.id;
            return (
              <div
                key={step.id}
                className={active ? "examstep is-active" : "examstep"}
                onFocus={() => setActiveStep(step.id)}
                onMouseEnter={() => setActiveStep(step.id)}
              >
                <div className="examstep-action">{step.action}</div>
                <div className="examstep-examines">
                  {t("examines")}: {step.examines}
                </div>

                <div className="examstep-input">
                  {step.records === "yesno" && (
                    <div className="yesno">
                      <button
                        type="button"
                        className={f?.value === "present" ? "is-yes" : ""}
                        onClick={() => setFinding(step.id, { value: "present" })}
                      >
                        {t("present")}
                      </button>
                      <button
                        type="button"
                        className={f?.value === "absent" ? "is-no" : ""}
                        onClick={() => setFinding(step.id, { value: "absent" })}
                      >
                        {t("absent")}
                      </button>
                    </div>
                  )}

                  {step.records === "compare" && (
                    <>
                      <Field
                        amount
                        aria-label={`${step.action} ${t("leftSide")}`}
                        placeholder={t("leftSide")}
                        value={f?.left ?? ""}
                        onChange={(e) => setFinding(step.id, { left: e.target.value })}
                      />
                      <Field
                        amount
                        aria-label={`${step.action} ${t("rightSide")}`}
                        placeholder={t("rightSide")}
                        value={f?.right ?? ""}
                        onChange={(e) => setFinding(step.id, { right: e.target.value })}
                      />
                    </>
                  )}

                  {step.records === "degrees" && (
                    <Field
                      amount
                      aria-label={step.action}
                      inputMode="numeric"
                      placeholder={t("degrees")}
                      value={f?.value ?? ""}
                      onChange={(e) => setFinding(step.id, { value: e.target.value })}
                    />
                  )}

                  {step.records === "note" && (
                    <Field
                      aria-label={step.action}
                      value={f?.value ?? ""}
                      onChange={(e) => setFinding(step.id, { value: e.target.value })}
                    />
                  )}
                </div>
              </div>
            );
          })}

          <div style={{ display: "flex", gap: 9, marginTop: 14, flexWrap: "wrap" }}>
            <Button
              onClick={() =>
                phaseIndex === 0
                  ? setStage("screen")
                  : setPhaseIndex(phaseIndex - 1)
              }
            >
              {t("prevStep")}
            </Button>
            {phaseIndex < region.phases.length - 1 ? (
              <Button variant="primary" onClick={() => setPhaseIndex(phaseIndex + 1)}>
                {t("nextStep")}
              </Button>
            ) : (
              <Button variant="primary" onClick={toReview}>
                {t("finishExam")}
              </Button>
            )}
            <span className="hint" style={{ marginInlineStart: "auto" }}>
              {t("stepOf", {
                n: recorded.length,
                total: region.phases.reduce((n, p) => n + p.steps.length, 0),
              })}
            </span>
          </div>
        </div>

        <aside style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <RegionAnatomy
            regionId={region.id}
            highlight={highlight}
            structures={region.structures}
          />
          <div>
            <p className="fieldlabel">{t("bodyChart")}</p>
            <BodyChart
              marks={marks}
              active={markKind}
              onKindChange={setMarkKind}
              onAdd={(m) => setMarks((list) => [...list, m])}
              onRemove={(i) => setMarks((list) => list.filter((_, j) => j !== i))}
            />
            <p className="hint" style={{ marginTop: 6 }}>
              {t("bodyChartHint")}
            </p>
          </div>
        </aside>
      </div>
    );
  }

  // ---------- review and save ----------
  return (
    <section className="band">
      <div className="bandhead">
        <h2>{t("reviewBeforeSaving")}</h2>
        <span className="hint" style={{ marginInlineStart: "auto" }}>
          {patientName}
        </span>
      </div>

      <p className="note-inline" style={{ marginTop: 0 }}>
        {t("objectiveGenerated")}
      </p>

      {(
        [
          ["subjective", subjective, setSubjective],
          ["objective", objective, setObjective],
          ["assessment", assessment, setAssessment],
          ["planLabel", plan, setPlan],
        ] as const
      ).map(([key, value, set]) => (
        <div key={key} style={{ marginBottom: 12 }}>
          <label className="fieldlabel" htmlFor={`rev-${key}`}>
            {t(key)}
          </label>
          <textarea
            id={`rev-${key}`}
            className="field textarea"
            rows={key === "objective" ? 12 : 3}
            value={value}
            onChange={(e) => set(e.target.value)}
          />
        </div>
      ))}

      <div style={{ display: "flex", gap: 9 }}>
        <Button onClick={() => setStage("exam")}>{t("prevStep")}</Button>
        <Button variant="primary" onClick={save} disabled={pending}>
          {t("saveNote")}
        </Button>
      </div>

      {error && (
        <p className="formerror" style={{ marginTop: 12 }}>
          {error}
        </p>
      )}
    </section>
  );
}
