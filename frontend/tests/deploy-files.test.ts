import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const MIGRATIONS_DIR = join(ROOT, "supabase/migrations");
const migrations = readdirSync(MIGRATIONS_DIR).sort();
const DEPLOY_ALL = readFileSync(join(ROOT, "supabase/deploy_all.sql"), "utf8");
const APPLY_PENDING = readFileSync(join(ROOT, "supabase/apply_pending.sql"), "utf8");

// Two paste files exist because there are two situations: a brand new Supabase
// project (deploy_all) and one already running the Phase 1 baseline
// (apply_pending). Both are convenience copies of supabase/migrations, which
// means both can fall behind it — and they do so silently. deploy_all.sql sat
// at 0003 while migrations reached 0008, so a clinic set up from it would have
// had no clinical record, no patient portal, and a money surface that still
// allowed deletes. Nothing failed; the database was just quietly incomplete.
//
// A full behavioural comparison of the two paths needs a real Postgres and
// lives in the embedded-postgres harness. These assertions are the cheap guard
// that runs on every commit.

describe("the one-paste installer covers every migration", () => {
  it("has a section for each file in supabase/migrations", () => {
    expect(migrations.length).toBeGreaterThan(0);
    for (const name of migrations) {
      expect(
        DEPLOY_ALL,
        `deploy_all.sql has no section for ${name} — a new clinic installed from it would be missing that migration`
      ).toContain(`-- migrations/${name}`);
    }
  });

  it("keeps them in migration order", () => {
    const found = migrations.map((m) => DEPLOY_ALL.indexOf(`-- migrations/${m}`));
    const sorted = [...found].sort((a, b) => a - b);
    expect(found, "sections are out of order; a later migration would run first").toEqual(
      sorted
    );
  });

  it("declares the accountant role instead of adding it to the enum", () => {
    // The whole file is one transaction in the SQL editor, and a value added by
    // `alter type ... add value` cannot be referenced in the transaction that
    // added it. The policies below in the same paste do reference it, so the
    // value has to exist from `create type`. Getting this wrong produces
    // "unsafe use of new value", which reads like a syntax error and is not.
    expect(DEPLOY_ALL).toMatch(/create type clinic_role as enum \([^)]*'accountant'/);
    expect(DEPLOY_ALL).not.toMatch(/^alter type clinic_role add value/m);
  });

  it("ends by saying what was applied", () => {
    expect(DEPLOY_ALL.trimEnd()).toMatch(/select '.*' as result;$/);
  });
});

describe("the incremental installer covers everything past the baseline", () => {
  // schema.sql + 0001 is what the live project runs, so everything from 0002
  // onwards has to be in apply_pending.
  const pending = migrations.filter((m) => !m.startsWith("0001"));

  it("carries every migration after the baseline", () => {
    for (const name of pending) {
      expect(
        APPLY_PENDING,
        `apply_pending.sql does not carry ${name}`
      ).toContain(name.replace(/\.sql$/, "").slice(0, 4));
    }
  });

  it("splits into the steps the enum ordering forces, and says how many", () => {
    // `alter type ... add value` and a policy that uses the new value cannot
    // share a transaction. The file must tell the operator that in its own
    // banners, because the SQL editor gives no hint.
    const steps = [...APPLY_PENDING.matchAll(/-- STEP (\d) of (\d)/g)];
    expect(steps.length).toBeGreaterThanOrEqual(2);
    const total = Number(steps[0][2]);
    const numbered = steps.map((m) => Number(m[1]));
    // every step from 1..total is announced, and none claims a different total
    expect(new Set(numbered)).toEqual(new Set(Array.from({ length: total }, (_, i) => i + 1)));
    for (const s of steps) expect(Number(s[2])).toBe(total);
  });

  it("adds the enum value in an earlier step than the policies that use it", () => {
    const addValue = APPLY_PENDING.indexOf("add value if not exists 'accountant'");
    const usesValue = APPLY_PENDING.indexOf("'owner','reception','accountant'");
    expect(addValue).toBeGreaterThan(-1);
    expect(usesValue).toBeGreaterThan(-1);
    const stepOf = (at: number) =>
      [...APPLY_PENDING.slice(0, at).matchAll(/-- STEP (\d) of \d/g)].pop()?.[1];
    expect(stepOf(addValue)).not.toBe(stepOf(usesValue));
    expect(Number(stepOf(addValue))).toBeLessThan(Number(stepOf(usesValue)));
  });
});

describe("no paste file weakens tenant isolation", () => {
  const files = { deploy_all: DEPLOY_ALL, apply_pending: APPLY_PENDING };

  it("never disables row level security", () => {
    for (const [name, sql] of Object.entries(files)) {
      expect(sql, `${name} disables RLS`).not.toMatch(/disable row level security/i);
    }
  });

  it("sets security_invoker on every view it creates", () => {
    // A view over tenant data bypasses RLS by default, so a view created
    // without this is a cross-clinic read.
    for (const [name, sql] of Object.entries(files)) {
      const created = [...sql.matchAll(/create (?:or replace )?view (\w+)/gi)].map((m) => m[1]);
      for (const view of created) {
        expect(
          sql.includes(`alter view ${view}`) || sql.includes(`security_invoker = on`),
          `${name}: view ${view} is created without security_invoker`
        ).toBe(true);
      }
    }
  });

  it("grants no function to PUBLIC that a clinic role should gate", () => {
    // Postgres grants EXECUTE to PUBLIC on every new function. A security
    // definer function in an API-exposed schema is therefore a public endpoint
    // unless the grant is revoked — and anything the application CALLS then
    // needs the grant handing back to `authenticated`.
    //
    // Trigger functions are excluded, and deliberately: Postgres does not check
    // EXECUTE on a trigger function when the trigger fires, so a guard should be
    // revoked from PUBLIC and NOT granted back to anyone. That is the stricter
    // posture, and the live Postgres harness confirms the guards still fire with
    // no grant. An earlier version of this assertion flagged them as broken.
    for (const [name, sql] of Object.entries(files)) {
      const definers = [
        ...sql.matchAll(
          /create or replace function (\w+)\(([^)]*)\)\s*\n?returns (\w+)([\s\S]{0,600}?)security definer/gi
        ),
      ];
      for (const [, fn, , returns] of definers) {
        if (returns.toLowerCase() === "trigger") continue;
        if (!sql.includes(`revoke all on function ${fn}`)) continue;
        expect(sql, `${name}: ${fn} revokes from PUBLIC but never grants execute back`).toMatch(
          new RegExp(`grant execute on function ${fn}[^;]*to (anon, )?authenticated`)
        );
      }
    }
  });
});
