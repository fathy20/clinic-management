import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const SRC = readFileSync(join(ROOT, "app/finance/export.ts"), "utf8");

let ctx: unknown;
let tables: Record<string, Record<string, unknown>[]>;

vi.mock("@/lib/clinic-context", () => ({
  loadClinicContext: async () => ctx,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => ({
      select: () => ({
        eq: async () => ({ data: tables[table] ?? [], error: null }),
      }),
    }),
  }),
}));

const OWNER = {
  ok: true,
  ctx: { clinicId: "c1", clinicName: "Nile Physio", role: "owner" },
};

beforeEach(() => {
  ctx = OWNER;
  tables = {
    patients: [
      { id: "p1", name: "Mona Salem", phone: "0100", notes: null },
      { id: "p2", name: "Yassin, A", phone: "0101", notes: 'said "ouch"' },
    ],
    appointments: [{ id: "a1", patient_id: "p1", price: 350 }],
    packages: [],
    payments: [{ id: "y1", patient_id: "p1", amount: 350 }],
    refunds: [],
  };
});

describe("a clinic can take everything, without asking support", () => {
  it("exports every table, not a curated subset", async () => {
    const { exportJson } = await import("@/app/finance/export");
    const { body } = await exportJson();
    const parsed = JSON.parse(body);
    for (const table of [
      "patients",
      "appointments",
      "packages",
      "payments",
      "refunds",
    ]) {
      expect(parsed, `${table} missing from the export`).toHaveProperty(table);
    }
  });

  it("stamps the export so a clinic knows how old a file is", async () => {
    const { exportJson } = await import("@/app/finance/export");
    const parsed = JSON.parse((await exportJson()).body);
    expect(parsed.clinic).toBe("Nile Physio");
    expect(Date.parse(parsed.exportedAt)).not.toBeNaN();
  });

  it("names the file after the clinic", async () => {
    const { exportCsv, exportJson } = await import("@/app/finance/export");
    expect((await exportCsv()).filename).toBe("nile-physio-export.csv");
    expect((await exportJson()).filename).toBe("nile-physio-export.json");
  });

  it("falls back to a usable filename for an Arabic-only clinic name", async () => {
    ctx = { ok: true, ctx: { ...OWNER.ctx, clinicName: "مركز النيل" } };
    const { exportCsv } = await import("@/app/finance/export");
    // Slugging Arabic yields an empty string; ".csv" would be a broken name.
    expect((await exportCsv()).filename).toBe("clinic-export.csv");
  });
});

describe("the CSV is safe to open in a spreadsheet", () => {
  it("quotes a value containing a comma", async () => {
    const { exportCsv } = await import("@/app/finance/export");
    const { body } = await exportCsv();
    expect(body).toContain('"Yassin, A"');
  });

  it("doubles an embedded quote rather than breaking the row", async () => {
    const { exportCsv } = await import("@/app/finance/export");
    const { body } = await exportCsv();
    expect(body).toContain('"said ""ouch"""');
  });

  // A patient called "=cmd|..." is a formula injection waiting for whoever
  // opens the file. Excel and Sheets both execute a leading =, +, - or @.
  it("neutralises a leading formula character", async () => {
    tables.patients = [{ id: "p9", name: "=SUM(A1:A9)", phone: "+201000", notes: null }];
    const { exportCsv } = await import("@/app/finance/export");
    const { body } = await exportCsv();
    expect(body).toContain("'=SUM(A1:A9)");
    expect(body).not.toMatch(/(^|,)=SUM/m);
    // a phone starting with + is the same class of problem
    expect(body).toContain("'+201000");
  });

  it("writes an empty cell for null rather than the word null", async () => {
    const { exportCsv } = await import("@/app/finance/export");
    const { body } = await exportCsv();
    expect(body).not.toContain("null");
  });

  it("labels each table block with its row count", async () => {
    const { exportCsv } = await import("@/app/finance/export");
    const { body } = await exportCsv();
    expect(body).toContain("# patients (2)");
    expect(body).toContain("# packages (0)");
  });

  it("uses CRLF, which is what spreadsheets expect", async () => {
    const { exportCsv } = await import("@/app/finance/export");
    expect((await exportCsv()).body).toContain("\r\n");
  });
});

describe("the export is gated like the rest of the till", () => {
  it("refuses a therapist", async () => {
    ctx = { ok: true, ctx: { ...OWNER.ctx, role: "therapist" } };
    const { exportCsv, exportJson } = await import("@/app/finance/export");
    await expect(exportCsv()).rejects.toThrow("not authorised");
    await expect(exportJson()).rejects.toThrow("not authorised");
  });

  it("allows the accountant", async () => {
    ctx = { ok: true, ctx: { ...OWNER.ctx, role: "accountant" } };
    const { exportJson } = await import("@/app/finance/export");
    await expect(exportJson()).resolves.toBeTruthy();
  });

  it("refuses a caller with no clinic", async () => {
    ctx = { ok: false, reason: "no_clinic" };
    const { exportJson } = await import("@/app/finance/export");
    await expect(exportJson()).rejects.toThrow("not authorised");
  });

  // Using the service-role client here would turn a convenience into a
  // cross-tenant dump, so the source is asserted, not assumed.
  it("reads through the RLS-bound client, never the admin client", () => {
    expect(SRC).toContain('from "@/lib/supabase/server"');
    expect(SRC).not.toContain("supabase/admin");
    expect(SRC).not.toContain("SUPABASE_SECRET_KEY");
  });

  it("scopes every table read to the clinic", () => {
    expect(SRC).toContain('.eq("clinic_id", clinicId)');
  });
});
