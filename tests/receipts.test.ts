import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const MIGRATION = readFileSync(join(ROOT, "supabase/migrations/0009_receipts.sql"), "utf8");
const ACTION = readFileSync(join(ROOT, "app/receipts/actions.ts"), "utf8");
const PAGE = readFileSync(join(ROOT, "app/receipts/[id]/page.tsx"), "utf8");
const CSS = readFileSync(join(ROOT, "app/globals.css"), "utf8");

// The behavioural properties — gapless numbering under concurrency, the frozen
// tax basis, idempotence, and a write surface only the function can use — are
// proved against a real Postgres in the embedded-postgres harness, because none
// of them can be asserted about SQL text. These are the structural rules that
// would let those properties be removed by a later edit without anything
// failing.

describe("a receipt is a financial document, not a view of one", () => {
  it("freezes the tax basis on the row instead of joining to the clinic", () => {
    // A clinic that becomes taxable next year, or corrects its tax label, must
    // not silently rewrite receipts already handed to patients.
    for (const col of ["currency", "tax_rate", "tax_label", "regime"]) {
      expect(MIGRATION, `${col} must be stored on the receipt`).toMatch(
        new RegExp(`^\\s+${col}\\s`, "m")
      );
    }
  });

  it("makes the arithmetic a constraint rather than a convention", () => {
    expect(MIGRATION).toContain("check (subtotal + tax_amount = total)");
  });

  it("numbers gaplessly per clinic, and cannot reuse a number", () => {
    expect(MIGRATION).toContain("unique (clinic_id, number)");
    // Counting rows would reuse a number the moment anything is voided.
    expect(MIGRATION).not.toMatch(/next_invoice_number\s*=\s*\(\s*select count/i);
    // The clinic row is locked, which is what serialises two tills.
    expect(MIGRATION).toMatch(/from clinics where id = pay\.clinic_id for update/);
  });

  it("allows one receipt per payment, so a double click cannot issue two", () => {
    expect(MIGRATION).toMatch(/payment_id\s+uuid not null references payments[^,]*unique/);
    expect(MIGRATION).toMatch(/if existing\.id is not null then\s+return existing;/);
  });

  it("uses numeric, never a float, for every amount", () => {
    const amounts = [...MIGRATION.matchAll(/^\s+(subtotal|tax_amount|total)\s+(\S+)/gm)];
    expect(amounts.length).toBe(3);
    for (const [, name, type] of amounts) {
      expect(type, `${name} must be numeric(12,2)`).toBe("numeric(12,2)");
    }
    expect(MIGRATION).not.toMatch(/\b(float|real|double precision)\b/);
  });

  it("extracts tax from the gross rather than adding it on", () => {
    // The amount collected is what the patient handed over, so tax comes out
    // of it. Adding tax on top would make the receipt disagree with the till.
    expect(MIGRATION).toContain("round(gross / (1 + cl.tax_rate), 2)");
    // and the tax is the remainder, so the parts always sum to the cash taken
    expect(MIGRATION).toContain("vat   := gross - net;");
  });
});

describe("who may issue and read one", () => {
  it("admits the till and refuses the clinician", () => {
    const policy = MIGRATION.slice(MIGRATION.indexOf("create policy receipts_read"));
    expect(policy).toContain("'owner','reception','accountant'");
    expect(policy.slice(0, 300)).not.toContain("therapist");
  });

  it("is gated on clinic_id in my_clinics, like every other tenant table", () => {
    expect(MIGRATION).toContain("clinic_id in (select my_clinics())");
  });

  it("checks the caller inside the security definer function", () => {
    // security definer bypasses the caller's privileges, so the function is
    // responsible for checking them.
    expect(MIGRATION).toMatch(/security definer/);
    expect(MIGRATION).toContain("only the till can issue a receipt in this clinic");
  });

  it("survives a NULL role rather than admitting a stranger", () => {
    // my_role returns NULL for someone with no membership, and
    // `NULL not in (...)` is NULL, not true — a bare check lets them through.
    expect(MIGRATION).toContain("coalesce(my_role(pay.clinic_id)::text, '')");
  });

  it("takes no clinic id from the caller", () => {
    const fn = MIGRATION.slice(MIGRATION.indexOf("create or replace function issue_receipt"));
    const signature = fn.slice(0, fn.indexOf(")"));
    expect(signature).not.toMatch(/clinic/i);
  });

  it("does not leave the function executable by PUBLIC", () => {
    // Postgres grants EXECUTE to PUBLIC on every new function, and this one is
    // security definer in a schema the API exposes.
    expect(MIGRATION).toContain("revoke all on function issue_receipt(uuid) from public");
    expect(MIGRATION).toContain("grant execute on function issue_receipt(uuid) to authenticated");
  });
});

describe("an issued receipt cannot be altered", () => {
  it("has no insert, update or delete policy at all", () => {
    // With RLS on and only a select policy, the single way a row can appear is
    // the security definer function.
    const policies = [...MIGRATION.matchAll(/create policy \w+ on receipts for (\w+)/g)].map(
      (m) => m[1]
    );
    expect(policies).toEqual(["select"]);
  });

  it("guards against pointing at another clinic's payment or patient", () => {
    expect(MIGRATION).toContain("receipt payment belongs to a different clinic");
    expect(MIGRATION).toContain("receipt patient belongs to a different clinic");
    expect(MIGRATION).toContain("create trigger receipt_clinic_guard");
  });
});

describe("the action computes nothing", () => {
  it("delegates to the database function", () => {
    expect(ACTION).toContain('rpc("issue_receipt"');
    // No arithmetic in the action: the number and the tax split are the
    // database's business, and a browser-supplied amount is never trusted.
    expect(ACTION).not.toMatch(/[*/]\s*\(?1\s*\+/);
    expect(ACTION).not.toContain("tax_rate");
  });

  it("goes through the caller's session, not the service key", () => {
    // issue_receipt checks my_role(), which reads auth.uid(). Under the
    // service key there is no authenticated user and every call is refused.
    expect(ACTION).toContain('from "@/lib/supabase/server"');
    expect(ACTION).not.toContain("adminClient");
  });

  it("establishes who is asking before anything else", () => {
    const first = ACTION.indexOf("loadClinicContext()");
    const rpc = ACTION.indexOf('rpc("issue_receipt"');
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(rpc);
    expect(ACTION).toContain("canSeeMoney(result.ctx.role)");
  });

  it("names the migration if the table is not deployed", () => {
    expect(ACTION).toContain('throwIfNotMigrated(error, "0009")');
  });
});

describe("the printed document", () => {
  it("scopes the receipt read to the clinic as well as the id", () => {
    const read = PAGE.slice(PAGE.indexOf('.from("receipts")'));
    expect(read.slice(0, 400)).toContain('eq("clinic_id", clinicId)');
  });

  it("refuses a role that cannot see money", () => {
    expect(PAGE).toContain("canSeeMoney(role)");
    expect(PAGE).toContain('t("receiptsForbidden")');
  });

  it("dates the receipt in the clinic's timezone, not the server's", () => {
    expect(PAGE).toContain("clinicFormat(");
    expect(PAGE).toContain("timezone");
    expect(PAGE).not.toMatch(/toLocaleDateString\(\)/);
  });

  it("stays out of search engines and referrer headers", () => {
    expect(PAGE).toContain("robots: { index: false, follow: false }");
    expect(PAGE).toContain('referrer: "no-referrer"');
  });

  it("says what it is not", () => {
    // Claiming statutory compliance that has not been built would be worse
    // than issuing nothing.
    expect(PAGE).toContain('t("notATaxInvoice")');
  });

  it("hides the tax lines for a clinic that is not taxable", () => {
    // A zero-rated clinic reading "VAT 0.00" invites the question of why.
    expect(PAGE).toContain("const taxed = rate > 0;");
    expect(PAGE).toContain("{taxed && (");
  });

  it("renders every amount through Money", () => {
    // The gold-means-money rule has a hole in it otherwise — DESIGN.md §1.
    for (const field of ["subtotal", "tax_amount", "total"]) {
      expect(PAGE).toMatch(new RegExp(`<Money[\\s\\S]{0,80}receipt\\.${field}`));
    }
  });
});

describe("it prints on paper, which has no theme", () => {
  it("forces ink on white at print time", () => {
    const print = CSS.slice(CSS.indexOf("@media print"));
    expect(print).toContain("var(--paper)");
    expect(print).toContain("var(--paper-ink)");
  });

  it("drops the screen chrome from the printed page", () => {
    const print = CSS.slice(CSS.indexOf("@media print"));
    expect(print).toMatch(/\.doc-actions\s*\{\s*display:\s*none/);
  });

  it("prints money in black, because gold is unreadable in grey-scale", () => {
    const print = CSS.slice(CSS.indexOf("@media print"));
    expect(print).toMatch(/\.money[\s\S]{0,60}color:\s*var\(--paper-ink\)/);
  });

  it("defines the paper tokens on bare :root and never redefines them", () => {
    // Paper is the one medium in this product that is not themed. These are
    // deliberately absent from the dark blocks, which is the opposite of the
    // rule for every other colour — hence the comment in the CSS saying so.
    const root = CSS.slice(CSS.indexOf(":root {"), CSS.indexOf("@media (prefers-color-scheme"));
    for (const token of ["--paper", "--paper-ink", "--paper-mute", "--paper-line"]) {
      expect(root, `${token} must be defined on bare :root`).toContain(`${token}:`);
    }
    const afterRoot = CSS.slice(CSS.indexOf("@media (prefers-color-scheme"));
    const darkBlocks = afterRoot.slice(0, afterRoot.indexOf("body {"));
    expect(darkBlocks).not.toContain("--paper");
  });
});
