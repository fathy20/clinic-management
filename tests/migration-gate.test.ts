import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  gated,
  isMissingEnumValue,
  isMissingObject,
  notMigratedMessage,
  throwIfNotMigrated,
} from "@/lib/migration-gate";

const ROOT = join(import.meta.dirname, "..");

// These are the exact bodies the live project returned while migrations
// 0002–0008 were unapplied, captured from its REST API rather than guessed.
const LIVE_MISSING_TABLE = {
  code: "PGRST205",
  details: null,
  hint: null,
  message: "Could not find the table 'public.soap_notes' in the schema cache",
};
const LIVE_MISSING_FUNCTION = {
  code: "PGRST202",
  message:
    "Searched for the function public.demote_member with parameters p_clinic, p_role, p_user or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.",
};
const LIVE_MISSING_ENUM_VALUE = {
  code: "22P02",
  details: null,
  hint: null,
  message: 'invalid input value for enum clinic_role: "accountant"',
};

describe("telling an unapplied migration apart from no data", () => {
  it("recognises the missing-table body the live project actually returns", () => {
    expect(isMissingObject(LIVE_MISSING_TABLE)).toBe(true);
  });

  it("recognises a missing function and a missing column", () => {
    expect(isMissingObject(LIVE_MISSING_FUNCTION)).toBe(true);
    expect(isMissingObject({ code: "42703", message: 'column "tax_rate" does not exist' })).toBe(true);
    expect(isMissingObject({ code: "PGRST204", message: "Could not find the column" })).toBe(true);
  });

  it("recognises it from the wording when PostgREST sends no code", () => {
    expect(
      isMissingObject({ message: 'relation "public.exercise_prescriptions" does not exist' })
    ).toBe(true);
  });

  it("does not mistake a real failure for a missing migration", () => {
    // These must reach the operator as themselves. Calling a permission denial
    // "apply a migration" would send someone to run SQL that fixes nothing —
    // and 42501 is what a correct RLS policy returns.
    for (const error of [
      { code: "42501", message: "new row violates row-level security policy" },
      { code: "23514", message: 'violates check constraint "sessions_used_le_total"' },
      { code: "23505", message: "duplicate key value violates unique constraint" },
      { code: "PGRST116", message: "JSON object requested, multiple rows returned" },
      { message: "fetch failed" },
    ]) {
      expect(isMissingObject(error), error.message).toBe(false);
    }
  });

  it("treats no error as no error", () => {
    expect(isMissingObject(null)).toBe(false);
    expect(isMissingObject({})).toBe(false);
  });
});

describe("an enum value a migration has not added yet", () => {
  it("recognises the body the live project returns for the accountant role", () => {
    expect(isMissingEnumValue(LIVE_MISSING_ENUM_VALUE, "clinic_role")).toBe(true);
  });

  it("is not the same thing as a missing table", () => {
    // The table and the column both exist — it is the value that is rejected —
    // so this must not be routed through the missing-object path.
    expect(isMissingObject(LIVE_MISSING_ENUM_VALUE)).toBe(false);
    expect(isMissingEnumValue(LIVE_MISSING_TABLE, "clinic_role")).toBe(false);
  });

  it("does not match a different enum, or a malformed uuid", () => {
    expect(isMissingEnumValue(LIVE_MISSING_ENUM_VALUE, "payment_method")).toBe(false);
    // 22P02 is also what an unparseable uuid returns; that is a caller bug.
    expect(
      isMissingEnumValue(
        { code: "22P02", message: 'invalid input syntax for type uuid: "abc"' },
        "clinic_role"
      )
    ).toBe(false);
  });
});

describe("gated reads", () => {
  const q = (data: unknown, error: unknown) => Promise.resolve({ data, error } as never);

  it("passes data through untouched when the table is there", async () => {
    const r = await gated("0005", q([{ id: "n1" }], null), []);
    expect(r).toEqual({ ok: true, data: [{ id: "n1" }] });
  });

  it("substitutes the empty value for a null result rather than crashing", async () => {
    const r = await gated("0005", q(null, null), []);
    expect(r).toEqual({ ok: true, data: [] });
  });

  it("names the migration instead of returning an empty list", async () => {
    // Returning [] here is the bug this module exists for: the clinical screen
    // rendered "0 written up" for every patient and a therapist reads that as
    // their notes being lost.
    const r = await gated("0005", q(null, LIVE_MISSING_TABLE), []);
    expect(r).toEqual({ ok: false, reason: "not_migrated", migration: "0005" });
  });

  it("reports a real error as itself", async () => {
    const r = await gated("0005", q(null, { code: "42501", message: "denied" }), []);
    expect(r).toEqual({ ok: false, reason: "error", message: "denied" });
  });
});

describe("gated writes", () => {
  it("says nothing when the write succeeded", () => {
    expect(() => throwIfNotMigrated(null, "0007")).not.toThrow();
  });

  it("names the migration and the file to run", () => {
    expect(() => throwIfNotMigrated(LIVE_MISSING_TABLE, "0007")).toThrow(/migration 0007/);
    expect(() => throwIfNotMigrated(LIVE_MISSING_TABLE, "0007")).toThrow(
      /apply_pending\.sql/
    );
  });

  it("never puts raw Postgres text in front of a clinic", () => {
    let message = "";
    try {
      throwIfNotMigrated(LIVE_MISSING_TABLE, "0007");
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toContain("schema cache");
    expect(message).not.toContain("public.soap_notes");
  });

  it("passes a real error through unchanged", () => {
    expect(() => throwIfNotMigrated({ code: "42501", message: "denied" }, "0007")).toThrow(
      "denied"
    );
  });
});

describe("every read of a post-baseline table goes through the gate", () => {
  // The live project runs schema.sql + 0001. Anything created after that can
  // be absent at runtime, so reading it without checking the error is the bug.
  const LATER_TABLES = [
    "soap_notes",
    "outcome_measures",
    "recovery_progress",
    "patient_portal_tokens",
    "exercise_prescriptions",
  ];

  const FILES = [
    "app/clinical/page.tsx",
    "app/clinical/actions.ts",
    "app/patients/[id]/page.tsx",
    "app/patients/portal-actions.ts",
  ];

  it("leaves no read that silently drops the error", () => {
    for (const file of FILES) {
      const src = readFileSync(join(ROOT, file), "utf8");
      for (const table of LATER_TABLES) {
        if (!src.includes(`.from("${table}")`)) continue;
        expect(
          src.includes("gated") || src.includes("throwIfNotMigrated"),
          `${file} reads ${table} without a migration gate`
        ).toBe(true);
      }
    }
  });

  it("never destructures only data off one of those reads", () => {
    for (const file of FILES) {
      const src = readFileSync(join(ROOT, file), "utf8");
      for (const table of LATER_TABLES) {
        const at = src.indexOf(`.from("${table}")`);
        if (at < 0) continue;
        // Look back for the assignment that consumes this query. `{ data: x }`
        // with no error binding is how "0 written up" got rendered.
        const before = src.slice(Math.max(0, at - 260), at);
        const lastAssign = before.lastIndexOf("{ data:");
        if (lastAssign < 0) continue;
        const binding = before.slice(lastAssign, before.indexOf("}", lastAssign) + 1);
        expect(
          binding.includes("error"),
          `${file}: ${table} is read as ${binding} — the error is dropped`
        ).toBe(true);
      }
    }
  });

  it("tells the operator the one command that fixes it", () => {
    expect(notMigratedMessage("0005")).toContain("supabase/apply_pending.sql");
  });
});
