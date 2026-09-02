"use client";

import { useId } from "react";

// The sheets were repeating the same fieldlabel/field/hint markup ten times,
// each wiring its own id by hand. This owns that structure — the 44px target
// (--tap) and tabular figures for amounts stay in the .field class, per
// DESIGN.md, so nothing here decides how a field looks.
//
// The wrapper div appears only when there is a label or a hint to put in it:
// .sheetbody is a flex column with a gap, so an extra div around a bare
// control would change the spacing of the form it sits in.
type Common = {
  label?: string;
  hint?: React.ReactNode;
};

function Wrap({
  id,
  label,
  hint,
  control,
}: Common & { id?: string; control: React.ReactNode }) {
  if (!label && !hint) return <>{control}</>;
  return (
    <div>
      {label && (
        <label className="fieldlabel" htmlFor={id}>
          {label}
        </label>
      )}
      {control}
      {hint && (
        <p className="hint" style={{ marginTop: 6 }}>
          {hint}
        </p>
      )}
    </div>
  );
}

export function Field({
  label,
  hint,
  amount = false,
  className = "",
  id,
  ...props
}: Common & { amount?: boolean } & React.InputHTMLAttributes<HTMLInputElement>) {
  const generated = useId();
  const fieldId = id ?? (label ? generated : undefined);
  return (
    <Wrap id={fieldId} label={label} hint={hint}
      control={
        <input
          id={fieldId}
          className={`field${amount ? " amount" : ""}${className ? " " + className : ""}`}
          {...props}
        />
      }
    />
  );
}

export function SelectField({
  label,
  hint,
  className = "",
  id,
  children,
  ...props
}: Common & React.SelectHTMLAttributes<HTMLSelectElement>) {
  const generated = useId();
  const fieldId = id ?? (label ? generated : undefined);
  return (
    <Wrap id={fieldId} label={label} hint={hint}
      control={
        <select
          id={fieldId}
          className={`field${className ? " " + className : ""}`}
          {...props}
        >
          {children}
        </select>
      }
    />
  );
}
