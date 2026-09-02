"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Field, SelectField } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { t } from "@/lib/strings";
import type { ClinicRole } from "@/lib/types";
import {
  addStaff,
  changeStaffRole,
  removeStaff,
  updateTherapistDuration,
  type StaffMember,
} from "./actions";

const ROLES: { value: ClinicRole; label: string }[] = [
  { value: "owner", label: t("roleOwner") },
  { value: "reception", label: t("roleReception") },
  { value: "therapist", label: t("roleTherapist") },
  { value: "accountant", label: t("roleAccountant") },
];

export function TeamPanel({ staff }: { staff: StaffMember[] }) {
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<StaffMember | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(work: () => Promise<unknown>) {
    setError(null);
    startTransition(async () => {
      try {
        await work();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  return (
    <div>
      <section className="band">
        <div className="bandhead">
          <h2>{t("teamHeading")}</h2>
          <span className="count">{staff.length}</span>
          <Button
            small
            style={{ marginInlineStart: "auto" }}
            onClick={() => setAdding(true)}
          >
            {t("addStaff")}
          </Button>
        </div>

        {error && (
          <p className="formerror" style={{ marginBottom: 10 }}>
            {error}
          </p>
        )}

        <div className="rows">
          {staff.map((m) => (
            <article className="row" key={m.userId}>
              <div className="avatar" aria-hidden="true">
                {m.name.trim().charAt(0) || "?"}
              </div>

              <div style={{ minWidth: 0 }}>
                <div className="pname">
                  {m.name}
                  {m.isSelf && (
                    <span className="hint" style={{ marginInlineStart: 6 }}>
                      ({t("you")})
                    </span>
                  )}
                </div>
                <div className="pmeta">
                  <span className="pphone" dir="ltr">
                    {m.email}
                  </span>
                  {m.role === "therapist" && (
                    <>
                      <span className="dot" />
                      <label className="hint">
                        {t("sessionMinutes")}{" "}
                        <input
                          className="field amount"
                          style={{ width: 62, height: 28, display: "inline-block" }}
                          inputMode="numeric"
                          defaultValue={m.defaultSessionMinutes}
                          aria-label={t("sessionMinutes")}
                          onBlur={(e) => {
                            const minutes = Number(e.target.value);
                            if (minutes !== m.defaultSessionMinutes) {
                              run(() =>
                                updateTherapistDuration({
                                  userId: m.userId,
                                  minutes,
                                })
                              );
                            }
                          }}
                        />
                      </label>
                    </>
                  )}
                </div>
              </div>

              <div className="acts">
                <select
                  className="field"
                  style={{ width: "auto", height: 34 }}
                  aria-label={t("changeRole")}
                  value={m.role}
                  disabled={pending}
                  onChange={(e) =>
                    run(() =>
                      changeStaffRole({
                        userId: m.userId,
                        role: e.target.value as ClinicRole,
                      })
                    )
                  }
                >
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                {!m.isSelf && (
                  <Button small onClick={() => setRemoving(m)}>
                    ×
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      {adding && <AddSheet onClose={() => setAdding(false)} />}

      {removing && (
        <Sheet
          title={t("removeFromTeam")}
          subtitle={removing.name}
          onClose={() => setRemoving(null)}
          footer={
            <>
              <Button onClick={() => setRemoving(null)}>{t("cancel")}</Button>
              <Button
                variant="danger"
                disabled={pending}
                onClick={() => {
                  const target = removing;
                  setRemoving(null);
                  run(() => removeStaff(target.userId));
                }}
              >
                {t("removeThem")}
              </Button>
            </>
          }
        >
          <p className="formerror">{t("removeConfirm")}</p>
        </Sheet>
      )}
    </div>
  );
}

function AddSheet({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<ClinicRole>("reception");
  const [password, setPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        const { password } = await addStaff({ email, fullName: name, role });
        setPassword(password);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  // Shown once and never fetched again: the server does not keep it, so there
  // is no second chance to read it. Closing the sheet is the only exit.
  if (password) {
    return (
      <Sheet
        title={t("loginCreated")}
        subtitle={name}
        onClose={onClose}
        footer={<Button variant="primary" onClick={onClose}>{t("doneAdding")}</Button>}
      >
        <p className="hint">{t("loginCreatedHow")}</p>
        <div>
          <span className="fieldlabel">{t("temporaryPassword")}</span>
          <div className="picked">
            <span className="num" dir="ltr" style={{ fontSize: "var(--step-1)" }}>
              {password}
            </span>
            <button
              type="button"
              className="linkbtn"
              onClick={() => {
                navigator.clipboard?.writeText(password).then(
                  () => setCopied(true),
                  () => setCopied(false)
                );
              }}
            >
              {copied ? t("copied") : t("copyIt")}
            </button>
          </div>
        </div>
        <p className="hint" dir="ltr">
          {email}
        </p>
      </Sheet>
    );
  }

  return (
    <Sheet
      title={t("addStaffTitle")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("cancel")}</Button>
          <Button
            variant="primary"
            disabled={pending || !email.trim() || !name.trim()}
            onClick={submit}
          >
            {t("createLogin")}
          </Button>
        </>
      }
    >
      <Field
        label={t("fullName")}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Field
        label={t("email")}
        type="email"
        dir="ltr"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <SelectField
        label={t("whatTheyDo")}
        value={role}
        onChange={(e) => setRole(e.target.value as ClinicRole)}
      >
        {ROLES.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </SelectField>
      {error && <p className="formerror">{error}</p>}
    </Sheet>
  );
}
