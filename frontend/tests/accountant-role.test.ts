import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MONEY_ROLES, canSeeMoney } from "@/lib/roles";

const ROOT = join(import.meta.dirname, "..");
const migration = (f: string) =>
  readFileSync(join(ROOT, "supabase/migrations", f), "utf8");

const M0002 = migration("0002_foundation.sql");
const M0003 = migration("0003_accountant_policies.sql");

// The three tables that hold money. Clinical tables land in a later phase and
// must NOT pick up 'accountant' when they do.
const MONEY_TABLES = ["packages", "payments", "refunds"];
const ALL_ROLES = ["owner", "reception", "therapist", "accountant"];

function policyBody(table: string) {
  const match = M0003.match(
    new RegExp(`create policy tenant on ${table} for all([\\s\\S]*?);`, "i")
  );
  expect(match, `0003 must create the tenant policy on ${table}`).not.toBeNull();
  return match![1];
}

// Both the `using` (read) and the `with check` (write) role list. A policy
// with only one of them leaves the other path wide open, so they are read as
// a pair and compared separately rather than assumed identical.
function roleLists(body: string) {
  return [...body.matchAll(/my_role\(clinic_id\) in \(([^)]*)\)/g)].map((m) =>
    m[1].split(",").map((r) => r.trim().replace(/'/g, ""))
  );
}

describe("the accountant role is added without tripping the enum trap", () => {
  it("adds the enum value", () => {
    expect(M0002).toMatch(/alter type clinic_role add value.*'accountant'/);
  });

  // Postgres refuses "unsafe use of new value of enum type" when a value
  // added by `alter type ... add value` is used in the same transaction, and
  // the Supabase SQL editor wraps a paste in one. So 0002 adds the value and
  // nothing else may reference it — the policies live in 0003.
  it("never references the new value in the same migration", () => {
    expect(M0002).not.toMatch(/create policy/i);
    expect(M0002).not.toMatch(/my_role/);
  });

  it("puts the policies that use it in a separate migration", () => {
    expect(M0003).toMatch(/create policy/i);
    expect(M0003).not.toMatch(/alter type/i);
  });
});

describe("per-clinic currency", () => {
  it("is not null, defaults to EGP, and is shape-checked as ISO 4217", () => {
    expect(M0002).toMatch(/alter table clinics/);
    expect(M0002).toMatch(/currency char\(3\) not null default 'EGP'/);
    expect(M0002).toMatch(/check \(currency ~ '\^\[A-Z\]\{3\}\$'\)/);
  });
});

describe.each(MONEY_TABLES)("the %s policy", (table) => {
  const lists = roleLists(policyBody(table));

  it("gates both the read and the write path", () => {
    expect(lists).toHaveLength(2);
  });

  it("names exactly the roles the app renders money for", () => {
    for (const roles of lists) {
      expect([...roles].sort()).toEqual([...MONEY_ROLES].sort());
    }
  });

  // The whole point of the role: finance without the clinical record. A
  // therapist reaching a money table gets zero rows, not a filtered view.
  it("excludes the therapist", () => {
    for (const roles of lists) {
      expect(roles).not.toContain("therapist");
    }
  });
});

// Two copies of one rule — the policy in Postgres and the gate in the UI.
// RLS is the boundary that actually matters; this only decides whether money
// is rendered at all, so a therapist gets a screen with no till instead of an
// empty one that looks broken. If the two drift, this fails.
describe("the UI money gate mirrors the policy", () => {
  const policyRoles = roleLists(policyBody("payments"))[0];

  it.each(ALL_ROLES)("agrees with the policy for %s", (role) => {
    expect(canSeeMoney(role)).toBe(policyRoles.includes(role));
  });

  it("refuses anything that isn't a known role", () => {
    expect(canSeeMoney("")).toBe(false);
    expect(canSeeMoney(null)).toBe(false);
    expect(canSeeMoney(undefined)).toBe(false);
    expect(canSeeMoney("platform_admin")).toBe(false);
  });
});
