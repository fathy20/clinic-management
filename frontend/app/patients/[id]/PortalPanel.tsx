"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { t } from "@/lib/strings";
import {
  issuePortalLink,
  prescribeExercise,
  retireExercise,
  revokePortalLink,
  type IssuedLink,
} from "../portal-actions";

export type PortalToken = {
  id: string;
  createdAt: string;
  lastSeenAt: string | null;
  revoked: boolean;
};

export type Exercise = {
  id: string;
  name: string;
  frequency: string;
  sets: number | null;
  reps: number | null;
};

export function PortalPanel({
  patientId,
  patientName,
  patientPhone,
  tokens,
  exercises,
  canPrescribe,
  notice,
}: {
  patientId: string;
  patientName: string;
  patientPhone: string;
  tokens: PortalToken[];
  exercises: Exercise[];
  canPrescribe: boolean;
  /**
   * Set when the portal tables are not deployed yet. Without it the panel is
   * indistinguishable from a patient who simply has no link and no exercises,
   * and the Create link button fails on a click with a Postgres error.
   */
  notice: string | null;
}) {
  const [issued, setIssued] = useState<IssuedLink | null>(null);
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const live = tokens.filter((tk) => !tk.revoked);

  function run(work: () => Promise<unknown>, then?: (v: unknown) => void) {
    setError(null);
    startTransition(async () => {
      try {
        const v = await work();
        then?.(v);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  // wa.me takes a bare international number. Egyptian mobiles are commonly
  // written 01xxxxxxxxx locally, which wa.me will not accept.
  function whatsAppHref(url: string) {
    const digits = patientPhone.replace(/\D/g, "");
    const intl = digits.startsWith("0") ? `20${digits.slice(1)}` : digits;
    const message = `${t("whatsAppMessage", {
      name: patientName,
      clinic: issued?.clinicName ?? "",
    })} ${url}`;
    return `https://wa.me/${intl}?text=${encodeURIComponent(message)}`;
  }

  return (
    <>
      <div className="panel">
        <div
          className="panelhead"
          style={{ display: "flex", alignItems: "center", gap: 10 }}
        >
          <div style={{ marginInlineEnd: "auto" }}>
            <h3>{t("patientLink")}</h3>
            <p>{t("patientLinkSub")}</p>
          </div>
          <Button
            small
            disabled={pending || Boolean(notice)}
            onClick={() =>
              run(
                () => issuePortalLink({ patientId }),
                (v) => {
                  setIssued(v as IssuedLink);
                  setCopied(false);
                }
              )
            }
          >
            {t("createLink")}
          </Button>
        </div>

        {notice && (
          <p className="leak formerror" style={{ margin: 0 }}>
            {notice}
          </p>
        )}

        {!notice && live.length === 0 && !issued && (
          <p className="leak" style={{ color: "var(--muted)" }}>
            {t("activeLinks", { n: 0 })}
          </p>
        )}

        {live.map((tk) => (
          <div className="leak" key={tk.id}>
            <div className="leak-body">
              <div className="leak-name">{t("patientLink")}</div>
              <div className="leak-when">
                {tk.lastSeenAt
                  ? t("lastOpened", {
                      date: new Date(tk.lastSeenAt).toLocaleDateString(),
                    })
                  : t("neverOpened")}
              </div>
            </div>
            <Button
              small
              disabled={pending}
              onClick={() => run(() => revokePortalLink(tk.id))}
            >
              {t("revokeLink")}
            </Button>
          </div>
        ))}

        {error && (
          <p className="formerror" style={{ margin: "10px 16px" }}>
            {error}
          </p>
        )}
      </div>

      {canPrescribe && !notice && (
        <div className="panel">
          <div
            className="panelhead"
            style={{ display: "flex", alignItems: "center", gap: 10 }}
          >
            <h3 style={{ marginInlineEnd: "auto" }}>{t("exercisesHeading")}</h3>
            <Button small onClick={() => setAdding(true)}>
              {t("addExercise")}
            </Button>
          </div>

          {exercises.length === 0 ? (
            <p className="leak" style={{ color: "var(--muted)" }}>
              {t("noExercisesYet")}
            </p>
          ) : (
            exercises.map((e) => (
              <div className="leak" key={e.id}>
                <div className="leak-body">
                  <div className="leak-name">{e.name}</div>
                  <div className="leak-when">
                    {e.sets && e.reps
                      ? `${t("setsReps", { sets: e.sets, reps: e.reps })} · `
                      : ""}
                    {e.frequency}
                  </div>
                </div>
                <Button
                  small
                  disabled={pending}
                  onClick={() => run(() => retireExercise(e.id))}
                >
                  {t("retireExercise")}
                </Button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Shown once. Only the hash is stored, so there is no second chance. */}
      {issued && (
        <Sheet
          title={t("linkCreated")}
          subtitle={patientName}
          onClose={() => setIssued(null)}
          footer={
            <Button variant="primary" onClick={() => setIssued(null)}>
              {t("doneAdding")}
            </Button>
          }
        >
          <p className="hint">{t("linkOnce")}</p>
          <div className="picked" style={{ wordBreak: "break-all" }}>
            <span className="num" dir="ltr" style={{ fontSize: "var(--step--1)" }}>
              {issued.url}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button
              onClick={() =>
                navigator.clipboard?.writeText(issued.url).then(
                  () => setCopied(true),
                  () => setCopied(false)
                )
              }
            >
              {copied ? t("copied") : t("copyLink")}
            </Button>
            <a
              className="btn btn-primary"
              style={{ textDecoration: "none" }}
              href={whatsAppHref(issued.url)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("shareOnWhatsApp")}
            </a>
          </div>
        </Sheet>
      )}

      {adding && (
        <ExerciseSheet patientId={patientId} onClose={() => setAdding(false)} />
      )}
    </>
  );
}

function ExerciseSheet({
  patientId,
  onClose,
}: {
  patientId: string;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [sets, setSets] = useState("3");
  const [reps, setReps] = useState("10");
  const [hold, setHold] = useState("");
  const [frequency, setFrequency] = useState("");
  const [video, setVideo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        await prescribeExercise({
          patientId,
          name,
          instructions,
          sets: Number(sets) || null,
          reps: Number(reps) || null,
          holdSeconds: Number(hold) || null,
          frequency,
          videoUrl: video || null,
        });
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  return (
    <Sheet
      title={t("addExercise")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("cancel")}</Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={pending || !name.trim()}
          >
            {t("saveExercise")}
          </Button>
        </>
      }
    >
      <Field
        label={t("exerciseName")}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <div>
        <label className="fieldlabel" htmlFor="ex-how">
          {t("exerciseInstructions")}
        </label>
        <textarea
          id="ex-how"
          className="field textarea"
          rows={4}
          placeholder={t("exerciseInstructionsHint")}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
      </div>

      <div className="tender removable">
        <Field
          amount
          label={t("setsLabel")}
          inputMode="numeric"
          value={sets}
          onChange={(e) => setSets(e.target.value)}
        />
        <Field
          amount
          label={t("repsLabel")}
          inputMode="numeric"
          value={reps}
          onChange={(e) => setReps(e.target.value)}
        />
        <Field
          amount
          label={t("holdLabel")}
          inputMode="numeric"
          value={hold}
          onChange={(e) => setHold(e.target.value)}
        />
      </div>

      <Field
        label={t("frequencyLabel")}
        placeholder={t("frequencyPlaceholder")}
        value={frequency}
        onChange={(e) => setFrequency(e.target.value)}
      />
      <Field
        label={t("videoLabel")}
        dir="ltr"
        placeholder="https://"
        value={video}
        onChange={(e) => setVideo(e.target.value)}
      />

      {error && <p className="formerror">{error}</p>}
    </Sheet>
  );
}
