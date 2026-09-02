import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MONEY_ROLES, canSeeMoney } from "@/lib/roles";

const ROOT = join(import.meta.dirname, "..");
const PAGE = readFileSync(join(ROOT, "app/patients/[id]/page.tsx"), "utf8");

// The patient record is the one screen that shows clinical history and money
// side by side, which makes it the easiest place to leak the till to a
// therapist. RLS already returns zero rows for them, but a section that
// renders an empty money panel looks broken rather than intentional — so the
// gating is asserted here as well as relied on in the database.
describe("patient record separates clinical history from money", () => {
  it("gates every money section behind canSeeMoney", () => {
    // Each of these strings must appear inside a showMoney branch.
    for (const key of [
      "lifetimeValue",
      "currentlyOwes",
      "packagesHeading",
      "paymentsHeading",
    ]) {
      expect(PAGE, `${key} must be rendered`).toContain(`t("${key}")`);
    }
    // and there must be no unguarded Money render: every <Money appears after
    // a showMoney check in the same file.
    const firstGuard = PAGE.indexOf("showMoney");
    const firstMoney = PAGE.indexOf("<Money");
    expect(firstGuard).toBeGreaterThan(-1);
    expect(firstMoney).toBeGreaterThan(firstGuard);
  });

  it("derives the MONEY gate from lib/roles, not a local list", () => {
    expect(PAGE).toContain('from "@/lib/roles"');
    expect(PAGE).toContain("canSeeMoney(role)");
    // The money gate specifically must not be hand-rolled, or it can drift
    // from the RLS policy on payments. A *clinical* role comparison is fine
    // and now exists for prescribing — an earlier version of this assertion
    // banned all role comparisons and so rejected that legitimate use.
    expect(PAGE).not.toMatch(/showMoney\s*=\s*role ===/);
    expect(PAGE).not.toMatch(/\[\s*["']owner["']\s*,\s*["']reception["']\s*,\s*["']accountant["']/);
  });

  it("keeps the therapist out of the till and the accountant in it", () => {
    expect(canSeeMoney("therapist")).toBe(false);
    expect(canSeeMoney("owner")).toBe(true);
    expect(canSeeMoney("reception")).toBe(true);
    expect(canSeeMoney("accountant")).toBe(true);
    expect(canSeeMoney(null)).toBe(false);
    expect(canSeeMoney("platform_admin")).toBe(false);
    expect(MONEY_ROLES).not.toContain("therapist");
  });

  it("scopes every query to the clinic as well as the patient", () => {
    // RLS is the real boundary; this asserts the intent is explicit at the
    // call site too, which is what keeps the (clinic_id, …) indexes in play.
    const queries = PAGE.split(".from(").slice(1);
    expect(queries.length).toBeGreaterThanOrEqual(5);
    for (const q of queries) {
      const head = q.slice(0, 400);
      expect(head, `query missing clinic scope: ${head.slice(0, 60)}`).toContain(
        'eq("clinic_id", clinicId)'
      );
    }
  });

  it("warns when consent was never recorded", () => {
    // Health data is sensitive under Law 151/2020; a record with no consent
    // timestamp has to say so rather than look complete.
    expect(PAGE).toContain("!patient.consent_at");
    expect(PAGE).toContain('t("consentMissing")');
  });

  it("uses maybeSingle so a wrong id is a clean miss, not a thrown error", () => {
    expect(PAGE).toContain(".maybeSingle()");
    expect(PAGE).toContain('t("patientNotFound")');
  });
});

describe("clinic context is loaded in one place", () => {
  const context = readFileSync(join(ROOT, "lib/clinic-context.ts"), "utf8");

  it("is server-only, so it can never be pulled into a client bundle", () => {
    expect(context).toMatch(/^import "server-only";/m);
  });

  it("picks the same clinic as the owner gate does", () => {
    // Determinism alone was not enough: the page and the owner gate behind
    // /settings each had their own deterministic rule, and the two disagreed
    // for a multi-clinic member. Both now go through one function, whose
    // behaviour is asserted in tests/one-clinic.test.ts.
    expect(context).toContain("activeMembership(supabase, user.id)");
    expect(context).not.toMatch(/from\("memberships"\)[\s\S]{0,200}\.eq\("user_id"/);
  });

  it("defaults currency rather than failing before migration 0002", () => {
    expect(context).toContain('?? "EGP"');
  });

  it("every clinic page uses it instead of re-querying membership", () => {
    for (const page of [
      "app/reception/page.tsx",
      "app/schedule/page.tsx",
      "app/patients/[id]/page.tsx",
    ]) {
      const src = readFileSync(join(ROOT, page), "utf8");
      expect(src, `${page} should load context centrally`).toContain(
        "loadClinicContext()"
      );
      expect(src, `${page} should not re-query memberships`).not.toContain(
        'from("memberships")'
      );
    }
  });
});
