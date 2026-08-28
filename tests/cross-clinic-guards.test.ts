import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const files = [
  "supabase/schema.sql",
  ...readdirSync(join(ROOT, "supabase/migrations")).sort().map((m) => `supabase/migrations/${m}`),
];
const sql = Object.fromEntries(
  files.map((f) => [f, readFileSync(join(ROOT, f), "utf8")])
);

// THE BUG THIS FILE EXISTS FOR.
//
// Every table that references a patient, payment or appointment carries a
// trigger asserting the referenced row belongs to the same clinic. The lookup
// inside it reads another clinic's row — which is precisely what RLS is there to
// prevent. So without `security definer` the subquery returns NULL, the
// comparison is NULL rather than true, and the guard passes the exact row it
// exists to refuse.
//
// It is invisible in testing unless the test acts as a real clinic user: a
// harness inserting as superuser bypasses RLS, the subquery sees the row, and
// the guard appears to work. That is how it slipped past once, and it was
// written twice — in 0009 and again in 0010 — before a harness acting as a real
// receptionist caught it.

function guardBodies() {
  const found: { file: string; name: string; body: string }[] = [];
  for (const [file, src] of Object.entries(sql)) {
    // Each guard is `create or replace function <name>() returns trigger ... $$ ... $$;`
    const re = /create or replace function (\w+)\(\)\s*\n?returns trigger([\s\S]*?)\$\$;/g;
    for (const m of src.matchAll(re)) {
      found.push({ file, name: m[1], body: m[2] });
    }
  }
  return found;
}

describe("a cross-clinic guard cannot be defeated by RLS hiding the row", () => {
  const guards = guardBodies();

  it("finds the guards at all, so this suite cannot pass by matching nothing", () => {
    expect(guards.length).toBeGreaterThanOrEqual(8);
  });

  it("makes every trigger that looks up another table security definer", () => {
    for (const g of guards) {
      // Only guards that READ another table are exposed to this. A trigger that
      // only inspects NEW and OLD has nothing hidden from it.
      const readsAnotherTable = /select\s+\w+\s+from\s+(patients|payments|appointments|packages|clinics)/i.test(
        g.body
      );
      if (!readsAnotherTable) continue;
      expect(
        g.body,
        `${g.file}: ${g.name} reads another table but is not security definer — RLS will hide the row and the guard will pass everything`
      ).toMatch(/security definer/);
    }
  });

  it("pins search_path on every definer function", () => {
    // A security definer function without a fixed search_path can be pointed at
    // an attacker-controlled schema by anyone who can set search_path.
    for (const [file, src] of Object.entries(sql)) {
      const definers = [...src.matchAll(/create or replace function (\w+)\(([^)]*)\)([\s\S]{0,400}?)\$\$/g)].filter(
        (m) => /security definer/.test(m[3])
      );
      for (const d of definers) {
        expect(
          d[3],
          `${file}: ${d[1]} is security definer without a pinned search_path`
        ).toMatch(/set search_path\s*=\s*public, pg_temp/);
      }
    }
  });

  it("never compares a clinic id with a bare <> when NULL is reachable", () => {
    // `NULL <> x` is NULL, which an `if` treats as false. Under definer the
    // subquery does see the row, so `<>` is safe there — but the pattern is one
    // typo away from the bug either way, and every guard written since uses
    // `is distinct from`. New ones must too.
    const newer = Object.entries(sql).filter(([f]) => /migrations\/00(09|1\d)/.test(f));
    expect(newer.length).toBeGreaterThan(0);
    for (const [file, src] of newer) {
      expect(
        src,
        `${file}: use \`is distinct from\` rather than \`<>\` when comparing a clinic id`
      ).not.toMatch(/\)\s*<>\s*new\.clinic_id/);
    }
  });

  it("never gates a role with a bare NOT IN, for the same reason", () => {
    // my_role() returns NULL for a caller with no membership, and
    // `NULL not in (...)` is NULL — so a bare check admits a stranger. Both
    // 0008 and 0009 shipped this bug before a harness caught it.
    for (const [file, src] of Object.entries(sql)) {
      for (const m of src.matchAll(/my_role\(([^)]*)\)\s*(not in|<>)\s*/g)) {
        const at = m.index ?? 0;
        const line = src.slice(src.lastIndexOf("\n", at) + 1, src.indexOf("\n", at));
        expect(
          line,
          `${file}: \`${line.trim()}\` — wrap in coalesce or use \`is distinct from\`, a NULL role passes a bare check`
        ).toMatch(/coalesce|is distinct from/);
      }
    }
  });
});

describe("the tables added since the baseline all carry the guard", () => {
  const guarded = [
    ["soap_notes", "check_note_clinic"],
    ["outcome_measures", "check_measure_clinic"],
    ["patient_portal_tokens", "check_portal_token_clinic"],
    ["exercise_prescriptions", "check_prescription_clinic"],
    ["receipts", "check_receipt_clinic"],
    ["consents", "check_consent_clinic"],
    ["phi_access_log", "check_phi_access_clinic"],
  ] as const;

  // Collapse runs of whitespace before matching: this SQL aligns columns, so
  // asserting on exact spacing tests the formatting rather than the fact. An
  // earlier version of these two failed on `alter table soap_notes       enable`.
  const all = Object.values(sql).join("\n").replace(/[ \t]+/g, " ");

  it("attaches a trigger to each of them", () => {
    for (const [table, fn] of guarded) {
      expect(all, `${table} has no clinic guard trigger`).toMatch(
        // `before insert on X`, `before insert or update on X`, and
        // `before insert or update of a, b on X` are all in use.
        new RegExp(`create trigger \\w+\\s+before insert[\\w ,]* on ${table}\\b`)
      );
      expect(all, `${table}'s guard does not call ${fn}`).toContain(`execute function ${fn}()`);
    }
  });

  it("enables row level security on each of them", () => {
    for (const [table] of guarded) {
      expect(all, `${table} does not enable RLS`).toContain(
        `alter table ${table} enable row level security`
      );
    }
  });
});
